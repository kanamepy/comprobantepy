/**
 * Mide la exactitud de la lectura automática con comprobantes reales (sección 21.3).
 *
 * Uso: npm run medir-lectura -- carpeta/con/muestras
 *
 * Por cada imagen o PDF (factura1.jpg) se espera un archivo con los valores correctos y el
 * mismo nombre (factura1.json), por ejemplo:
 *   { "timbrado": "12345678", "numero": "001-001-0000123", "fechaEmision": "2026-03-05", "total": "110000", "emisorRuc": "80012345" }
 */
import { UMBRAL_CONFIANZA, extraerDeTexto, type CamposExtraidos } from "@comprobantepy/shared";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { extraerTextoPdf } from "../archivos/pdf.js";
import { cerrarOcr } from "../archivos/ocr.js";
import { leerImagen, leerPdfEscaneado } from "../servicios/lectura.js";

const carpeta = process.argv[2];
if (!carpeta || !existsSync(carpeta)) {
  console.error("Uso: npm run medir-lectura -- carpeta/con/muestras");
  process.exit(1);
}

const estadisticas = new Map<string, { total: number; correctos: number; erroresSinMarcar: number }>();
let archivos = 0;
const inicio = Date.now();

for (const nombre of readdirSync(carpeta).sort()) {
  const extension = extname(nombre).toLowerCase();
  if (![".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".pdf"].includes(extension)) continue;
  const rutaEsperado = join(carpeta, `${basename(nombre, extension)}.json`);
  if (!existsSync(rutaEsperado)) {
    console.warn(`(sin ${basename(rutaEsperado)}: se omite ${nombre})`);
    continue;
  }
  const esperado = JSON.parse(readFileSync(rutaEsperado, "utf8")) as Record<string, string>;
  const contenido = readFileSync(join(carpeta, nombre));
  let campos: CamposExtraidos;
  if (extension === ".pdf") {
    const texto = await extraerTextoPdf(contenido);
    campos = texto.escaneado ? (await leerPdfEscaneado(contenido)).extraccion.campos : extraerDeTexto(texto.texto).campos;
  } else {
    campos = (await leerImagen(contenido)).extraccion.campos;
  }
  archivos++;
  const fallas: string[] = [];
  for (const [campo, valorEsperado] of Object.entries(esperado)) {
    const leido = campos[campo as keyof CamposExtraidos];
    const e = estadisticas.get(campo) ?? { total: 0, correctos: 0, erroresSinMarcar: 0 };
    e.total++;
    if (leido?.valor === String(valorEsperado)) e.correctos++;
    else {
      fallas.push(`${campo}: se leyó "${leido?.valor ?? "—"}", era "${valorEsperado}"`);
      // Un error grave es un valor equivocado que no quedó marcado para revisar.
      if (leido && leido.confianza >= UMBRAL_CONFIANZA) e.erroresSinMarcar++;
    }
    estadisticas.set(campo, e);
  }
  console.log(`${fallas.length ? "✖" : "✔"} ${nombre}${fallas.length ? `\n    ${fallas.join("\n    ")}` : ""}`);
}

console.log(`\n${archivos} comprobantes en ${((Date.now() - inicio) / 1000).toFixed(1)} s\n`);
console.log("Campo".padEnd(28) + "Exactitud".padStart(10) + "Errores sin marcar".padStart(22));
for (const [campo, e] of estadisticas) {
  console.log(campo.padEnd(28) + `${((100 * e.correctos) / e.total).toFixed(1)} %`.padStart(10) + `${((100 * e.erroresSinMarcar) / e.total).toFixed(1)} %`.padStart(22));
}
console.log("\nObjetivos (sección 21.3): ≥ 90 % por campo con OCR y ≤ 2 % de errores sin marcar.");
await cerrarOcr();
