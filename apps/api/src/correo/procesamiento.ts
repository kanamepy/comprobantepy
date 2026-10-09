/**
 * Procesamiento de mensajes de correo (secciones 7.2 y 7.3): idempotente, con control
 * de remitentes habilitados, adjuntos procesados por separado y relación correo–archivo.
 */
import { and, eq, ne, sql } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import { sha256, type Almacenamiento } from "../archivos/almacenamiento.js";
import { registrarAuditoria } from "../auditoria.js";
import { cargarUsuario, ErrorHttp, type UsuarioSesion } from "../auth/sesiones.js";
import type { BaseDeDatos } from "../db/conexion.js";
import { archivos, buzones, mensajeArchivos, mensajesCorreo } from "../db/esquema.js";
import { procesarArchivo, type ResultadoCarga } from "../servicios/carga.js";
import { analizarMensaje, type MensajeAnalizado } from "./analisis.js";

export type FilaBuzon = typeof buzones.$inferSelect;
export type FilaMensaje = typeof mensajesCorreo.$inferSelect;
export type EstadoMensaje = FilaMensaje["estado"];

export interface EntradaMensaje {
  crudo: Buffer;
  buzon: FilaBuzon | null;
  /** Id del mensaje en el proveedor; para un .eml cargado a mano, su huella. */
  idProveedor: string;
  canal: "BUZON" | "EML_MANUAL";
}

export interface ResultadoMensaje {
  mensaje: FilaMensaje;
  nuevo: boolean;
}

/** Direcciones desde las que se aceptan reenvíos al buzón central (sección 7.2). */
async function direccionesHabilitadas(db: BaseDeDatos): Promise<Set<string>> {
  const filas = await db.select({ direccion: buzones.direccion }).from(buzones).where(ne(buzones.estado, "BAJA"));
  return new Set(filas.map((f) => f.direccion.toLowerCase()));
}

/** Usuario en nombre del cual se registran los comprobantes que llegan por correo. */
async function usuarioDelBuzon(db: BaseDeDatos, buzon: FilaBuzon | null, porDefecto?: UsuarioSesion): Promise<UsuarioSesion> {
  if (porDefecto) return porDefecto;
  const usuario = buzon ? await cargarUsuario(db, buzon.creadoPor) : null;
  if (!usuario) throw new ErrorHttp(409, "SIN_USUARIO", "El usuario que configuró el buzón ya no está activo");
  return usuario;
}

function estadoSegun(resultados: ResultadoCarga[], adjuntosValidos: number): EstadoMensaje {
  if (adjuntosValidos === 0) return "SIN_ADJUNTOS";
  if (resultados.some((r) => r.resultado === "ERROR")) return "OBSERVADO";
  if (resultados.every((r) => r.resultado === "YA_REGISTRADO" || r.resultado === "ASOCIADO")) return "DUPLICADO";
  return "PROCESADO";
}

async function procesarAdjuntos(
  db: BaseDeDatos,
  almacenamiento: Almacenamiento,
  analisis: MensajeAnalizado,
  buzon: FilaBuzon | null,
  mensajeId: number,
  usuario: UsuarioSesion,
) {
  const resultados: ResultadoCarga[] = [];
  for (const adjunto of analisis.adjuntos) {
    const resultado = await procesarArchivo(
      db,
      almacenamiento,
      { nombre: adjunto.nombre, contenido: adjunto.contenido, canal: "CORREO" },
      { contribuyenteSugerido: buzon?.contribuyenteSugeridoId ?? null, naturalezaIndicada: null, origen: "CORREO" },
      usuario,
    );
    resultados.push(resultado);
    // El correo queda como evidencia del archivo, aunque el archivo ya estuviera registrado.
    const [archivo] = await db.select({ id: archivos.id }).from(archivos).where(eq(archivos.sha256, sha256(adjunto.contenido)));
    if (archivo) await db.insert(mensajeArchivos).values({ mensajeId, archivoId: archivo.id }).onConflictDoNothing();
  }
  return resultados;
}

function detalleDe(analisis: MensajeAnalizado, resultados: ResultadoCarga[]) {
  return [
    ...resultados.map((r) => ({
      nombre: r.nombre,
      resultado: r.resultado,
      comprobanteId: r.comprobanteId ?? null,
      avisos: "avisos" in r ? r.avisos : [],
      error: "error" in r ? r.error : undefined,
    })),
    ...analisis.ignorados.map((i) => ({ nombre: i.nombre, resultado: "IGNORADO", comprobanteId: null, avisos: [i.motivo] })),
  ];
}

/**
 * Registra y procesa un mensaje una sola vez: si ya existe (mismo buzón e id), no se
 * reprocesa (criterio 13). Un correo sin adjuntos válidos no crea comprobantes (criterio 12).
 */
export async function registrarYProcesar(
  db: BaseDeDatos,
  almacenamiento: Almacenamiento,
  entrada: EntradaMensaje,
  usuarioAccion?: UsuarioSesion,
): Promise<ResultadoMensaje> {
  const [existente] = await db
    .select()
    .from(mensajesCorreo)
    .where(and(sql`coalesce(${mensajesCorreo.buzonId}, 0) = ${entrada.buzon?.id ?? 0}`, eq(mensajesCorreo.idProveedor, entrada.idProveedor)));
  if (existente) {
    // Un mensaje que falló (por ejemplo, antivirus caído) se vuelve a procesar en la próxima lectura.
    if (existente.estado === "ERROR" && existente.rutaOriginal) {
      return { mensaje: await reprocesar(db, almacenamiento, existente, usuarioAccion), nuevo: false };
    }
    return { mensaje: existente, nuevo: false };
  }

  const analisis = await analizarMensaje(entrada.crudo);
  const rutaOriginal = await almacenamiento.guardar(entrada.crudo, sha256(entrada.crudo));

  // Reenvíos al buzón central solo desde direcciones registradas (criterio 10).
  let estadoInicial: EstadoMensaje | null = null;
  if (entrada.canal === "BUZON" && entrada.buzon?.rol === "CENTRAL" && analisis.esReenvio) {
    const habilitadas = await direccionesHabilitadas(db);
    if (!analisis.reenviadoPor || !habilitadas.has(analisis.reenviadoPor)) estadoInicial = "REMITENTE_NO_HABILITADO";
  }

  const [fila] = await db
    .insert(mensajesCorreo)
    .values({
      buzonId: entrada.buzon?.id ?? null,
      idProveedor: entrada.idProveedor,
      messageId: analisis.messageId,
      remitenteOriginal: analisis.remitenteOriginal,
      reenviadoPor: analisis.reenviadoPor,
      destinatario: analisis.para,
      asunto: analisis.asunto?.slice(0, 500) ?? null,
      fecha: analisis.fecha,
      canal: entrada.canal,
      estado: estadoInicial ?? "ERROR",
      rutaOriginal,
      detalle: analisis.ignorados.map((i) => ({ nombre: i.nombre, resultado: "IGNORADO", comprobanteId: null, avisos: [i.motivo] })),
    })
    .onConflictDoNothing()
    .returning();
  if (!fila) {
    // Otro proceso lo registró al mismo tiempo.
    const [otro] = await db
      .select()
      .from(mensajesCorreo)
      .where(and(sql`coalesce(${mensajesCorreo.buzonId}, 0) = ${entrada.buzon?.id ?? 0}`, eq(mensajesCorreo.idProveedor, entrada.idProveedor)));
    return { mensaje: otro!, nuevo: false };
  }
  if (estadoInicial) return { mensaje: fila, nuevo: true };

  return { mensaje: await procesarFila(db, almacenamiento, fila, analisis, entrada.buzon, await usuarioDelBuzon(db, entrada.buzon, usuarioAccion)), nuevo: true };
}

async function procesarFila(
  db: BaseDeDatos,
  almacenamiento: Almacenamiento,
  fila: FilaMensaje,
  analisis: MensajeAnalizado,
  buzon: FilaBuzon | null,
  usuario: UsuarioSesion,
) {
  let resultados: ResultadoCarga[];
  let estado: EstadoMensaje;
  try {
    resultados = await procesarAdjuntos(db, almacenamiento, analisis, buzon, fila.id, usuario);
    estado = estadoSegun(resultados, analisis.adjuntos.length);
  } catch (error) {
    await db
      .update(mensajesCorreo)
      .set({ estado: "ERROR", detalle: [{ nombre: "(mensaje)", resultado: "ERROR", comprobanteId: null, avisos: [], error: (error as Error).message }] })
      .where(eq(mensajesCorreo.id, fila.id));
    throw error;
  }
  const [actualizada] = await db
    .update(mensajesCorreo)
    .set({ estado, detalle: detalleDe(analisis, resultados) })
    .where(eq(mensajesCorreo.id, fila.id))
    .returning();
  return actualizada!;
}

async function reprocesar(db: BaseDeDatos, almacenamiento: Almacenamiento, fila: FilaMensaje, usuarioAccion?: UsuarioSesion) {
  const [buzon] = fila.buzonId ? await db.select().from(buzones).where(eq(buzones.id, fila.buzonId)) : [];
  const analisis = await analizarMensaje(await almacenamiento.leer(fila.rutaOriginal!));
  return procesarFila(db, almacenamiento, fila, analisis, buzon ?? null, await usuarioDelBuzon(db, buzon ?? null, usuarioAccion));
}

/** Reintenta a mano un mensaje que quedó con error. */
export async function reintentarMensaje(db: BaseDeDatos, almacenamiento: Almacenamiento, id: number, usuario: UsuarioSesion, request?: FastifyRequest) {
  const [fila] = await db.select().from(mensajesCorreo).where(eq(mensajesCorreo.id, id));
  if (!fila) throw new ErrorHttp(404, "NO_ENCONTRADO", "Mensaje inexistente");
  if (fila.estado !== "ERROR") throw new ErrorHttp(409, "ESTADO_INVALIDO", "Solo se reintentan los mensajes con error");
  if (!fila.rutaOriginal) throw new ErrorHttp(409, "SIN_ORIGINAL", "No se conservó el mensaje original");
  await registrarAuditoria(db, { entidad: "mensaje_correo", entidadId: id, accion: "REINTENTAR" }, request);
  return reprocesar(db, almacenamiento, fila, usuario);
}

/** Acepta un mensaje en revisión (remitente no habilitado) y lo procesa; opcionalmente habilita al remitente. */
export async function aceptarMensaje(
  db: BaseDeDatos,
  almacenamiento: Almacenamiento,
  id: number,
  opciones: { habilitarRemitente: boolean; titular?: string },
  usuario: UsuarioSesion,
  request?: FastifyRequest,
) {
  const [fila] = await db.select().from(mensajesCorreo).where(eq(mensajesCorreo.id, id));
  if (!fila) throw new ErrorHttp(404, "NO_ENCONTRADO", "Mensaje inexistente");
  if (fila.estado !== "REMITENTE_NO_HABILITADO") throw new ErrorHttp(409, "ESTADO_INVALIDO", "El mensaje no está en revisión");
  if (!fila.rutaOriginal) throw new ErrorHttp(409, "SIN_ORIGINAL", "No se conservó el mensaje original");
  const [buzon] = fila.buzonId ? await db.select().from(buzones).where(eq(buzones.id, fila.buzonId)) : [];
  const analisis = await analizarMensaje(await almacenamiento.leer(fila.rutaOriginal));

  if (opciones.habilitarRemitente && fila.reenviadoPor) {
    await db
      .insert(buzones)
      .values({
        direccion: fila.reenviadoPor,
        rol: "ORIGEN",
        mecanismo: "REENVIO",
        titular: opciones.titular?.trim() || fila.reenviadoPor,
        estado: "ACTIVO",
        creadoPor: usuario.id,
      })
      .onConflictDoNothing();
  }
  await registrarAuditoria(db, {
    entidad: "mensaje_correo",
    entidadId: id,
    accion: "ACEPTAR_REMITENTE",
    valorNuevo: { reenviadoPor: fila.reenviadoPor, habilitado: opciones.habilitarRemitente },
  }, request);
  const actualizada = await procesarFila(db, almacenamiento, fila, analisis, buzon ?? null, usuario);
  await db.update(mensajesCorreo).set({ resueltoPor: usuario.id, resueltoEn: new Date() }).where(eq(mensajesCorreo.id, id));
  return actualizada;
}

export async function descartarMensaje(db: BaseDeDatos, id: number, motivo: string, usuario: UsuarioSesion, request?: FastifyRequest) {
  const [fila] = await db
    .update(mensajesCorreo)
    .set({ estado: "DESCARTADO", resueltoPor: usuario.id, resueltoEn: new Date() })
    .where(and(eq(mensajesCorreo.id, id), sql`${mensajesCorreo.estado} IN ('REMITENTE_NO_HABILITADO', 'SIN_ADJUNTOS', 'ERROR', 'OBSERVADO')`))
    .returning();
  if (!fila) throw new ErrorHttp(409, "ESTADO_INVALIDO", "El mensaje no se puede descartar");
  await registrarAuditoria(db, { entidad: "mensaje_correo", entidadId: id, accion: "DESCARTAR", motivo }, request);
  return fila;
}
