import { esquemaCodigoTotp, esquemaLogin } from "@comprobantepy/shared";
import { eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { registrarAuditoria } from "../auditoria.js";
import { HASH_FICTICIO, verificarPassword } from "../auth/password.js";
import {
  cargarUsuario,
  cerrarSesion,
  crearSesion,
  ErrorHttp,
  requiereSegundoFactor,
  type UsuarioSesion,
} from "../auth/sesiones.js";
import { generarSecretoTotp, uriOtpauth, verificarTotp } from "../auth/totp.js";
import { cifrar, descifrar } from "../cifrado.js";
import type { BaseDeDatos } from "../db/conexion.js";
import { contribuyentes, usuarios } from "../db/esquema.js";
import { validar } from "../validacion.js";

function exigirUsuario(usuario: UsuarioSesion | null): UsuarioSesion {
  if (!usuario) throw new ErrorHttp(401, "NO_AUTENTICADO", "Iniciá sesión para continuar");
  return usuario;
}

export async function rutasAuth(app: FastifyInstance, { db }: { db: BaseDeDatos }) {
  const credencialesInvalidas = () => new ErrorHttp(401, "CREDENCIALES_INVALIDAS", "Correo o contraseña incorrectos");

  app.post(
    "/login",
    { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } },
    async (request, reply) => {
      const datos = validar(esquemaLogin, request.body);
      const [usuario] = await db
        .select()
        .from(usuarios)
        .where(sql`lower(${usuarios.email}) = ${datos.email}`);

      const passwordOk = await verificarPassword(datos.password, usuario?.passwordHash ?? HASH_FICTICIO);
      if (!usuario || !passwordOk) {
        await registrarAuditoria(db, { entidad: "sesion", accion: "LOGIN_FALLIDO", valorNuevo: { email: datos.email } }, request);
        throw credencialesInvalidas();
      }
      if (usuario.bloqueado) throw new ErrorHttp(403, "USUARIO_BLOQUEADO", "El usuario está bloqueado");

      if (usuario.totpActivo) {
        if (!datos.codigoTotp) {
          throw new ErrorHttp(401, "REQUIERE_TOTP", "Ingresá el código de tu aplicación de autenticación");
        }
        const secreto = descifrar(usuario.totpSecretoCifrado ?? "");
        if (!verificarTotp(secreto, datos.codigoTotp)) {
          await registrarAuditoria(db, { entidad: "sesion", entidadId: usuario.id, accion: "TOTP_FALLIDO" }, request);
          throw new ErrorHttp(401, "TOTP_INVALIDO", "El código no es válido o ya venció");
        }
      }

      request.sesionId = await crearSesion(db, usuario.id, request, reply);
      request.usuario = await cargarUsuario(db, usuario.id);
      await registrarAuditoria(db, { entidad: "sesion", entidadId: usuario.id, accion: "LOGIN" }, request);
      return respuestaYo(db, exigirUsuario(request.usuario));
    },
  );

  app.post("/logout", async (request, reply) => {
    if (request.usuario) {
      await registrarAuditoria(db, { entidad: "sesion", entidadId: request.usuario.id, accion: "LOGOUT" }, request);
    }
    await cerrarSesion(db, request, reply);
    return { ok: true };
  });

  app.get("/yo", async (request) => respuestaYo(db, exigirUsuario(request.usuario)));

  /** Genera un secreto TOTP pendiente de confirmación. */
  app.post("/totp/iniciar", async (request) => {
    const usuario = exigirUsuario(request.usuario);
    if (usuario.totpActivo) {
      throw new ErrorHttp(409, "TOTP_YA_ACTIVO", "El segundo factor ya está configurado");
    }
    const secreto = generarSecretoTotp();
    await db
      .update(usuarios)
      .set({ totpSecretoCifrado: cifrar(secreto), actualizadoEn: new Date() })
      .where(eq(usuarios.id, usuario.id));
    return { secreto, uri: uriOtpauth(secreto, usuario.email) };
  });

  app.post("/totp/confirmar", async (request) => {
    const usuario = exigirUsuario(request.usuario);
    const { codigo } = validar(esquemaCodigoTotp, request.body);
    const [fila] = await db.select().from(usuarios).where(eq(usuarios.id, usuario.id));
    if (!fila?.totpSecretoCifrado || fila.totpActivo) {
      throw new ErrorHttp(409, "TOTP_SIN_INICIAR", "Primero generá el código QR");
    }
    if (!verificarTotp(descifrar(fila.totpSecretoCifrado), codigo)) {
      throw new ErrorHttp(400, "TOTP_INVALIDO", "El código no es válido o ya venció");
    }
    await db.transaction(async (tx) => {
      await tx.update(usuarios).set({ totpActivo: true, actualizadoEn: new Date() }).where(eq(usuarios.id, usuario.id));
      await registrarAuditoria(tx, { entidad: "usuario", entidadId: usuario.id, accion: "TOTP_ACTIVADO" }, request);
    });
    return respuestaYo(db, { ...usuario, totpActivo: true });
  });
}

async function respuestaYo(db: BaseDeDatos, usuario: UsuarioSesion) {
  const lista = await db
    .select({ id: contribuyentes.id, nombre: contribuyentes.nombre, estado: contribuyentes.estado })
    .from(contribuyentes);
  const visibles = usuario.esAdministrador
    ? lista
    : lista.filter((c) => usuario.perfiles.some((p) => p.contribuyenteId === c.id));
  return {
    usuario: {
      id: usuario.id,
      email: usuario.email,
      nombre: usuario.nombre,
      esAdministrador: usuario.esAdministrador,
      totpActivo: usuario.totpActivo,
      requiereConfigurar2fa: requiereSegundoFactor(usuario) && !usuario.totpActivo,
    },
    contribuyentes: visibles.map((c) => ({
      ...c,
      perfiles: usuario.perfiles.filter((p) => p.contribuyenteId === c.id).map((p) => p.perfil),
    })),
  };
}
