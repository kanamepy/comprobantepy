/** Determinación de la naturaleza fiscal (sección 8). */
import type { NaturalezaFiscal } from "./catalogos.js";
import type { ResultadoExtraccion } from "./extraccion.js";

export interface IndiciosProveedor {
  emiteVirtual?: boolean;
}

export interface NaturalezaSugerida {
  naturaleza: NaturalezaFiscal;
  motivo: string;
}

/**
 * Solo se clasifica automáticamente con evidencia fuerte. Sin ella, la naturaleza
 * queda NO_DETERMINADA y el usuario debe confirmarla (bloquea la aprobación).
 */
export function determinarNaturaleza(
  extraccion: Pick<ResultadoExtraccion, "indicios">,
  proveedor: IndiciosProveedor = {},
): NaturalezaSugerida {
  if (extraccion.indicios.xmlSifen) return { naturaleza: "ELECTRONICO", motivo: "XML de documento electrónico SIFEN" };
  if (extraccion.indicios.cdcValido) return { naturaleza: "ELECTRONICO", motivo: "CDC válido impreso (KuDE)" };
  if (extraccion.indicios.leyendaVirtual) return { naturaleza: "VIRTUAL", motivo: "Leyenda de comprobante virtual" };
  if (proveedor.emiteVirtual) return { naturaleza: "VIRTUAL", motivo: "El proveedor está marcado como emisor de comprobantes virtuales" };
  return { naturaleza: "NO_DETERMINADA", motivo: "Sin evidencia suficiente: confirmar si es físico, electrónico o virtual" };
}
