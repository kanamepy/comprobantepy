/**
 * Proyección informativa del IRP-RSP (sección 20.5). No sustituye la declaración
 * jurada (Formulario N.° 515) ni el criterio del profesional responsable.
 *
 * Los importes son guaraníes enteros. Las tasas se expresan en puntos básicos
 * (800 = 8 %) para evitar errores de coma flotante.
 */

export interface Tramo {
  /** Límite superior de la porción, inclusive; null para el último tramo. */
  hasta: number | null;
  tasaPuntosBasicos: number;
}

/** Tramos del instructivo del Formulario N.° 515, versión 1. Parametrizables por ejercicio. */
export const TRAMOS_IRP_RSP_INICIALES: readonly Tramo[] = [
  { hasta: 50_000_000, tasaPuntosBasicos: 800 },
  { hasta: 150_000_000, tasaPuntosBasicos: 900 },
  { hasta: null, tasaPuntosBasicos: 1000 },
];

export interface DetallePorcion {
  desde: number;
  hasta: number;
  base: number;
  tasaPuntosBasicos: number;
  impuesto: number;
}

/** Redondeo al guaraní más cercano (mitad hacia arriba) de numerador / 10.000. [A CONFIRMAR] la regla oficial. */
function redondearDivision10000(numerador: number): number {
  return Math.floor((numerador + 5000) / 10000);
}

/** Impuesto por porciones: cada tramo grava solo la parte de la renta comprendida en él. */
export function calcularImpuestoPorPorciones(
  rentaNetaImponible: number,
  tramos: readonly Tramo[] = TRAMOS_IRP_RSP_INICIALES,
): { impuesto: number; detalle: DetallePorcion[] } {
  const renta = Math.max(0, rentaNetaImponible);
  const detalle: DetallePorcion[] = [];
  let desde = 0;
  let impuesto = 0;
  for (const tramo of tramos) {
    if (renta <= desde) break;
    const hasta = tramo.hasta === null ? renta : Math.min(renta, tramo.hasta);
    const base = hasta - desde;
    const impuestoTramo = redondearDivision10000(base * tramo.tasaPuntosBasicos);
    detalle.push({ desde, hasta, base, tasaPuntosBasicos: tramo.tasaPuntosBasicos, impuesto: impuestoTramo });
    impuesto += impuestoTramo;
    if (tramo.hasta === null) break;
    desde = tramo.hasta;
  }
  return { impuesto, detalle };
}

export interface DatosProyeccion {
  ingresosGravados: number;
  egresosDeducibles: number;
  /** Solo conceptos habilitados expresamente para el ejercicio (sección 20.4). */
  compensaciones?: number;
  ajustesYMultas?: number;
  saldoAFavorAnterior?: number;
  retenciones?: number;
  percepciones?: number;
  tramos?: readonly Tramo[];
}

export interface Proyeccion {
  rentaNetaCalculada: number;
  rentaNetaImponible: number;
  impuestoDeterminado: number;
  detalle: DetallePorcion[];
  /** Positivo: a pagar. Negativo: saldo a favor. */
  saldoProyectado: number;
}

export function proyectarIrpRsp(datos: DatosProyeccion): Proyeccion {
  const rentaNetaCalculada = datos.ingresosGravados - datos.egresosDeducibles - (datos.compensaciones ?? 0);
  const rentaNetaImponible = Math.max(0, rentaNetaCalculada);
  const { impuesto, detalle } = calcularImpuestoPorPorciones(rentaNetaImponible, datos.tramos);
  const saldoProyectado =
    impuesto +
    (datos.ajustesYMultas ?? 0) -
    (datos.saldoAFavorAnterior ?? 0) -
    (datos.retenciones ?? 0) -
    (datos.percepciones ?? 0);
  return { rentaNetaCalculada, rentaNetaImponible, impuestoDeterminado: impuesto, detalle, saldoProyectado };
}
