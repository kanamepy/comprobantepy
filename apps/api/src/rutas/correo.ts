import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { sha256, type Almacenamiento } from "../archivos/almacenamiento.js";
import { registrarAuditoria } from "../auditoria.js";
import { ErrorHttp, exigirSesion } from "../auth/sesiones.js";
import { cifrar, descifrar } from "../cifrado.js";
import { config } from "../config.js";
import { canjearCodigo, googleConfigurado, revocarToken, urlAutorizacion } from "../correo/gmail.js";
import { aceptarMensaje, descartarMensaje, registrarYProcesar, reintentarMensaje } from "../correo/procesamiento.js";
import { sondearBuzon, type FabricaAdaptador, fabricaGmail } from "../correo/sondeo.js";
import type { BaseDeDatos } from "../db/conexion.js";
import { alertas, buzones, contribuyentes, mensajesCorreo } from "../db/esquema.js";
import { puedeVerPendientes } from "../servicios/comprobantes.js";
import { comoSistema } from "../db/contexto.js";
import { validar } from "../validacion.js";

const esquemaBuzon = z.object({
  direccion: z.string().trim().toLowerCase().email("Correo inválido"),
  rol: z.enum(["CENTRAL", "ORIGEN"]),
  mecanismo: z.enum(["GMAIL_API", "REENVIO"]),
  titular: z.string().trim().min(2, "Indicá el titular").max(200),
  contribuyenteSugeridoId: z.number().int().positive().nullable().optional(),
  filtro: z.string().trim().max(200).nullable().optional(),
  autorizacionFecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida"),
  autorizacionForma: z.string().trim().min(2, "Indicá cómo autorizó el titular").max(200),
});

/** Sin "Gmail API" en un buzón de origen se exige el filtro: nunca se lee el buzón personal completo. */
const esquemaBuzonValidado = esquemaBuzon.superRefine((b, ctx) => {
  if (b.rol === "CENTRAL" && b.mecanismo !== "GMAIL_API") {
    ctx.addIssue({ code: "custom", path: ["mecanismo"], message: "El buzón central se conecta con Gmail API" });
  }
  if (b.rol === "ORIGEN" && b.mecanismo === "GMAIL_API" && !b.filtro?.trim()) {
    ctx.addIssue({ code: "custom", path: ["filtro"], message: "En un buzón personal indicá la etiqueta a leer, por ejemplo label:Comprobantes" });
  }
});

function firmarEstado(buzonId: number) {
  const vence = Date.now() + 15 * 60 * 1000;
  const datos = `${buzonId}.${vence}.${randomBytes(8).toString("hex")}`;
  const firma = createHmac("sha256", config.claveCifrado).update(datos).digest("base64url");
  return `${datos}.${firma}`;
}

function verificarEstado(estado: string): number {
  const partes = estado.split(".");
  if (partes.length !== 4) throw new ErrorHttp(400, "ESTADO_INVALIDO", "Respuesta de Google inválida");
  const datos = partes.slice(0, 3).join(".");
  const esperada = createHmac("sha256", config.claveCifrado).update(datos).digest();
  const recibida = Buffer.from(partes[3]!, "base64url");
  if (recibida.length !== esperada.length || !timingSafeEqual(recibida, esperada) || Number(partes[1]) < Date.now()) {
    throw new ErrorHttp(400, "ESTADO_INVALIDO", "La autorización venció; volvé a intentarlo");
  }
  return Number(partes[0]);
}

export interface OpcionesCorreo {
  db: BaseDeDatos;
  almacenamiento: Almacenamiento;
  /** Permite reemplazar Gmail en las pruebas. */
  fabricaAdaptador?: FabricaAdaptador;
}

export async function rutasCorreo(app: FastifyInstance, { db, almacenamiento, fabricaAdaptador = fabricaGmail }: OpcionesCorreo) {
  app.addHook("preHandler", exigirSesion);

  const exigirConfiguracion = (request: FastifyRequest) => {
    const u = request.usuario!;
    if (!u.esAdministrador && !u.perfiles.some((p) => p.perfil === "FINANCIERO")) {
      throw new ErrorHttp(403, "SIN_PERMISO", "Solo el administrador o el perfil Financiero configuran el correo");
    }
  };
  const exigirLectura = (request: FastifyRequest) => {
    if (!puedeVerPendientes(request.usuario!)) throw new ErrorHttp(403, "SIN_PERMISO", "Tu perfil no permite ver los correos");
  };

  app.get("/estado", async (request) => {
    exigirLectura(request);
    const lista = await db
      .select({ buzon: buzones, contribuyente: contribuyentes.nombre })
      .from(buzones)
      .leftJoin(contribuyentes, eq(contribuyentes.id, buzones.contribuyenteSugeridoId))
      .where(ne(buzones.estado, "BAJA"))
      .orderBy(buzones.rol, buzones.direccion);
    const abiertas = await db.select().from(alertas).where(isNull(alertas.resueltaEn)).orderBy(desc(alertas.id));
    const conteo = await db
      .select({ estado: mensajesCorreo.estado, cantidad: sql<number>`count(*)::int` })
      .from(mensajesCorreo)
      .groupBy(mensajesCorreo.estado);
    return {
      googleConfigurado: googleConfigurado(),
      urlRetorno: `${config.urlPublica}/api/correo/oauth/callback`,
      buzones: lista.map(({ buzon: { credencialCifrada, ...b }, contribuyente }) => ({ ...b, conectado: Boolean(credencialCifrada), contribuyenteSugerido: contribuyente })),
      alertas: abiertas,
      mensajesPorEstado: Object.fromEntries(conteo.map((c) => [c.estado, c.cantidad])),
    };
  });

  app.post("/buzones", async (request, reply) => {
    exigirConfiguracion(request);
    const datos = validar(esquemaBuzonValidado, request.body);
    if (datos.rol === "CENTRAL") {
      const [central] = await db.select({ id: buzones.id }).from(buzones).where(and(eq(buzones.rol, "CENTRAL"), ne(buzones.estado, "BAJA")));
      if (central) throw new ErrorHttp(409, "CENTRAL_EXISTENTE", "Ya hay un buzón central; dalo de baja antes de registrar otro");
    }
    const [existente] = await db
      .select({ id: buzones.id })
      .from(buzones)
      .where(and(sql`lower(${buzones.direccion}) = ${datos.direccion}`, ne(buzones.estado, "BAJA")));
    if (existente) throw new ErrorHttp(409, "BUZON_EXISTENTE", "Esa dirección ya está registrada");
    const [creado] = await db
      .insert(buzones)
      .values({
        ...datos,
        contribuyenteSugeridoId: datos.contribuyenteSugeridoId ?? null,
        filtro: datos.filtro || null,
        // Un buzón de reenvío no se conecta: queda activo como remitente habilitado.
        estado: datos.mecanismo === "REENVIO" ? "ACTIVO" : "PENDIENTE_CONEXION",
        creadoPor: request.usuario!.id,
      })
      .returning();
    await registrarAuditoria(db, { entidad: "buzon", entidadId: creado!.id, accion: "CREAR", valorNuevo: { ...creado, credencialCifrada: undefined } }, request);
    reply.code(201);
    const { credencialCifrada: _c, ...publico } = creado!;
    return publico;
  });

  app.patch<{ Params: { id: string } }>("/buzones/:id", async (request) => {
    exigirConfiguracion(request);
    const cambios = validar(
      z.object({ filtro: z.string().trim().max(200).nullable(), contribuyenteSugeridoId: z.number().int().positive().nullable(), titular: z.string().trim().min(2).max(200) }).partial(),
      request.body,
    );
    const [actualizado] = await db
      .update(buzones)
      .set({ ...cambios, actualizadoEn: new Date() })
      .where(eq(buzones.id, Number(request.params.id)))
      .returning({ id: buzones.id });
    if (!actualizado) throw new ErrorHttp(404, "NO_ENCONTRADO", "Buzón inexistente");
    await registrarAuditoria(db, { entidad: "buzon", entidadId: actualizado.id, accion: "EDITAR", valorNuevo: cambios }, request);
    return { ok: true };
  });

  /** Baja: revoca el permiso y deja de leer, sin afectar los comprobantes ya registrados (sección 7.2). */
  app.post<{ Params: { id: string } }>("/buzones/:id/baja", async (request) => {
    exigirConfiguracion(request);
    const { motivo } = validar(z.object({ motivo: z.string().trim().min(3, "Indicá el motivo").max(500) }), request.body);
    const [buzon] = await db.select().from(buzones).where(eq(buzones.id, Number(request.params.id)));
    if (!buzon) throw new ErrorHttp(404, "NO_ENCONTRADO", "Buzón inexistente");
    if (buzon.credencialCifrada && googleConfigurado()) await revocarToken(descifrar(buzon.credencialCifrada));
    await db.update(buzones).set({ estado: "BAJA", credencialCifrada: null, bajaMotivo: motivo, actualizadoEn: new Date() }).where(eq(buzones.id, buzon.id));
    await db.update(alertas).set({ resueltaEn: new Date() }).where(and(eq(alertas.buzonId, buzon.id), isNull(alertas.resueltaEn)));
    await registrarAuditoria(db, { entidad: "buzon", entidadId: buzon.id, accion: "BAJA", motivo }, request);
    return { ok: true };
  });

  /** Inicia la autorización con Google para un buzón (OAuth 2.0; la contraseña nunca pasa por la aplicación). */
  app.get<{ Params: { id: string } }>("/buzones/:id/conectar", async (request) => {
    exigirConfiguracion(request);
    if (!googleConfigurado()) throw new ErrorHttp(409, "GOOGLE_NO_CONFIGURADO", "Falta configurar el acceso a Google (ver README)");
    const [buzon] = await db.select().from(buzones).where(eq(buzones.id, Number(request.params.id)));
    if (!buzon || buzon.mecanismo !== "GMAIL_API") throw new ErrorHttp(404, "NO_ENCONTRADO", "Buzón inexistente");
    return { url: urlAutorizacion(firmarEstado(buzon.id), buzon.direccion) };
  });

  app.get("/oauth/callback", async (request, reply) => {
    exigirConfiguracion(request);
    const { code, state, error } = request.query as { code?: string; state?: string; error?: string };
    const volver = (resultado: string) => reply.redirect(`/correo?resultado=${encodeURIComponent(resultado)}`);
    if (error || !code || !state) return volver(error === "access_denied" ? "Se canceló la autorización" : "Google no autorizó el acceso");
    const buzonId = verificarEstado(state);
    const [buzon] = await db.select().from(buzones).where(eq(buzones.id, buzonId));
    if (!buzon) return volver("Buzón inexistente");
    try {
      const { refreshToken, direccion } = await canjearCodigo(code);
      if (direccion !== buzon.direccion.toLowerCase()) {
        await revocarToken(refreshToken);
        return volver(`Autorizaste ${direccion}, pero el buzón registrado es ${buzon.direccion}`);
      }
      await db
        .update(buzones)
        .set({ credencialCifrada: cifrar(refreshToken), estado: "ACTIVO", ultimoError: null, actualizadoEn: new Date() })
        .where(eq(buzones.id, buzon.id));
      await db.update(alertas).set({ resueltaEn: new Date() }).where(and(eq(alertas.buzonId, buzon.id), isNull(alertas.resueltaEn)));
      await registrarAuditoria(db, { entidad: "buzon", entidadId: buzon.id, accion: "CONECTAR_GMAIL" }, request);
      return volver("conectado");
    } catch (err) {
      return volver(`No se pudo conectar: ${(err as Error).message}`);
    }
  });

  /** Lee el buzón ahora, sin esperar al proceso periódico. */
  app.post<{ Params: { id: string } }>("/buzones/:id/sondear", async (request) => {
    exigirConfiguracion(request);
    const [buzon] = await db.select().from(buzones).where(eq(buzones.id, Number(request.params.id)));
    if (!buzon || !buzon.credencialCifrada) throw new ErrorHttp(409, "SIN_CONEXION", "El buzón no está conectado");
    // El correo se procesa como proceso del sistema, igual que en el trabajador.
    return comoSistema(() => sondearBuzon(db, almacenamiento, buzon, fabricaAdaptador));
  });

  app.get("/mensajes", async (request) => {
    exigirLectura(request);
    const { estado, contribuyenteId } = validar(z.object({ estado: z.string().optional(), contribuyenteId: z.coerce.number().int().positive().optional() }), request.query);
    const estados = estado ? estado.split(",") : undefined;
    const filas = await db
      .select({ mensaje: mensajesCorreo, buzon: buzones.direccion })
      .from(mensajesCorreo)
      .leftJoin(buzones, eq(buzones.id, mensajesCorreo.buzonId))
      .where(
        and(
          estados ? inArray(mensajesCorreo.estado, estados as (typeof mensajesCorreo.$inferSelect.estado)[]) : undefined,
          // Con un contribuyente elegido: los correos que trajeron comprobantes suyos.
          contribuyenteId
            ? sql`EXISTS (SELECT 1 FROM mensaje_archivos ma JOIN comprobante_archivos ca ON ca.archivo_id = ma.archivo_id JOIN comprobantes c ON c.id = ca.comprobante_id WHERE ma.mensaje_id = ${mensajesCorreo.id} AND c.contribuyente_id = ${contribuyenteId})`
            : undefined,
        ),
      )
      .orderBy(desc(mensajesCorreo.id))
      .limit(300);
    return filas.map(({ mensaje: { rutaOriginal: _r, ...m }, buzon }) => ({ ...m, buzon }));
  });

  app.post<{ Params: { id: string } }>("/mensajes/:id/aceptar", async (request) => {
    exigirConfiguracion(request);
    const opciones = validar(z.object({ habilitarRemitente: z.boolean().default(false), titular: z.string().trim().max(200).optional() }), request.body ?? {});
    return comoSistema(() => aceptarMensaje(db, almacenamiento, Number(request.params.id), opciones, request.usuario!, request));
  });

  app.post<{ Params: { id: string } }>("/mensajes/:id/reintentar", async (request) => {
    exigirConfiguracion(request);
    const fila = await comoSistema(() => reintentarMensaje(db, almacenamiento, Number(request.params.id), request.usuario!, request));
    const { rutaOriginal: _r, ...publico } = fila;
    return publico;
  });

  app.post<{ Params: { id: string } }>("/mensajes/:id/descartar", async (request) => {
    exigirConfiguracion(request);
    const { motivo } = validar(z.object({ motivo: z.string().trim().min(3, "Indicá el motivo").max(500) }), request.body);
    return descartarMensaje(db, Number(request.params.id), motivo, request.usuario!, request);
  });

  /** Carga manual de correos guardados como .eml (reenvío manual, sección 7.2). */
  app.post("/eml", async (request) => {
    exigirLectura(request);
    const resultados = [];
    for await (const parte of request.files()) {
      const contenido = await parte.toBuffer();
      const texto = contenido.subarray(0, 4096).toString("utf8");
      if (!/^(received|from|date|subject|message-id|mime-version|return-path|delivered-to|x-[\w-]+):/im.test(texto)) {
        resultados.push({ nombre: parte.filename, error: "No parece un correo guardado (.eml)" });
        continue;
      }
      const { mensaje, nuevo } = await comoSistema(() =>
        registrarYProcesar(
          db,
          almacenamiento,
          { crudo: contenido, buzon: null, idProveedor: `eml:${sha256(contenido)}`, canal: "EML_MANUAL" },
          request.usuario!,
        ),
      );
      const { rutaOriginal: _r, ...publico } = mensaje;
      resultados.push({ nombre: parte.filename, nuevo, mensaje: publico });
    }
    return { resultados };
  });
}
