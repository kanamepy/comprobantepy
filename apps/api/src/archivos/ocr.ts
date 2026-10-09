/** OCR con tesseract.js en español (sección 6.1). Los datos del idioma vienen en el paquete, sin descargas. */
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { createWorker, type Worker } from "tesseract.js";
import { config } from "../config.js";

const require = createRequire(import.meta.url);
const carpetaIdioma = join(dirname(require.resolve("@tesseract.js-data/spa/package.json")), "4.0.0_best_int");

let trabajador: Promise<Worker> | null = null;

function obtenerTrabajador() {
  if (!trabajador) {
    const cache = join(config.carpetaArchivos, "..", "tesseract");
    mkdirSync(cache, { recursive: true });
    trabajador = createWorker("spa", 1, { langPath: carpetaIdioma, cachePath: cache, gzip: true, logger: () => undefined });
  }
  return trabajador;
}

export interface TextoOcr {
  texto: string;
  /** Confianza media del OCR, entre 0 y 1. */
  confianza: number;
}

export async function reconocerTexto(imagen: Buffer): Promise<TextoOcr> {
  const w = await obtenerTrabajador();
  const { data } = await w.recognize(imagen);
  return { texto: data.text ?? "", confianza: (data.confidence ?? 0) / 100 };
}

export async function cerrarOcr() {
  if (trabajador) {
    const w = await trabajador;
    trabajador = null;
    await w.terminate();
  }
}
