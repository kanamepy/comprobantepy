/** Cola de trabajos de lectura (OCR y QR) con reintentos. */
import { and, eq, sql } from "drizzle-orm";
import type { Almacenamiento } from "../archivos/almacenamiento.js";
import type { BaseDeDatos, Ejecutor } from "../db/conexion.js";
import { archivos, trabajos } from "../db/esquema.js";
import { aplicarLectura } from "./comprobantes.js";
import { leerImagen, leerPdfEscaneado } from "./lectura.js";

const MAXIMO_INTENTOS = 3;

export async function encolarLectura(db: Ejecutor, comprobanteId: number, archivoId: number) {
  const [existente] = await db
    .select({ id: trabajos.id })
    .from(trabajos)
    .where(and(eq(trabajos.archivoId, archivoId), eq(trabajos.comprobanteId, comprobanteId), sql`${trabajos.estado} IN ('PENDIENTE', 'EN_CURSO')`));
  if (existente) return existente.id;
  const [creado] = await db.insert(trabajos).values({ tipo: "LECTURA", comprobanteId, archivoId }).returning({ id: trabajos.id });
  return creado!.id;
}

/** Toma el siguiente trabajo disponible; dos procesos nunca toman el mismo. */
async function tomarSiguiente(db: BaseDeDatos) {
  const { rows } = await db.execute<{ id: number; comprobante_id: number; archivo_id: number; intentos: number }>(sql`
    UPDATE trabajos SET estado = 'EN_CURSO', intentos = intentos + 1, actualizado_en = now()
    WHERE id = (
      SELECT id FROM trabajos
      WHERE (estado = 'PENDIENTE' AND disponible_en <= now())
         OR (estado = 'EN_CURSO' AND actualizado_en < now() - interval '15 minutes')
      ORDER BY id
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, comprobante_id, archivo_id, intentos`);
  return rows[0] ?? null;
}

/** Procesa un trabajo de la cola; devuelve false si no había ninguno. */
export async function procesarSiguienteTrabajo(db: BaseDeDatos, almacenamiento: Almacenamiento): Promise<boolean> {
  const trabajo = await tomarSiguiente(db);
  if (!trabajo) return false;
  try {
    const [archivo] = await db.select().from(archivos).where(eq(archivos.id, trabajo.archivo_id));
    if (!archivo) throw new Error("Archivo inexistente");
    const contenido = await almacenamiento.leer(archivo.ruta);
    const lectura = archivo.tipoDetectado === "PDF" ? await leerPdfEscaneado(contenido) : await leerImagen(contenido);
    await db.transaction((tx) => aplicarLectura(tx, trabajo.comprobante_id, lectura.extraccion, lectura.estadoTecnico));
    await db.update(trabajos).set({ estado: "HECHO", error: null, actualizadoEn: new Date() }).where(eq(trabajos.id, trabajo.id));
  } catch (error) {
    const mensaje = (error as Error).message;
    const agotado = trabajo.intentos >= MAXIMO_INTENTOS;
    await db
      .update(trabajos)
      .set({
        estado: agotado ? "ERROR" : "PENDIENTE",
        error: mensaje,
        disponibleEn: new Date(Date.now() + trabajo.intentos * 60_000),
        actualizadoEn: new Date(),
      })
      .where(eq(trabajos.id, trabajo.id));
    if (agotado) {
      await db.transaction((tx) => aplicarLectura(tx, trabajo.comprobante_id, null, "ILEGIBLE", `No se pudo leer el archivo: ${mensaje}`));
    }
  }
  return true;
}

/** Procesa todos los trabajos pendientes (útil en pruebas y al iniciar el trabajador). */
export async function vaciarCola(db: BaseDeDatos, almacenamiento: Almacenamiento) {
  let procesados = 0;
  while (await procesarSiguienteTrabajo(db, almacenamiento)) procesados++;
  return procesados;
}
