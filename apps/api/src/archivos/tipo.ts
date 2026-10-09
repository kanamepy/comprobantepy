/** Detección del tipo real del archivo por su contenido, no por la extensión (sección 6.1). */

export type TipoArchivo = "PDF" | "XML" | "IMAGEN";

export interface TipoDetectado {
  tipo: TipoArchivo;
  mime: string;
}

export function detectarTipo(contenido: Buffer): TipoDetectado | null {
  const inicio = contenido.subarray(0, 16);
  if (inicio.subarray(0, 5).toString("latin1") === "%PDF-") return { tipo: "PDF", mime: "application/pdf" };
  if (inicio.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { tipo: "IMAGEN", mime: "image/png" };
  }
  if (inicio[0] === 0xff && inicio[1] === 0xd8 && inicio[2] === 0xff) return { tipo: "IMAGEN", mime: "image/jpeg" };
  const cabecera = inicio.subarray(0, 4).toString("latin1");
  if (cabecera === "II*\u0000" || cabecera === "MM\u0000*") return { tipo: "IMAGEN", mime: "image/tiff" };
  if (cabecera === "RIFF" && inicio.subarray(8, 12).toString("latin1") === "WEBP") return { tipo: "IMAGEN", mime: "image/webp" };
  if (/^(ftypheic|ftypheix|ftypmif1)/.test(inicio.subarray(4, 12).toString("latin1"))) {
    return { tipo: "IMAGEN", mime: "image/heic" };
  }
  // XML: texto que empieza con "<" (admite BOM y espacios iniciales).
  const textoInicial = contenido.subarray(0, 512).toString("utf8").replace(/^﻿/, "").trimStart();
  if (textoInicial.startsWith("<?xml") || /^<[A-Za-z]/.test(textoInicial)) {
    if (!contenido.subarray(0, 4096).includes(0)) return { tipo: "XML", mime: "application/xml" };
  }
  return null;
}
