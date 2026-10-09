/**
 * Lectura estructurada de XML de documentos electrónicos SIFEN (sección 6.3).
 * Nunca se usa OCR para un XML. Un XML legible no prueba por sí solo la validez
 * tributaria: la verificación ante SIFEN y de la firma se registran aparte.
 */
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { esCdcValido, normalizarCdc, tipoComprobanteDesdeSifen } from "./cdc.js";
import { normalizarNumeroComprobante } from "./comprobante.js";
import { resultadoVacio, type CampoComprobante, type ResultadoExtraccion } from "./extraccion.js";

type Nodo = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  // Mantener todo como texto: los números con ceros a la izquierda (establecimiento, timbrado) no deben perderse.
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

/** Busca en profundidad el primer nodo con ese nombre. */
function buscar(nodo: unknown, nombre: string): unknown {
  if (nodo === null || typeof nodo !== "object") return undefined;
  if (Array.isArray(nodo)) {
    for (const elemento of nodo) {
      const encontrado = buscar(elemento, nombre);
      if (encontrado !== undefined) return encontrado;
    }
    return undefined;
  }
  const objeto = nodo as Nodo;
  if (nombre in objeto) return objeto[nombre];
  for (const valor of Object.values(objeto)) {
    const encontrado = buscar(valor, nombre);
    if (encontrado !== undefined) return encontrado;
  }
  return undefined;
}

function texto(nodo: unknown, nombre: string): string | undefined {
  const valor = buscar(nodo, nombre);
  if (valor === undefined || valor === null) return undefined;
  if (typeof valor === "object") {
    const contenido = (valor as Nodo)["#text"];
    return contenido === undefined ? undefined : String(contenido).trim() || undefined;
  }
  const limpio = String(valor).trim();
  return limpio || undefined;
}

/** Normaliza un decimal SIFEN ("110000", "12.50") a texto sin ceros superfluos. */
function decimal(valor: string | undefined): string | undefined {
  if (valor === undefined || !/^-?\d+(\.\d+)?$/.test(valor)) return undefined;
  const [entero, fraccion] = valor.split(".");
  const fraccionLimpia = fraccion?.replace(/0+$/, "");
  return fraccionLimpia ? `${BigInt(entero!)}.${fraccionLimpia}` : String(BigInt(entero!));
}

function sumarDecimales(a: string | undefined, b: string | undefined): string | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  const escala = 10 ** 8;
  const suma = Math.round(Number(a) * escala) + Math.round(Number(b) * escala);
  return decimal((suma / escala).toFixed(8));
}

export function esXmlSifen(contenido: string): boolean {
  return /ekuatia\.set\.gov\.py\/sifen|<(\w+:)?rDE[\s>]|<(\w+:)?DE[\s>][^]*?<(\w+:)?gTimb>/.test(contenido);
}

export function extraerDeXmlSifen(contenido: string): ResultadoExtraccion {
  const resultado = resultadoVacio();
  if (XMLValidator.validate(contenido) !== true) {
    resultado.advertencias.push("El XML no está bien formado");
    return resultado;
  }
  let documento: unknown;
  try {
    documento = parser.parse(contenido);
  } catch {
    resultado.advertencias.push("El XML no está bien formado");
    return resultado;
  }

  const de = buscar(documento, "DE") as Nodo | undefined;
  if (!de || typeof de !== "object" || !buscar(de, "gTimb")) {
    resultado.advertencias.push("El XML no contiene un documento electrónico SIFEN (nodo DE)");
    return resultado;
  }
  resultado.indicios.xmlSifen = true;

  const fijar = (campo: CampoComprobante, valor: string | undefined) => {
    if (valor !== undefined && valor !== "") resultado.campos[campo] = { valor, fuente: "XML", confianza: 1 };
  };

  const cdc = de["@_Id"] ? normalizarCdc(String(de["@_Id"])) : undefined;
  if (cdc) {
    fijar("cdc", cdc);
    resultado.indicios.cdcValido = esCdcValido(cdc);
    if (!resultado.indicios.cdcValido) resultado.advertencias.push("El dígito verificador del CDC no es válido");
  }

  const tipoDe = Number(texto(de, "iTiDE"));
  const tipoComprobante = tipoComprobanteDesdeSifen(tipoDe);
  if (tipoComprobante) fijar("tipoComprobante", String(tipoComprobante));
  else resultado.advertencias.push(`Tipo de documento electrónico ${tipoDe} (${texto(de, "dDesTiDE") ?? "sin descripción"}) no corresponde a una compra`);

  const gTimb = buscar(de, "gTimb");
  fijar("timbrado", texto(gTimb, "dNumTim"));
  const est = texto(gTimb, "dEst");
  const pto = texto(gTimb, "dPunExp");
  const num = texto(gTimb, "dNumDoc");
  if (est && pto && num) fijar("numero", normalizarNumeroComprobante(`${est}-${pto}-${num}`) ?? undefined);

  const fechaHora = texto(de, "dFeEmiDE");
  if (fechaHora) fijar("fechaEmision", fechaHora.slice(0, 10));

  const gEmis = buscar(de, "gEmis");
  fijar("emisorRuc", texto(gEmis, "dRucEm"));
  fijar("emisorDv", texto(gEmis, "dDVEmi"));
  fijar("emisorNombre", texto(gEmis, "dNomEmi"));
  fijar("emisorNombreFantasia", texto(gEmis, "dNomFanEmi"));

  const gOpeCom = buscar(de, "gOpeCom");
  const moneda = texto(gOpeCom, "cMoneOpe") ?? "PYG";
  fijar("moneda", moneda);
  if (moneda !== "PYG") fijar("tipoCambio", decimal(texto(gOpeCom, "dTiCam")));

  const condicion = texto(buscar(de, "gCamCond"), "iCondOpe");
  if (condicion === "1" || condicion === "2") fijar("condicion", condicion);

  const gDatRec = buscar(de, "gDatRec");
  if (gDatRec) {
    if (texto(gDatRec, "iNatRec") === "1") {
      fijar("receptorTipoIdentificacion", "RUC");
      fijar("receptorNumero", texto(gDatRec, "dRucRec"));
      fijar("receptorDv", texto(gDatRec, "dDVRec"));
    } else {
      // iTipIDRec 1 = cédula paraguaya; los demás documentos se registran como "OTRO".
      fijar("receptorTipoIdentificacion", texto(gDatRec, "iTipIDRec") === "1" ? "CI" : "OTRO");
      fijar("receptorNumero", texto(gDatRec, "dNumIDRec"));
    }
    fijar("receptorNombre", texto(gDatRec, "dNomRec"));
  }

  const gTotSub = buscar(de, "gTotSub");
  fijar("gravado10", decimal(texto(gTotSub, "dSub10")) ?? "0");
  fijar("gravado5", decimal(texto(gTotSub, "dSub5")) ?? "0");
  fijar("exento", sumarDecimales(decimal(texto(gTotSub, "dSubExe")), decimal(texto(gTotSub, "dSubExo"))) ?? "0");
  fijar("iva10", decimal(texto(gTotSub, "dIVA10")));
  fijar("iva5", decimal(texto(gTotSub, "dIVA5")));
  fijar("total", decimal(texto(gTotSub, "dTotGralOpe")));
  fijar("totalGs", decimal(texto(gTotSub, "dTotalGs")) ?? (moneda === "PYG" ? decimal(texto(gTotSub, "dTotGralOpe")) : undefined));

  const asociado = buscar(de, "gCamDEAsoc");
  if (asociado) {
    fijar("asociadoCdc", texto(asociado, "dCdCDERef"));
    fijar("asociadoTimbrado", texto(asociado, "dNTimDI"));
    const aEst = texto(asociado, "dEstDocAso");
    const aPto = texto(asociado, "dPExpDocAso");
    const aNum = texto(asociado, "dNumDocAso");
    if (aEst && aPto && aNum) fijar("asociadoNumero", normalizarNumeroComprobante(`${aEst}-${aPto}-${aNum}`) ?? undefined);
  }

  if (!buscar(documento, "Signature")) {
    resultado.advertencias.push("El XML no incluye firma digital");
  }
  return resultado;
}
