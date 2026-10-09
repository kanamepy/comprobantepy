/** Normalización de números de comprobante y fechas (sección 9.1). */

const PATRON_NUMERO = /^\d{3}-\d{3}-\d{7}$/;

/**
 * Normaliza un número de comprobante a `###-###-#######`.
 * Acepta "1-1-123", "001 001 0000123" o los 13 dígitos seguidos.
 * Devuelve null si no se puede interpretar.
 */
export function normalizarNumeroComprobante(valor: string): string | null {
  const limpio = valor.trim();
  if (/^\d{13}$/.test(limpio)) {
    return `${limpio.slice(0, 3)}-${limpio.slice(3, 6)}-${limpio.slice(6)}`;
  }
  const partes = limpio.split(/[\s\-/.]+/).filter(Boolean);
  if (partes.length !== 3 || !partes.every((p) => /^\d+$/.test(p))) return null;
  const [establecimiento, punto, numero] = partes as [string, string, string];
  if (establecimiento.length > 3 || punto.length > 3 || numero.length > 7) return null;
  return `${establecimiento.padStart(3, "0")}-${punto.padStart(3, "0")}-${numero.padStart(7, "0")}`;
}

export function esNumeroComprobanteValido(valor: string): boolean {
  return PATRON_NUMERO.test(valor);
}

const PATRON_FECHA_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Interpreta una fecha ISO `aaaa-mm-dd` y verifica que exista en el calendario. */
export function parsearFechaIso(valor: string): { anio: number; mes: number; dia: number } | null {
  const coincidencia = PATRON_FECHA_ISO.exec(valor);
  if (!coincidencia) return null;
  const anio = Number(coincidencia[1]);
  const mes = Number(coincidencia[2]);
  const dia = Number(coincidencia[3]);
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  if (fecha.getUTCFullYear() !== anio || fecha.getUTCMonth() !== mes - 1 || fecha.getUTCDate() !== dia) {
    return null;
  }
  return { anio, mes, dia };
}

/** `aaaa-mm-dd` → `dd/mm/aaaa`. */
export function fechaIsoADdMmAaaa(valor: string): string {
  const fecha = parsearFechaIso(valor);
  if (!fecha) throw new Error(`Fecha inválida: ${valor}`);
  return `${String(fecha.dia).padStart(2, "0")}/${String(fecha.mes).padStart(2, "0")}/${fecha.anio}`;
}

/** `aaaa-mm-dd` → `mm/aaaa`. */
export function fechaIsoAMmAaaa(valor: string): string {
  const fecha = parsearFechaIso(valor);
  if (!fecha) throw new Error(`Fecha inválida: ${valor}`);
  return `${String(fecha.mes).padStart(2, "0")}/${fecha.anio}`;
}
