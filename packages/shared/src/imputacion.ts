/**
 * Imputación múltiple (sección 14) y su traducción a los indicadores S/N de
 * Marangatu (sección 14.4).
 */

export type Indicador = "IVA" | "IRE" | "IRP_RSP";

/** Mapeo configurable de obligación interna → indicador del archivo. Versionado por ejercicio. */
export type MapeoIndicadores = Readonly<Record<string, Indicador>>;

export const MAPEO_INDICADORES_INICIAL: MapeoIndicadores = {
  IVA: "IVA",
  IRE_GENERAL: "IRE",
  IRE_SIMPLE: "IRE",
  IRE_RESIMPLE: "IRE",
  IRP_RSP: "IRP_RSP",
};

export interface LineaImputacion {
  /** Código de la obligación interna, por ejemplo "IVA" o "IRP_RSP". */
  obligacion: string;
  actividad?: string;
  /** Porcentaje sobre el comprobante (0–100) dentro de la obligación. */
  porcentaje: number;
}

export interface Imputacion {
  lineas: readonly LineaImputacion[];
  /** Porcentaje del comprobante que no se imputa a ninguna obligación. */
  porcentajeNoImputado: number;
}

export interface IndicadoresSN {
  imputaIva: boolean;
  imputaIre: boolean;
  imputaIrpRsp: boolean;
  noImputa: boolean;
}

export interface ResultadoTraduccion {
  indicadores: IndicadoresSN;
  errores: string[];
}

const TOLERANCIA = 1e-9;

/**
 * Valida la distribución (sección 14.3) y la traduce a indicadores S/N.
 * `obligacionesActivas` son las obligaciones activas del informante a la fecha de emisión.
 */
export function traducirImputacion(
  imputacion: Imputacion,
  obligacionesActivas: ReadonlySet<string>,
  mapeo: MapeoIndicadores = MAPEO_INDICADORES_INICIAL,
): ResultadoTraduccion {
  const errores: string[] = [];
  const indicadores: IndicadoresSN = {
    imputaIva: false,
    imputaIre: false,
    imputaIrpRsp: false,
    noImputa: imputacion.porcentajeNoImputado > TOLERANCIA,
  };

  if (imputacion.porcentajeNoImputado < 0 || imputacion.porcentajeNoImputado > 100) {
    errores.push("El porcentaje no imputado debe estar entre 0 y 100");
  }

  const totalPorObligacion = new Map<string, number>();
  for (const linea of imputacion.lineas) {
    if (linea.porcentaje < 0 || linea.porcentaje > 100) {
      errores.push(`Porcentaje fuera de rango en ${linea.obligacion}: ${linea.porcentaje}`);
      continue;
    }
    totalPorObligacion.set(
      linea.obligacion,
      (totalPorObligacion.get(linea.obligacion) ?? 0) + linea.porcentaje,
    );
  }

  // Dentro de una obligación las actividades totalizan la parte imputable; los
  // porcentajes de obligaciones distintas no se suman entre sí.
  const imputable = 100 - imputacion.porcentajeNoImputado;
  for (const [obligacion, total] of totalPorObligacion) {
    if (total <= TOLERANCIA) continue;
    if (Math.abs(total - imputable) > 1e-6) {
      errores.push(
        `La distribución de ${obligacion} suma ${total} % y debe sumar ${imputable} % (parte imputable)`,
      );
    }
    if (!obligacionesActivas.has(obligacion)) {
      errores.push(`La obligación ${obligacion} no está activa para el informante a la fecha de emisión`);
    }
    const indicador = mapeo[obligacion];
    if (!indicador) {
      errores.push(`La obligación ${obligacion} no tiene indicador de Marangatu configurado`);
      continue;
    }
    if (indicador === "IVA") indicadores.imputaIva = true;
    if (indicador === "IRE") indicadores.imputaIre = true;
    if (indicador === "IRP_RSP") indicadores.imputaIrpRsp = true;
  }

  const algunaObligacion = indicadores.imputaIva || indicadores.imputaIre || indicadores.imputaIrpRsp;
  if (!algunaObligacion) {
    errores.push("El comprobante no tiene ninguna obligación imputada");
  }

  return { indicadores, errores };
}
