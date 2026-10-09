/** Lectura del texto digital de un PDF con PDF.js (sección 6.2). */
import { createCanvas } from "@napi-rs/canvas";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const require = createRequire(import.meta.url);
const fuentesEstandar = pathToFileURL(join(dirname(require.resolve("pdfjs-dist/package.json")), "standard_fonts") + "/").href;

export interface TextoPdf {
  texto: string;
  paginas: number;
  /** true si el PDF casi no tiene texto: probablemente es un escaneo y requiere OCR. */
  escaneado: boolean;
}

export async function extraerTextoPdf(contenido: Buffer): Promise<TextoPdf> {
  const documento = await getDocument({
    data: new Uint8Array(contenido),
    useSystemFonts: false,
    standardFontDataUrl: fuentesEstandar,
    verbosity: 0,
  }).promise;
  try {
    const partes: string[] = [];
    for (let numero = 1; numero <= documento.numPages; numero++) {
      const pagina = await documento.getPage(numero);
      const contenidoPagina = await pagina.getTextContent();
      let linea = "";
      for (const item of contenidoPagina.items) {
        if (!("str" in item)) continue;
        linea += item.str;
        if (item.hasEOL) {
          partes.push(linea);
          linea = "";
        } else {
          linea += " ";
        }
      }
      if (linea) partes.push(linea);
    }
    const texto = partes.join("\n").replace(/[ \t]+/g, " ");
    return { texto, paginas: documento.numPages, escaneado: texto.replace(/\s/g, "").length < 30 };
  } finally {
    await documento.destroy();
  }
}

/** Convierte las primeras páginas de un PDF escaneado en imágenes PNG para el OCR. */
export async function renderizarPaginas(contenido: Buffer, maximo = 2, escala = 2.5): Promise<Buffer[]> {
  const documento = await getDocument({
    data: new Uint8Array(contenido),
    standardFontDataUrl: fuentesEstandar,
    verbosity: 0,
  }).promise;
  try {
    const imagenes: Buffer[] = [];
    for (let numero = 1; numero <= Math.min(documento.numPages, maximo); numero++) {
      const pagina = await documento.getPage(numero);
      const vista = pagina.getViewport({ scale: escala });
      const lienzo = createCanvas(Math.ceil(vista.width), Math.ceil(vista.height));
      const contexto = lienzo.getContext("2d");
      contexto.fillStyle = "white";
      contexto.fillRect(0, 0, lienzo.width, lienzo.height);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await pagina.render({ canvasContext: contexto as any, viewport: vista, canvas: lienzo as any }).promise;
      imagenes.push(lienzo.toBuffer("image/png"));
    }
    return imagenes;
  } finally {
    await documento.destroy();
  }
}
