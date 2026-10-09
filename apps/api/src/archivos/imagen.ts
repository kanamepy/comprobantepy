/** Preparación de imágenes para la lectura automática (sección 6.1): orientación, contraste, tamaño y calidad. */
import jsQRModulo from "jsqr";

// jsqr se publica como CommonJS con "default": se toma la función en ambos casos.
const jsQR = ((jsQRModulo as unknown as { default?: typeof jsQRModulo }).default ?? jsQRModulo) as unknown as (
  datos: Uint8ClampedArray,
  ancho: number,
  alto: number,
  opciones?: { inversionAttempts?: "dontInvert" | "onlyInvert" | "attemptBoth" | "invertFirst" },
) => { data: string } | null;
import sharp, { type Sharp } from "sharp";

export interface CalidadImagen {
  ancho: number;
  alto: number;
  resolucionBaja: boolean;
  borrosa: boolean;
  /**
   * Cuánto se pierde de detalle al desenfocar apenas la imagen: cerca de 1 significa que ya
   * estaba borrosa. No depende de cuánto espacio en blanco tenga el documento.
   */
  indiceDesenfoque: number;
}

const LADO_MINIMO = 700;
const DESENFOQUE_MAXIMO = 0.95;

async function detalle(imagen: Sharp) {
  const estadisticas = await imagen.convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0] }).stats();
  return estadisticas.channels[0]?.stdev ?? 0;
}

export async function evaluarCalidad(contenido: Buffer): Promise<CalidadImagen> {
  const base = sharp(contenido, { failOn: "none" }).rotate();
  const { width = 0, height = 0 } = await base.clone().metadata();
  const muestra = await base.clone().greyscale().resize({ width: 1000 }).png().toBuffer();
  const original = await detalle(sharp(muestra));
  // Se desenfoca en un paso aparte: sharp aplica sus operaciones en un orden fijo.
  const desenfocada = await detalle(sharp(await sharp(muestra).blur(1.5).png().toBuffer()));
  const indiceDesenfoque = original > 0 ? desenfocada / original : 1;
  return {
    ancho: width,
    alto: height,
    resolucionBaja: Math.min(width, height) < LADO_MINIMO,
    borrosa: indiceDesenfoque > DESENFOQUE_MAXIMO,
    indiceDesenfoque,
  };
}

/**
 * Preparación suave para el OCR: orientación (EXIF), escala de grises, agrandado si es
 * chica y contraste solo si es bajo. Realzar bordes empeora la lectura (amplifica el ruido).
 */
export async function prepararParaOcr(contenido: Buffer): Promise<Buffer> {
  const imagen = sharp(contenido, { failOn: "none" }).rotate().greyscale();
  const { width = 0, height = 0 } = await imagen.clone().metadata();
  const canal = (await imagen.clone().stats()).channels[0];
  // Rango de grises: una foto con poca luz o papel gris tiene un rango corto.
  const rango = canal ? canal.max - canal.min : 255;
  let resultado = imagen;
  if (Math.max(width, height) < 1400) resultado = resultado.resize({ width: width >= height ? 2000 : undefined, height: height > width ? 2000 : undefined, kernel: "lanczos3" });
  if (rango < 150) resultado = resultado.normalize();
  return resultado.png().toBuffer();
}

/** Busca un código QR en la imagen, probando varios tamaños. */
export async function leerQr(contenido: Buffer): Promise<string | null> {
  const base = sharp(contenido, { failOn: "none" }).rotate();
  for (const ancho of [1600, 1000, 2400]) {
    const { data, info } = await base
      .clone()
      .resize({ width: ancho, withoutEnlargement: ancho > 1600 })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const codigo = jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), info.width, info.height, { inversionAttempts: "attemptBoth" });
    if (codigo?.data) return codigo.data;
  }
  return null;
}
