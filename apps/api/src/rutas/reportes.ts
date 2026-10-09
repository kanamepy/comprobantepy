import { buscarTipoComprobante } from "@comprobantepy/shared";
import ExcelJS from "exceljs";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { exigirSesion } from "../auth/sesiones.js";
import type { BaseDeDatos } from "../db/conexion.js";
import { exigirAccesoContribuyente } from "../servicios/lotes.js";
import { reporteConsolidado } from "../servicios/reportes.js";
import { validar } from "../validacion.js";

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida");
const esquemaFiltro = z.object({ contribuyenteId: z.coerce.number().int().positive(), desde: fecha, hasta: fecha });

const SECCION = {
  DEFINITIVO: "Definitivo",
  PRELIMINAR: "Preliminar",
  RECHAZADO: "Rechazado",
  DUPLICADO: "Posible duplicado",
  ANULADO: "Anulado",
} as const;

export async function rutasReportes(app: FastifyInstance, { db }: { db: BaseDeDatos }) {
  app.addHook("preHandler", exigirSesion);

  app.get("/consolidado", async (request) => {
    const { contribuyenteId, desde, hasta } = validar(esquemaFiltro, request.query);
    exigirAccesoContribuyente(request.usuario!, contribuyenteId);
    return reporteConsolidado(db, contribuyenteId, desde, hasta);
  });

  app.get("/consolidado.xlsx", async (request, reply) => {
    const { contribuyenteId, desde, hasta } = validar(esquemaFiltro, request.query);
    exigirAccesoContribuyente(request.usuario!, contribuyenteId);
    const reporte = await reporteConsolidado(db, contribuyenteId, desde, hasta);

    const libro = new ExcelJS.Workbook();
    const resumen = libro.addWorksheet("Resumen");
    resumen.columns = [{ width: 40 }, { width: 14 }, { width: 18 }];
    resumen.addRow([`Reporte tributario consolidado del ${desde} al ${hasta}`]).font = { bold: true, size: 14 };
    resumen.addRow(["Los totales definitivos incluyen solo comprobantes aprobados."]);
    resumen.addRow([]);
    resumen.addRow(["Sección", "Cantidad", "Total (Gs.)"]).font = { bold: true };
    for (const [clave, t] of Object.entries(reporte.secciones)) resumen.addRow([SECCION[clave as keyof typeof SECCION], t.cantidad, t.total]);
    resumen.addRow([]);
    resumen.addRow(["Definitivos por naturaleza", "Cantidad", "Total (Gs.)"]).font = { bold: true };
    for (const [clave, t] of Object.entries(reporte.definitivos.porNaturaleza)) resumen.addRow([clave, t.cantidad, t.total]);
    resumen.addRow([]);
    resumen.addRow(["Definitivos por obligación (importe imputado)", "Cantidad", "Imputado (Gs.)"]).font = { bold: true };
    for (const o of Object.values(reporte.definitivos.porObligacion)) {
      resumen.addRow([o.descripcion, o.cantidad, o.imputado]);
      for (const [actividad, importe] of Object.entries(o.actividades)) resumen.addRow([`   ${actividad}`, null, importe]);
    }
    resumen.addRow([]);
    resumen.addRow(["IVA 10 % de los definitivos", null, reporte.definitivos.iva10]);
    resumen.addRow(["IVA 5 % de los definitivos", null, reporte.definitivos.iva5]);
    resumen.getColumn(3).numFmt = "#,##0";

    const hoja = libro.addWorksheet("Detalle");
    hoja.columns = [
      { header: "Sección", key: "seccion", width: 16 },
      { header: "Fecha", key: "fechaEmision", width: 12 },
      { header: "Naturaleza", key: "naturaleza", width: 14 },
      { header: "Tipo", key: "tipo", width: 30 },
      { header: "Número", key: "numero", width: 18 },
      { header: "Timbrado", key: "timbrado", width: 12 },
      { header: "CDC", key: "cdc", width: 48 },
      { header: "Proveedor", key: "proveedor", width: 32 },
      { header: "RUC", key: "rucProveedor", width: 14 },
      { header: "Moneda", key: "moneda", width: 8 },
      { header: "Total (Gs.)", key: "totalGs", width: 16, style: { numFmt: "#,##0" } },
      { header: "Obligaciones", key: "obligaciones", width: 30 },
      { header: "Estado", key: "estadoFlujo", width: 22 },
      { header: "Marangatu", key: "estadoMarangatu", width: 18 },
    ];
    hoja.getRow(1).font = { bold: true };
    for (const fila of reporte.detalle) {
      hoja.addRow({
        ...fila,
        seccion: SECCION[fila.seccion],
        tipo: fila.tipoComprobante ? (buscarTipoComprobante(fila.tipoComprobante)?.descripcion ?? fila.tipoComprobante) : "",
      });
    }
    const contenido = Buffer.from(await libro.xlsx.writeBuffer());
    return reply
      .header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .header("Content-Disposition", `attachment; filename="reporte-consolidado-${desde}-${hasta}.xlsx"`)
      .send(contenido);
  });
}
