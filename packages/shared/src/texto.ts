/**
 * Extracción de datos desde el texto de un PDF digital (sección 6.2) o, más
 * adelante, del texto de OCR. Son heurísticas: cada campo lleva una confianza
 * menor a 1 para que el usuario lo revise.
 */
import { parsearCdc } from "./cdc.js";
import { tipoComprobanteDesdeSifen } from "./cdc.js";
import { normalizarNumeroComprobante, parsearFechaIso } from "./comprobante.js";
import { resultadoVacio, type CampoComprobante, type FuenteDato, type ResultadoExtraccion } from "./extraccion.js";
import { validarRuc } from "./ruc.js";

/** "1.234.567" → "1234567"; "1.234,50" → "1234.5". Devuelve undefined si no es un importe. */
export function parsearImporte(valor: string): string | undefined {
  const limpio = valor.replace(/\s/g, "").replace(/^(gs\.?|₲)/i, "");
  if (!/^\d{1,3}(\.\d{3})*(,\d+)?$|^\d+(,\d+)?$/.test(limpio)) return undefined;
  const [entero, fraccion] = limpio.split(",");
  const numero = entero!.replace(/\./g, "");
  const fraccionLimpia = fraccion?.replace(/0+$/, "");
  return fraccionLimpia ? `${BigInt(numero)}.${fraccionLimpia}` : String(BigInt(numero));
}

const PATRON_IMPORTE = String.raw`(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?)`;

function ultimo(regex: RegExp, texto: string): RegExpExecArray | undefined {
  let encontrado: RegExpExecArray | undefined;
  for (const coincidencia of texto.matchAll(new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : regex.flags + "g"))) {
    encontrado = coincidencia as RegExpExecArray;
  }
  return encontrado;
}

export function extraerDeTexto(textoOriginal: string, fuente: FuenteDato = "PDF_TEXTO"): ResultadoExtraccion {
  const resultado = resultadoVacio();
  const texto = textoOriginal.replace(/ /g, " ");
  const fijar = (campo: CampoComprobante, valor: string | undefined, confianza: number) => {
    if (valor) resultado.campos[campo] = { valor, fuente, confianza };
  };

  if (/comprobante\s+virtual/i.test(texto)) resultado.indicios.leyendaVirtual = true;

  // CDC impreso en el KuDE: 44 dígitos, a veces agrupados de a 4.
  for (const coincidencia of texto.matchAll(/(?:\d[ ]?){43}\d/g)) {
    const datos = parsearCdc(coincidencia[0]);
    if (datos) {
      resultado.indicios.cdcValido = true;
      fijar("cdc", datos.cdc, 0.99);
      // Los datos que el CDC codifica son muy confiables.
      fijar("emisorRuc", datos.rucEmisor, 0.95);
      fijar("emisorDv", String(datos.dvEmisor), 0.95);
      fijar("numero", datos.numero, 0.95);
      fijar("fechaEmision", datos.fechaEmision, 0.95);
      const tipo = tipoComprobanteDesdeSifen(datos.tipoDocumentoElectronico);
      if (tipo) fijar("tipoComprobante", String(tipo), 0.95);
      break;
    }
  }

  const timbrado = /timbrado\s*(?:n(?:[°ºo.]|ro\.?)?\s*)?:?\s*(\d{8})\b/i.exec(texto);
  fijar("timbrado", timbrado?.[1], 0.8);

  if (!resultado.campos.numero) {
    const numero = /\b(\d{3})\s*-\s*(\d{3})\s*-\s*(\d{7})\b/.exec(texto);
    if (numero) fijar("numero", normalizarNumeroComprobante(`${numero[1]}-${numero[2]}-${numero[3]}`) ?? undefined, 0.8);
  }

  if (!resultado.campos.fechaEmision) {
    const fecha = /fecha(?:\s+de)?(?:\s+emisi[oó]n)?\s*:?\s*(\d{1,2})[/-](\d{1,2})[/-](\d{4})/i.exec(texto)
      ?? /\b(\d{2})\/(\d{2})\/(\d{4})\b/.exec(texto);
    if (fecha) {
      const iso = `${fecha[3]}-${fecha[2]!.padStart(2, "0")}-${fecha[1]!.padStart(2, "0")}`;
      if (parsearFechaIso(iso)) fijar("fechaEmision", iso, 0.7);
    }
  }

  // RUC: el primero suele ser el del emisor; el que sigue a "cliente", "señor(es)" o similar, el del receptor.
  const rucs = [...texto.matchAll(/R\.?\s?U\.?\s?C\.?\s*(?:n[°º.]?\s*)?:?\s*(\d{3,8}\s?-\s?\d)\b/gi)].map((m) => ({
    valor: m[1]!.replace(/\s/g, ""),
    posicion: m.index ?? 0,
  }));
  const marcaReceptor = /(cliente|se[ñn]or(?:es)?|sr\.?\(?es\)?|raz[oó]n social del (?:cliente|receptor)|comprador|receptor)/i.exec(texto);
  const rucEmisor = rucs.find((r) => !marcaReceptor || r.posicion < marcaReceptor.index);
  const rucReceptor = marcaReceptor ? rucs.find((r) => r.posicion > marcaReceptor.index) : undefined;
  for (const [ruc, prefijo] of [
    [rucEmisor, "emisor"],
    [rucReceptor, "receptor"],
  ] as const) {
    if (!ruc) continue;
    const validacion = validarRuc(ruc.valor);
    const confianza = validacion.valido ? 0.8 : 0.4;
    if (prefijo === "emisor" && !resultado.campos.emisorRuc) {
      fijar("emisorRuc", validacion.numero, confianza);
      if (validacion.dv !== null) fijar("emisorDv", String(validacion.dv), confianza);
    }
    if (prefijo === "receptor") {
      fijar("receptorTipoIdentificacion", "RUC", confianza);
      fijar("receptorNumero", validacion.numero, confianza);
      if (validacion.dv !== null) fijar("receptorDv", String(validacion.dv), confianza);
    }
  }
  if (!rucReceptor && marcaReceptor) {
    const ci = /(?:C\.?\s?I\.?|c[eé]dula)\s*(?:n[°º.]?\s*)?:?\s*(\d{4,9})\b/i.exec(texto.slice(marcaReceptor.index));
    if (ci) {
      fijar("receptorTipoIdentificacion", "CI", 0.6);
      fijar("receptorNumero", ci[1], 0.6);
    }
  }

  if (/\bcontado\b/i.test(texto) && !/\bcr[eé]dito\b\s*:?\s*(x|\[x\]|☒)/i.test(texto)) {
    fijar("condicion", "1", 0.6);
  } else if (/condici[oó]n[^\n]{0,30}cr[eé]dito/i.test(texto)) {
    fijar("condicion", "2", 0.6);
  }

  const total = ultimo(new RegExp(String.raw`total\s*(?:a\s+pagar|general|de\s+la\s+operaci[oó]n|gs\.?|guaran[ií]es)?\s*:?\s*(?:gs\.?|₲)?\s*` + PATRON_IMPORTE, "i"), texto);
  fijar("total", total ? parsearImporte(total[1]!) : undefined, 0.7);

  const iva10 = new RegExp(String.raw`(?:liquidaci[oó]n\s+del\s+)?iva\s*(?:\(\s*)?10\s*%?\s*\)?\s*:?\s*` + PATRON_IMPORTE, "i").exec(texto);
  fijar("iva10", iva10 ? parsearImporte(iva10[1]!) : undefined, 0.6);
  const iva5 = new RegExp(String.raw`(?:liquidaci[oó]n\s+del\s+)?iva\s*(?:\(\s*)?5\s*%?\s*\)?\s*:?\s*` + PATRON_IMPORTE, "i").exec(texto);
  fijar("iva5", iva5 ? parsearImporte(iva5[1]!) : undefined, 0.6);

  if (Object.keys(resultado.campos).length === 0) {
    resultado.advertencias.push("No se identificaron datos del comprobante en el texto");
  }
  return resultado;
}
