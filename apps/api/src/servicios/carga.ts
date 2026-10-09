/** Carga de archivos: verificación del tipo real, huella, almacenamiento y extracción automática (sección 6). */
import {
  extraerDeTexto,
  extraerDeXmlSifen,
  resultadoVacio,
  type NaturalezaFiscal,
  type ResultadoExtraccion,
} from "@comprobantepy/shared";
import { eq } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import type { Almacenamiento } from "../archivos/almacenamiento.js";
import { exigirArchivoLimpio } from "../archivos/antivirus.js";
import { sha256 } from "../archivos/almacenamiento.js";
import { extraerTextoPdf } from "../archivos/pdf.js";
import { detectarTipo, type TipoArchivo } from "../archivos/tipo.js";
import { ErrorHttp, type UsuarioSesion } from "../auth/sesiones.js";
import type { BaseDeDatos, Ejecutor } from "../db/conexion.js";
import { archivos, comprobanteArchivos } from "../db/esquema.js";
import { altaDesdeExtraccion, AVISO_LEYENDO, exigirVisible, type ResultadoAlta } from "./comprobantes.js";
import { encolarLectura } from "./trabajos.js";
import { comprobantes } from "../db/esquema.js";

export interface ArchivoRecibido {
  nombre: string;
  contenido: Buffer;
  canal: "CARGA" | "CAMARA" | "CORREO" | "EVIDENCIA";
}

export async function guardarArchivo(
  db: Ejecutor,
  almacenamiento: Almacenamiento,
  archivo: ArchivoRecibido,
  usuario: UsuarioSesion | null,
  tiposPermitidos: TipoArchivo[] = ["PDF", "XML", "IMAGEN"],
) {
  const tipo = detectarTipo(archivo.contenido);
  if (!tipo || !tiposPermitidos.includes(tipo.tipo)) {
    throw new ErrorHttp(415, "TIPO_NO_ADMITIDO", `${archivo.nombre}: formato no admitido (se aceptan PDF, XML e imágenes)`);
  }
  const huella = sha256(archivo.contenido);
  const [existente] = await db.select().from(archivos).where(eq(archivos.sha256, huella));
  if (existente) return { archivo: existente, nuevo: false, tipo };
  await exigirArchivoLimpio(archivo.contenido, archivo.nombre);
  const ruta = await almacenamiento.guardar(archivo.contenido, huella);
  const [creado] = await db
    .insert(archivos)
    .values({
      sha256: huella,
      nombreOriginal: archivo.nombre.slice(0, 255),
      tipoMime: tipo.mime,
      tipoDetectado: tipo.tipo,
      tamano: archivo.contenido.length,
      ruta,
      canal: archivo.canal,
      subidoPor: usuario?.id ?? null,
    })
    .onConflictDoNothing()
    .returning();
  if (creado) return { archivo: creado, nuevo: true, tipo };
  const [carrera] = await db.select().from(archivos).where(eq(archivos.sha256, huella));
  return { archivo: carrera!, nuevo: false, tipo };
}

/**
 * Elige automáticamente XML, texto digital u OCR (sección 6, RF-003). Las imágenes y los
 * PDF escaneados se leen en segundo plano (cola de trabajos): `requiereLectura`.
 */
export async function extraer(
  tipo: TipoArchivo,
  contenido: Buffer,
): Promise<{ extraccion: ResultadoExtraccion; estadoTecnico: string; requiereLectura: boolean }> {
  if (tipo === "XML") {
    const extraccion = extraerDeXmlSifen(contenido.toString("utf8"));
    // La verificación ante SIFEN queda pendiente (sección 11.5).
    return { extraccion, estadoTecnico: extraccion.indicios.xmlSifen ? "VALIDACION_PENDIENTE" : "XML_INVALIDO", requiereLectura: false };
  }
  if (tipo === "PDF") {
    try {
      const pdf = await extraerTextoPdf(contenido);
      if (!pdf.escaneado) {
        const extraccion = extraerDeTexto(pdf.texto);
        return { extraccion, estadoTecnico: extraccion.indicios.cdcValido ? "VALIDACION_PENDIENTE" : "EXTRAIDO", requiereLectura: false };
      }
    } catch {
      const extraccion = resultadoVacio();
      extraccion.advertencias.push("El PDF está protegido, dañado o no se pudo leer");
      return { extraccion, estadoTecnico: "ILEGIBLE", requiereLectura: false };
    }
  }
  // Imagen o PDF escaneado: OCR y QR en la cola.
  const extraccion = resultadoVacio();
  extraccion.advertencias.push(AVISO_LEYENDO);
  return { extraccion, estadoTecnico: "PROCESANDO", requiereLectura: true };
}

export interface OpcionesCarga {
  contribuyenteSugerido: number | null;
  naturalezaIndicada: NaturalezaFiscal | null;
  origen?: "WEB" | "CORREO";
}

export type ResultadoCarga = (ResultadoAlta & { nombre: string }) | { nombre: string; resultado: "ERROR"; error: string; comprobanteId?: undefined };

/** Procesa un archivo en su propia transacción: un archivo con error no afecta a los demás. */
export async function procesarArchivo(
  db: BaseDeDatos,
  almacenamiento: Almacenamiento,
  archivo: ArchivoRecibido,
  opciones: OpcionesCarga,
  usuario: UsuarioSesion,
  request?: FastifyRequest,
): Promise<ResultadoCarga> {
  try {
    return await db.transaction(async (tx) => {
      const { archivo: fila, tipo } = await guardarArchivo(tx, almacenamiento, archivo, usuario);
      // El mismo archivo ya registrado: no se reprocesa (sección 7.3, punto 5).
      const [vinculo] = await tx
        .select({ comprobanteId: comprobanteArchivos.comprobanteId, contribuyenteId: comprobantes.contribuyenteId })
        .from(comprobanteArchivos)
        .innerJoin(comprobantes, eq(comprobantes.id, comprobanteArchivos.comprobanteId))
        .where(eq(comprobanteArchivos.archivoId, fila.id))
        .limit(1);
      if (vinculo) {
        exigirVisible(usuario, vinculo);
        return { nombre: archivo.nombre, resultado: "YA_REGISTRADO" as const, comprobanteId: vinculo.comprobanteId, avisos: ["Este archivo ya se había cargado"] };
      }
      const { extraccion, estadoTecnico, requiereLectura } = await extraer(tipo.tipo, archivo.contenido);
      const alta = await altaDesdeExtraccion(tx, {
        extraccion,
        canal: archivo.canal === "CAMARA" ? "CAMARA" : archivo.canal === "CORREO" ? "CORREO" : "CARGA",
        estadoTecnico,
        archivoId: fila.id,
        contribuyenteSugerido: opciones.contribuyenteSugerido,
        naturalezaIndicada: opciones.naturalezaIndicada,
        usuario,
        request,
        origen: opciones.origen,
      });
      if (requiereLectura && alta.resultado === "CREADO") await encolarLectura(tx, alta.comprobanteId, fila.id);
      return { nombre: archivo.nombre, ...alta };
    });
  } catch (error) {
    // Sin antivirus disponible no se acepta nada: el correo queda en ERROR y se reintenta.
    if (error instanceof ErrorHttp && error.codigo !== "ANTIVIRUS_NO_DISPONIBLE") return { nombre: archivo.nombre, resultado: "ERROR", error: error.message };
    throw error;
  }
}
