/** Lectura del texto digital de un PDF con PDF.js (sección 6.2). */
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export interface TextoPdf {
  texto: string;
  paginas: number;
  /** true si el PDF casi no tiene texto: probablemente es un escaneo y requiere OCR. */
  escaneado: boolean;
}

export async function extraerTextoPdf(contenido: Buffer): Promise<TextoPdf> {
  const documento = await getDocument({
    data: new Uint8Array(contenido),
    isEvalSupported: false,
    useSystemFonts: false,
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
