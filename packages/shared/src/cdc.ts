/**
 * Código de Control (CDC) de documentos electrónicos SIFEN: 44 dígitos.
 * Estructura según el Manual Técnico SIFEN v150:
 *   tipo de documento (2) + RUC emisor (8) + DV emisor (1) + establecimiento (3)
 *   + punto de expedición (3) + número (7) + tipo de contribuyente (1)
 *   + fecha de emisión aaaammdd (8) + tipo de emisión (1) + código de seguridad (9)
 *   + dígito verificador (1, módulo 11 sobre los 43 anteriores).
 */
import { calcularDV } from "./ruc.js";

export interface DatosCdc {
  cdc: string;
  tipoDocumentoElectronico: number;
  rucEmisor: string;
  dvEmisor: number;
  numero: string;
  fechaEmision: string;
}

export function normalizarCdc(valor: string): string {
  return valor.replace(/\D/g, "");
}

export function esCdcValido(valor: string): boolean {
  const cdc = normalizarCdc(valor);
  if (cdc.length !== 44) return false;
  return calcularDV(cdc.slice(0, 43)) === Number(cdc[43]);
}

export function parsearCdc(valor: string): DatosCdc | null {
  const cdc = normalizarCdc(valor);
  if (!esCdcValido(cdc)) return null;
  const fecha = cdc.slice(25, 33);
  return {
    cdc,
    tipoDocumentoElectronico: Number(cdc.slice(0, 2)),
    rucEmisor: cdc.slice(2, 10).replace(/^0+/, ""),
    dvEmisor: Number(cdc[10]),
    numero: `${cdc.slice(11, 14)}-${cdc.slice(14, 17)}-${cdc.slice(17, 24)}`,
    fechaEmision: `${fecha.slice(0, 4)}-${fecha.slice(4, 6)}-${fecha.slice(6, 8)}`,
  };
}

/** Genera el dígito verificador de un CDC de 43 dígitos (útil para pruebas). */
export function completarCdc(cdc43: string): string {
  if (!/^\d{43}$/.test(cdc43)) throw new Error("Se esperaban 43 dígitos");
  return cdc43 + calcularDV(cdc43);
}

/**
 * Tipo de documento electrónico SIFEN → tipo de comprobante de la Tabla 4.
 * La nota de remisión (7) no es un comprobante de compra.
 */
export function tipoComprobanteDesdeSifen(tipoDe: number): number | null {
  switch (tipoDe) {
    case 1:
      return 109; // Factura electrónica
    case 4:
      return 101; // Autofactura electrónica
    case 5:
      return 110; // Nota de crédito electrónica
    case 6:
      return 111; // Nota de débito electrónica
    default:
      return null;
  }
}
