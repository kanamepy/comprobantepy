import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { registrarAuditoria } from "../auditoria.js";
import { hashPassword, LONGITUD_MINIMA_PASSWORD, verificarPassword } from "../auth/password.js";
import { ErrorHttp, exigirAdministrador, exigirSesion } from "../auth/sesiones.js";
import type { BaseDeDatos } from "../db/conexion.js";
import { contribuyentes, sesiones, usuarioContribuyentePerfiles, usuarios } from "../db/esquema.js";
import { validar } from "../validacion.js";

const password = z.string().min(LONGITUD_MINIMA_PASSWORD, `La contraseña debe tener al menos ${LONGITUD_MINIMA_PASSWORD} caracteres`).max(200);

const esquemaNuevo = z.object({
  email: z.string().trim().toLowerCase().email("Correo inválido"),
  nombre: z.string().trim().min(2, "Ingresá el nombre").max(200),
  password,
  esAdministrador: z.boolean().default(false),
});

const esquemaPerfiles = z.object({
  perfiles: z
    .array(z.object({ contribuyenteId: z.number().int().positive(), perfil: z.enum(["AUXILIAR", "FINANCIERO", "CONSULTA"]) }))
    .max(300),
});

/** Administración de usuarios y perfiles por contribuyente (secciones 5 y 5.1). */
export async function rutasUsuarios(app: FastifyInstance, { db }: { db: BaseDeDatos }) {
  app.addHook("preHandler", exigirSesion);

  /** Cambio de la propia contraseña (cualquier usuario). */
  app.post("/yo/password", async (request) => {
    const { actual, nueva } = validar(z.object({ actual: z.string().min(1, "Ingresá tu contraseña actual"), nueva: password }), request.body);
    const [fila] = await db.select().from(usuarios).where(eq(usuarios.id, request.usuario!.id));
    if (!fila || !(await verificarPassword(actual, fila.passwordHash))) {
      throw new ErrorHttp(400, "DATOS_INVALIDOS", "Revisá los datos ingresados", { actual: "La contraseña actual no es correcta" });
    }
    await db.update(usuarios).set({ passwordHash: await hashPassword(nueva), actualizadoEn: new Date() }).where(eq(usuarios.id, fila.id));
    // Se cierran las demás sesiones abiertas.
    await db.delete(sesiones).where(and(eq(sesiones.usuarioId, fila.id), ne(sesiones.id, request.sesionId ?? "")));
    await registrarAuditoria(db, { entidad: "usuario", entidadId: fila.id, accion: "CAMBIO_PASSWORD" }, request);
    return { ok: true };
  });

  app.get("/", async (request) => {
    exigirAdministrador(request);
    const lista = await db
      .select({ id: usuarios.id, email: usuarios.email, nombre: usuarios.nombre, esAdministrador: usuarios.esAdministrador, totpActivo: usuarios.totpActivo, bloqueado: usuarios.bloqueado, creadoEn: usuarios.creadoEn })
      .from(usuarios)
      .orderBy(asc(usuarios.nombre));
    const perfiles = await db.select().from(usuarioContribuyentePerfiles);
    return lista.map((u) => ({
      ...u,
      perfiles: perfiles.filter((p) => p.usuarioId === u.id).map((p) => ({ contribuyenteId: p.contribuyenteId, perfil: p.perfil })),
    }));
  });

  app.post("/", async (request, reply) => {
    exigirAdministrador(request);
    const datos = validar(esquemaNuevo, request.body);
    const [existente] = await db.select({ id: usuarios.id }).from(usuarios).where(sql`lower(${usuarios.email}) = ${datos.email}`);
    if (existente) throw new ErrorHttp(409, "USUARIO_EXISTENTE", "Ya existe un usuario con ese correo");
    const [creado] = await db
      .insert(usuarios)
      .values({ email: datos.email, nombre: datos.nombre, passwordHash: await hashPassword(datos.password), esAdministrador: datos.esAdministrador })
      .returning({ id: usuarios.id, email: usuarios.email, nombre: usuarios.nombre, esAdministrador: usuarios.esAdministrador });
    await registrarAuditoria(db, { entidad: "usuario", entidadId: creado!.id, accion: "CREAR", valorNuevo: creado }, request);
    reply.code(201);
    return creado;
  });

  app.patch<{ Params: { id: string } }>("/:id", async (request) => {
    exigirAdministrador(request);
    const id = Number(request.params.id);
    const cambios = validar(
      z.object({ nombre: z.string().trim().min(2).max(200), esAdministrador: z.boolean(), bloqueado: z.boolean() }).partial(),
      request.body,
    );
    if (id === request.usuario!.id && (cambios.bloqueado === true || cambios.esAdministrador === false)) {
      throw new ErrorHttp(409, "SOBRE_SI_MISMO", "No podés bloquearte ni quitarte el perfil de administrador a vos mismo");
    }
    const [anterior] = await db.select().from(usuarios).where(eq(usuarios.id, id));
    if (!anterior) throw new ErrorHttp(404, "NO_ENCONTRADO", "Usuario inexistente");
    await db.update(usuarios).set({ ...cambios, actualizadoEn: new Date() }).where(eq(usuarios.id, id));
    if (cambios.bloqueado) await db.delete(sesiones).where(eq(sesiones.usuarioId, id));
    await registrarAuditoria(
      db,
      { entidad: "usuario", entidadId: id, accion: cambios.bloqueado === true ? "BLOQUEAR" : cambios.bloqueado === false ? "DESBLOQUEAR" : "EDITAR", valorAnterior: { nombre: anterior.nombre, esAdministrador: anterior.esAdministrador, bloqueado: anterior.bloqueado }, valorNuevo: cambios },
      request,
    );
    return { ok: true };
  });

  /** Reemplaza los perfiles del usuario: puede tener varios por contribuyente (sección 5). */
  app.put<{ Params: { id: string } }>("/:id/perfiles", async (request) => {
    exigirAdministrador(request);
    const id = Number(request.params.id);
    const { perfiles } = validar(esquemaPerfiles, request.body);
    const ids = [...new Set(perfiles.map((p) => p.contribuyenteId))];
    if (ids.length) {
      const existentes = await db.select({ id: contribuyentes.id }).from(contribuyentes).where(inArray(contribuyentes.id, ids));
      if (existentes.length !== ids.length) throw new ErrorHttp(400, "DATOS_INVALIDOS", "Algún contribuyente no existe");
    }
    return db.transaction(async (tx) => {
      const anteriores = await tx.select().from(usuarioContribuyentePerfiles).where(eq(usuarioContribuyentePerfiles.usuarioId, id));
      await tx.delete(usuarioContribuyentePerfiles).where(eq(usuarioContribuyentePerfiles.usuarioId, id));
      if (perfiles.length) {
        await tx.insert(usuarioContribuyentePerfiles).values(perfiles.map((p) => ({ usuarioId: id, ...p }))).onConflictDoNothing();
      }
      await registrarAuditoria(
        tx,
        { entidad: "usuario", entidadId: id, accion: "PERFILES", valorAnterior: anteriores.map(({ contribuyenteId, perfil }) => ({ contribuyenteId, perfil })), valorNuevo: perfiles },
        request,
      );
      return { ok: true };
    });
  });

  app.post<{ Params: { id: string } }>("/:id/restablecer-password", async (request) => {
    exigirAdministrador(request);
    const id = Number(request.params.id);
    const datos = validar(z.object({ password }), request.body);
    const [fila] = await db.update(usuarios).set({ passwordHash: await hashPassword(datos.password), actualizadoEn: new Date() }).where(eq(usuarios.id, id)).returning({ id: usuarios.id });
    if (!fila) throw new ErrorHttp(404, "NO_ENCONTRADO", "Usuario inexistente");
    await db.delete(sesiones).where(eq(sesiones.usuarioId, id));
    await registrarAuditoria(db, { entidad: "usuario", entidadId: id, accion: "RESTABLECER_PASSWORD" }, request);
    return { ok: true };
  });

  /** Si el usuario perdió el celular: deberá configurar el segundo factor otra vez al ingresar. */
  app.post<{ Params: { id: string } }>("/:id/restablecer-2fa", async (request) => {
    exigirAdministrador(request);
    const id = Number(request.params.id);
    const [fila] = await db.update(usuarios).set({ totpActivo: false, totpSecretoCifrado: null, actualizadoEn: new Date() }).where(eq(usuarios.id, id)).returning({ id: usuarios.id });
    if (!fila) throw new ErrorHttp(404, "NO_ENCONTRADO", "Usuario inexistente");
    await db.delete(sesiones).where(eq(sesiones.usuarioId, id));
    await registrarAuditoria(db, { entidad: "usuario", entidadId: id, accion: "RESTABLECER_2FA" }, request);
    return { ok: true };
  });
}
