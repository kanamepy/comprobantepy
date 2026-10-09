import { and, desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sha256, type Almacenamiento } from "../archivos/almacenamiento.js";
import { ErrorHttp, exigirSesion } from "../auth/sesiones.js";
import type { BaseDeDatos } from "../db/conexion.js";
import { comprobantes, loteArchivos, loteComprobantes, lotes, proveedores, usuarios } from "../db/esquema.js";
import {
  anularLote,
  exigirAccesoContribuyente,
  generarLoteDesdeSeleccion,
  marcarEnviado,
  prepararLote,
  registrarResultado,
} from "../servicios/lotes.js";
import { validar } from "../validacion.js";

const esquemaPeriodo = z.object({
  contribuyenteId: z.coerce.number().int().positive(),
  anio: z.coerce.number().int().min(2021).max(2100),
  mes: z.coerce.number().int().min(1).max(12).nullable().optional(),
});

const esquemaGeneracion = esquemaPeriodo.extend({
  ids: z.array(z.number().int().positive()).min(1, "Elegí al menos un comprobante"),
  formato: z.enum(["TXT", "CSV"]).default("TXT"),
  delimitadorCsv: z.enum([",", ";"]).optional(),
});

const esquemaResultado = z.object({
  rechazados: z.array(z.object({ comprobanteId: z.number().int().positive(), error: z.string().trim().min(3, "Copiá el error informado por la DNIT").max(1000) })).default([]),
  cerrar: z.boolean().default(false),
});

export async function rutasLotes(app: FastifyInstance, { db, almacenamiento }: { db: BaseDeDatos; almacenamiento: Almacenamiento }) {
  app.addHook("preHandler", exigirSesion);

  app.get("/", async (request) => {
    const { contribuyenteId } = validar(z.object({ contribuyenteId: z.coerce.number().int().positive() }), request.query);
    exigirAccesoContribuyente(request.usuario!, contribuyenteId);
    const filas = await db
      .select({ lote: lotes, generadoPorNombre: usuarios.nombre })
      .from(lotes)
      .leftJoin(usuarios, eq(usuarios.id, lotes.generadoPor))
      .where(eq(lotes.contribuyenteId, contribuyenteId))
      .orderBy(desc(lotes.id));
    const archivos = await db.select().from(loteArchivos).where(eq(loteArchivos.contribuyenteId, contribuyenteId));
    return filas.map((f) => ({
      ...f.lote,
      generadoPorNombre: f.generadoPorNombre,
      archivos: archivos.filter((a) => a.loteId === f.lote.id).map(({ ruta: _ruta, ...a }) => a),
    }));
  });

  /** Conciliación previa: elegibles, no elegibles con motivo y totales (sección 18.6). */
  app.get("/preparar", async (request) => {
    const { contribuyenteId, anio, mes } = validar(esquemaPeriodo, request.query);
    exigirAccesoContribuyente(request.usuario!, contribuyenteId);
    return prepararLote(db, contribuyenteId, { anio, mes: mes ?? null });
  });

  app.post("/", async (request, reply) => {
    const datos = validar(esquemaGeneracion, request.body);
    exigirAccesoContribuyente(request.usuario!, datos.contribuyenteId);
    const lote = await db.transaction((tx) =>
      generarLoteDesdeSeleccion(
        tx,
        almacenamiento,
        { contribuyenteId: datos.contribuyenteId, periodo: { anio: datos.anio, mes: datos.mes ?? null }, ids: [...new Set(datos.ids)], formato: datos.formato, delimitadorCsv: datos.delimitadorCsv },
        request.usuario!,
        request,
      ),
    );
    reply.code(201);
    return lote;
  });

  app.get<{ Params: { id: string } }>("/:id", async (request) => {
    const id = Number(request.params.id);
    const [lote] = await db.select().from(lotes).where(eq(lotes.id, id));
    if (!lote) throw new ErrorHttp(404, "NO_ENCONTRADO", "Lote inexistente");
    exigirAccesoContribuyente(request.usuario!, lote.contribuyenteId);
    const archivos = (await db.select().from(loteArchivos).where(eq(loteArchivos.loteId, id))).map(({ ruta: _ruta, ...a }) => a);
    const filas = await db
      .select({
        id: loteComprobantes.id,
        comprobanteId: loteComprobantes.comprobanteId,
        loteArchivoId: loteComprobantes.loteArchivoId,
        fila: loteComprobantes.fila,
        estado: loteComprobantes.estado,
        errorDnit: loteComprobantes.errorDnit,
        campos: loteComprobantes.campos,
        numero: comprobantes.numero,
        tipoComprobante: comprobantes.tipoComprobante,
        fechaEmision: comprobantes.fechaEmision,
        total: comprobantes.total,
        proveedor: proveedores.razonSocial,
      })
      .from(loteComprobantes)
      .innerJoin(comprobantes, eq(comprobantes.id, loteComprobantes.comprobanteId))
      .leftJoin(proveedores, eq(proveedores.id, comprobantes.proveedorId))
      .where(eq(loteComprobantes.loteId, id))
      .orderBy(loteComprobantes.loteArchivoId, loteComprobantes.fila);
    return { lote, archivos, comprobantes: filas };
  });

  /** Descarga del ZIP tal como se generó; se verifica la huella antes de entregarlo. */
  app.get<{ Params: { id: string; archivoId: string } }>("/:id/archivos/:archivoId", async (request, reply) => {
    const [archivo] = await db
      .select({ archivo: loteArchivos, contribuyenteId: lotes.contribuyenteId })
      .from(loteArchivos)
      .innerJoin(lotes, eq(lotes.id, loteArchivos.loteId))
      .where(and(eq(loteArchivos.id, Number(request.params.archivoId)), eq(loteArchivos.loteId, Number(request.params.id))));
    if (!archivo) throw new ErrorHttp(404, "NO_ENCONTRADO", "Archivo inexistente");
    exigirAccesoContribuyente(request.usuario!, archivo.contribuyenteId);
    const contenido = await almacenamiento.leer(archivo.archivo.ruta);
    if (sha256(contenido) !== archivo.archivo.sha256Zip) {
      throw new ErrorHttp(500, "ARCHIVO_ALTERADO", "La huella del archivo no coincide con la registrada");
    }
    return reply
      .header("Content-Type", "application/zip")
      .header("Content-Disposition", `attachment; filename="${archivo.archivo.nombreZip}"`)
      .header("Cache-Control", "private, no-store")
      .send(contenido);
  });

  app.post<{ Params: { id: string } }>("/:id/anular", async (request) => {
    const { motivo } = validar(z.object({ motivo: z.string().trim().min(3, "Indicá el motivo").max(500) }), request.body);
    return db.transaction((tx) => anularLote(tx, Number(request.params.id), motivo, request.usuario!, request));
  });

  app.post<{ Params: { id: string } }>("/:id/enviado", async (request) => {
    const { fecha } = validar(z.object({ fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida") }), request.body);
    await db.transaction((tx) => marcarEnviado(tx, Number(request.params.id), fecha, request.usuario!, request));
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/:id/resultado", async (request) => {
    const datos = validar(esquemaResultado, request.body);
    await db.transaction((tx) => registrarResultado(tx, Number(request.params.id), datos, request.usuario!, request));
    return { ok: true };
  });
}
