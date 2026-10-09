/**
 * Reporte tributario consolidado (sección 19): físicos, electrónicos y virtuales,
 * sin duplicar importes por la imputación múltiple.
 */
import { aGuaranies, destinoExportacion } from "@comprobantepy/shared";
import { and, asc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import type { Ejecutor } from "../db/conexion.js";
import { actividades, comprobantes, imputaciones, obligaciones, proveedores } from "../db/esquema.js";

export type SeccionReporte = "DEFINITIVO" | "PRELIMINAR" | "RECHAZADO" | "DUPLICADO" | "ANULADO";

export function seccionDe(estadoFlujo: string): SeccionReporte {
  if (estadoFlujo === "APROBADO") return "DEFINITIVO";
  if (estadoFlujo === "ANULADO") return "ANULADO";
  if (estadoFlujo === "RECHAZADO") return "RECHAZADO";
  if (estadoFlujo === "POSIBLE_DUPLICADO") return "DUPLICADO";
  return "PRELIMINAR";
}

interface Totales {
  cantidad: number;
  total: number;
}
const vacio = (): Totales => ({ cantidad: 0, total: 0 });
const sumar = (t: Totales, importe: number) => {
  t.cantidad++;
  t.total += importe;
};

export async function reporteConsolidado(db: Ejecutor, contribuyenteId: number, desde: string, hasta: string) {
  const filas = await db
    .select({ c: comprobantes, proveedor: proveedores.razonSocial, ruc: proveedores.numeroIdentificacion, dv: proveedores.dv })
    .from(comprobantes)
    .leftJoin(proveedores, eq(proveedores.id, comprobantes.proveedorId))
    // Las versiones históricas no se suman: las representa la versión vigente.
    .where(and(eq(comprobantes.contribuyenteId, contribuyenteId), gte(comprobantes.fechaEmision, desde), lte(comprobantes.fechaEmision, hasta), isNull(comprobantes.reemplazadoPorId)))
    .orderBy(asc(comprobantes.fechaEmision), asc(comprobantes.id));

  const ids = filas.map((f) => f.c.id);
  const lineas = ids.length
    ? await db
        .select({
          comprobanteId: imputaciones.comprobanteId,
          obligacion: imputaciones.obligacionCodigo,
          descripcion: obligaciones.descripcion,
          actividad: actividades.descripcion,
          porcentaje: imputaciones.porcentaje,
        })
        .from(imputaciones)
        .innerJoin(obligaciones, eq(obligaciones.codigo, imputaciones.obligacionCodigo))
        .leftJoin(actividades, eq(actividades.id, imputaciones.actividadId))
        .where(inArray(imputaciones.comprobanteId, ids))
    : [];

  const secciones: Record<SeccionReporte, Totales> = {
    DEFINITIVO: vacio(),
    PRELIMINAR: vacio(),
    RECHAZADO: vacio(),
    DUPLICADO: vacio(),
    ANULADO: vacio(),
  };
  const porNaturaleza: Record<string, Totales> = {};
  const porDestino: Record<string, Totales> = {};
  const porObligacion: Record<string, { descripcion: string; cantidad: number; imputado: number; actividades: Record<string, number> }> = {};
  let iva10 = 0;
  let iva5 = 0;

  const detalle = filas.map(({ c, proveedor, ruc, dv }) => {
    const totalGs = aGuaranies(c.total, c.moneda, c.tipoCambio) ?? 0;
    const seccion = seccionDe(c.estadoFlujo);
    sumar(secciones[seccion], totalGs);
    const destino = c.tipoComprobante ? destinoExportacion(c.tipoComprobante, "FISICO") : "NO_EXPORTABLE";
    const propias = lineas.filter((l) => l.comprobanteId === c.id);
    if (seccion === "DEFINITIVO") {
      // El total general suma cada comprobante una sola vez; cada obligación muestra su parte imputada.
      sumar((porNaturaleza[c.naturaleza] ??= vacio()), totalGs);
      sumar((porDestino[destino] ??= vacio()), totalGs);
      iva10 += aGuaranies(c.iva10, c.moneda, c.tipoCambio) ?? 0;
      iva5 += aGuaranies(c.iva5, c.moneda, c.tipoCambio) ?? 0;
      const contadas = new Set<string>();
      for (const l of propias) {
        const grupo = (porObligacion[l.obligacion] ??= { descripcion: l.descripcion, cantidad: 0, imputado: 0, actividades: {} });
        const importe = Math.round((totalGs * Number(l.porcentaje)) / 100);
        grupo.imputado += importe;
        const actividad = l.actividad ?? "Sin actividad";
        grupo.actividades[actividad] = (grupo.actividades[actividad] ?? 0) + importe;
        if (!contadas.has(l.obligacion)) {
          grupo.cantidad++;
          contadas.add(l.obligacion);
        }
      }
    }
    return {
      id: c.id,
      seccion,
      fechaEmision: c.fechaEmision,
      naturaleza: c.naturaleza,
      tipoComprobante: c.tipoComprobante,
      destino,
      numero: c.numero,
      timbrado: c.timbrado,
      cdc: c.cdc,
      proveedor,
      rucProveedor: ruc ? `${ruc}${dv !== null ? `-${dv}` : ""}` : null,
      moneda: c.moneda,
      total: c.total,
      totalGs,
      estadoFlujo: c.estadoFlujo,
      estadoMarangatu: c.estadoMarangatu,
      obligaciones: propias.map((l) => `${l.obligacion} ${Number(l.porcentaje)} %`).join(", "),
    };
  });

  return {
    desde,
    hasta,
    secciones,
    definitivos: { porNaturaleza, porDestino, porObligacion, iva10, iva5 },
    detalle,
  };
}
