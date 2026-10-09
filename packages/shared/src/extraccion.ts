/**
 * Tipos comunes de la extracción automática (secciones 6 y 9). Cada campo conserva
 * el valor detectado, la fuente y la confianza.
 */

export type FuenteDato = "XML" | "PDF_TEXTO" | "QR" | "CDC" | "OCR" | "MANUAL";

/** Prioridad de fuentes (sección 6.4): menor número, mayor prioridad. */
export const PRIORIDAD_FUENTE: Record<FuenteDato, number> = {
  XML: 1,
  PDF_TEXTO: 2,
  QR: 3,
  CDC: 3,
  OCR: 4,
  MANUAL: 5,
};

export const CAMPOS_COMPROBANTE = [
  "cdc",
  "tipoComprobante",
  "emisorRuc",
  "emisorDv",
  "emisorNombre",
  "emisorNombreFantasia",
  "timbrado",
  "numero",
  "fechaEmision",
  "moneda",
  "tipoCambio",
  "condicion",
  "receptorTipoIdentificacion",
  "receptorNumero",
  "receptorDv",
  "receptorNombre",
  "gravado10",
  "gravado5",
  "exento",
  "iva10",
  "iva5",
  "total",
  "totalGs",
  "asociadoNumero",
  "asociadoTimbrado",
  "asociadoCdc",
] as const;

export type CampoComprobante = (typeof CAMPOS_COMPROBANTE)[number];

export interface CampoExtraido {
  /** Siempre texto; los importes se guardan como decimales en texto para no perder precisión. */
  valor: string;
  fuente: FuenteDato;
  /** Entre 0 y 1. Por debajo de UMBRAL_CONFIANZA el campo se marca para revisión. */
  confianza: number;
}

export type CamposExtraidos = Partial<Record<CampoComprobante, CampoExtraido>>;

export const UMBRAL_CONFIANZA = 0.85;

export interface ResultadoExtraccion {
  campos: CamposExtraidos;
  /** Evidencia para determinar la naturaleza fiscal (sección 8.1). */
  indicios: {
    xmlSifen: boolean;
    cdcValido: boolean;
    leyendaVirtual: boolean;
  };
  advertencias: string[];
}

export function resultadoVacio(): ResultadoExtraccion {
  return { campos: {}, indicios: { xmlSifen: false, cdcValido: false, leyendaVirtual: false }, advertencias: [] };
}

/** Combina dos extracciones respetando la prioridad de fuentes. */
export function combinarExtracciones(a: ResultadoExtraccion, b: ResultadoExtraccion): ResultadoExtraccion {
  const campos: CamposExtraidos = { ...a.campos };
  for (const [clave, campo] of Object.entries(b.campos) as [CampoComprobante, CampoExtraido][]) {
    const actual = campos[clave];
    if (!actual || PRIORIDAD_FUENTE[campo.fuente] < PRIORIDAD_FUENTE[actual.fuente]) campos[clave] = campo;
  }
  return {
    campos,
    indicios: {
      xmlSifen: a.indicios.xmlSifen || b.indicios.xmlSifen,
      cdcValido: a.indicios.cdcValido || b.indicios.cdcValido,
      leyendaVirtual: a.indicios.leyendaVirtual || b.indicios.leyendaVirtual,
    },
    advertencias: [...a.advertencias, ...b.advertencias],
  };
}
