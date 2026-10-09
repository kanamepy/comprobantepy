/**
 * Lectura automática de imágenes y PDF escaneados (Fase 4): QR, OCR y controles de
 * calidad. Prioridad de fuentes: QR antes que OCR (sección 6.4).
 */
import {
  combinarExtracciones,
  esQrSifen,
  extraerDeQr,
  extraerDeTexto,
  resultadoVacio,
  type ResultadoExtraccion,
} from "@comprobantepy/shared";
import { evaluarCalidad, leerQr, prepararParaOcr } from "../archivos/imagen.js";
import { reconocerTexto } from "../archivos/ocr.js";
import { renderizarPaginas } from "../archivos/pdf.js";

export interface ResultadoLectura {
  extraccion: ResultadoExtraccion;
  estadoTecnico: "EXTRAIDO" | "ILEGIBLE" | "VALIDACION_PENDIENTE";
  confianzaOcr: number | null;
}

async function leerUnaImagen(imagen: Buffer): Promise<{ extraccion: ResultadoExtraccion; confianza: number; avisos: string[] }> {
  const avisos: string[] = [];
  const calidad = await evaluarCalidad(imagen);
  if (calidad.resolucionBaja) avisos.push("La imagen tiene baja resolución: si los datos salen mal, tomá otra foto más cerca");
  if (calidad.borrosa) avisos.push("La imagen parece borrosa: si los datos salen mal, tomá otra foto con buena luz y sin movimiento");

  let extraccion = resultadoVacio();
  const qr = await leerQr(imagen);
  if (qr && esQrSifen(qr)) extraccion = extraerDeQr(qr);

  const { texto, confianza } = await reconocerTexto(await prepararParaOcr(imagen));
  const deTexto = extraerDeTexto(texto, "OCR");
  // La confianza de cada campo combina la heurística con la del OCR.
  for (const campo of Object.values(deTexto.campos)) campo.confianza = Math.round(campo.confianza * Math.max(confianza, 0.3) * 100) / 100;
  if (calidad.borrosa || calidad.resolucionBaja) {
    for (const campo of Object.values(deTexto.campos)) campo.confianza = Math.min(campo.confianza, 0.5);
  }
  extraccion = combinarExtracciones(extraccion, deTexto);
  extraccion.advertencias = avisos;
  return { extraccion, confianza, avisos };
}

export async function leerImagen(contenido: Buffer): Promise<ResultadoLectura> {
  const { extraccion, confianza } = await leerUnaImagen(contenido);
  return resultado(extraccion, confianza);
}

export async function leerPdfEscaneado(contenido: Buffer): Promise<ResultadoLectura> {
  const paginas = await renderizarPaginas(contenido);
  let extraccion = resultadoVacio();
  let confianza = 0;
  for (const pagina of paginas) {
    const lectura = await leerUnaImagen(pagina);
    extraccion = combinarExtracciones(extraccion, lectura.extraccion);
    confianza = Math.max(confianza, lectura.confianza);
  }
  extraccion.advertencias = [...new Set(extraccion.advertencias)];
  return resultado(extraccion, confianza);
}

function resultado(extraccion: ResultadoExtraccion, confianza: number): ResultadoLectura {
  const camposUtiles = Object.keys(extraccion.campos).length;
  if (camposUtiles === 0) {
    extraccion.advertencias.push("No se pudo leer el documento: completá los datos a mano o cargá una imagen más clara");
    return { extraccion, estadoTecnico: "ILEGIBLE", confianzaOcr: confianza };
  }
  return { extraccion, estadoTecnico: extraccion.indicios.cdcValido ? "VALIDACION_PENDIENTE" : "EXTRAIDO", confianzaOcr: confianza };
}
