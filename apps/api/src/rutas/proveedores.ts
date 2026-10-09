import { esquemaVerificacionTimbrado } from "@comprobantepy/shared";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { registrarAuditoria } from "../auditoria.js";
import { ErrorHttp, exigirSesion } from "../auth/sesiones.js";
import type { BaseDeDatos } from "../db/conexion.js";
import { proveedores, timbrados } from "../db/esquema.js";
import { puedeVerPendientes, reevaluarPorProveedor } from "../servicios/comprobantes.js";
import { validar } from "../validacion.js";

const esquemaEdicionProveedor = z
  .object({
    razonSocial: z.string().trim().min(2, "Ingresá la razón social").max(250),
    nombreFantasia: z.string().trim().max(250).nullable(),
    dv: z.number().int().min(0).max(9).nullable(),
    emisorElectronico: z.boolean(),
    emisorVirtual: z.boolean(),
  })
  .partial();

const esquemaEstadoProveedor = z.object({
  estado: z.enum(["CONFIRMADO", "OBSERVADO", "RECHAZADO", "PENDIENTE_DE_CONFIRMAR"]),
  motivo: z.string().trim().max(500).optional(),
});

export async function rutasProveedores(app: FastifyInstance, { db }: { db: BaseDeDatos }) {
  app.addHook("preHandler", exigirSesion);
  app.addHook("preHandler", async (request) => {
    if (!puedeVerPendientes(request.usuario!)) throw new ErrorHttp(403, "SIN_PERMISO", "Tu perfil no permite ver proveedores");
  });

  /** El Financiero de algún contribuyente administra el maestro compartido de proveedores. */
  function exigirFinanciero(request: { usuario: { perfiles: { perfil: string }[] } | null }) {
    if (!request.usuario?.perfiles.some((p) => p.perfil === "FINANCIERO")) {
      throw new ErrorHttp(403, "SIN_PERMISO", "Solo el perfil Financiero puede modificar proveedores y timbrados");
    }
  }

  /** Con contribuyenteId, solo los proveedores con comprobantes de ese contribuyente. */
  app.get("/", async (request) => {
    const { estado, contribuyenteId } = request.query as { estado?: string; contribuyenteId?: string };
    const contribuyente = contribuyenteId ? Number(contribuyenteId) : null;
    const cantidad = contribuyente
      ? sql<number>`(SELECT count(*)::int FROM comprobantes c WHERE c.proveedor_id = ${proveedores.id} AND c.estado_flujo <> 'ANULADO' AND c.contribuyente_id = ${contribuyente})`
      : sql<number>`(SELECT count(*)::int FROM comprobantes c WHERE c.proveedor_id = ${proveedores.id} AND c.estado_flujo <> 'ANULADO')`;
    const filas = await db
      .select({ proveedor: proveedores, comprobantes: cantidad })
      .from(proveedores)
      .where(
        and(
          estado ? eq(proveedores.estado, estado as "CONFIRMADO") : undefined,
          contribuyente
            ? sql`EXISTS (SELECT 1 FROM comprobantes c WHERE c.proveedor_id = ${proveedores.id} AND c.contribuyente_id = ${contribuyente})`
            : undefined,
        ),
      )
      .orderBy(asc(proveedores.razonSocial));
    return filas.map((f) => ({ ...f.proveedor, comprobantes: f.comprobantes }));
  });

  app.get<{ Params: { id: string } }>("/:id", async (request) => {
    const id = Number(request.params.id);
    const [proveedor] = await db.select().from(proveedores).where(eq(proveedores.id, id));
    if (!proveedor) throw new ErrorHttp(404, "NO_ENCONTRADO", "Proveedor inexistente");
    const listaTimbrados = await db.select().from(timbrados).where(eq(timbrados.proveedorId, id)).orderBy(desc(timbrados.numero));
    // Posibles coincidencias por nombre (sección 11.2).
    const parecidos = await db
      .select({ id: proveedores.id, razonSocial: proveedores.razonSocial, numeroIdentificacion: proveedores.numeroIdentificacion, estado: proveedores.estado })
      .from(proveedores)
      .where(
        and(
          sql`${proveedores.id} <> ${id}`,
          sql`lower(${proveedores.razonSocial}) = lower(${proveedor.razonSocial})`,
        ),
      );
    return { proveedor, timbrados: listaTimbrados, coincidencias: parecidos };
  });

  app.patch<{ Params: { id: string } }>("/:id", async (request) => {
    exigirFinanciero(request);
    const id = Number(request.params.id);
    const cambios = validar(esquemaEdicionProveedor, request.body);
    return db.transaction(async (tx) => {
      const [anterior] = await tx.select().from(proveedores).where(eq(proveedores.id, id));
      if (!anterior) throw new ErrorHttp(404, "NO_ENCONTRADO", "Proveedor inexistente");
      const [actualizado] = await tx.update(proveedores).set({ ...cambios, actualizadoEn: new Date() }).where(eq(proveedores.id, id)).returning();
      await registrarAuditoria(tx, { entidad: "proveedor", entidadId: id, accion: "EDITAR", valorAnterior: anterior, valorNuevo: actualizado }, request);
      await reevaluarPorProveedor(tx, id);
      return actualizado;
    });
  });

  /** Confirmar, observar o rechazar un proveedor (sección 11.2). */
  app.post<{ Params: { id: string } }>("/:id/estado", async (request) => {
    exigirFinanciero(request);
    const id = Number(request.params.id);
    const { estado, motivo } = validar(esquemaEstadoProveedor, request.body);
    if (estado !== "CONFIRMADO" && !motivo) {
      throw new ErrorHttp(400, "MOTIVO_REQUERIDO", "Indicá el motivo", { motivo: "Indicá el motivo" });
    }
    return db.transaction(async (tx) => {
      const [anterior] = await tx.select().from(proveedores).where(eq(proveedores.id, id));
      if (!anterior) throw new ErrorHttp(404, "NO_ENCONTRADO", "Proveedor inexistente");
      const [actualizado] = await tx
        .update(proveedores)
        .set({
          estado,
          observacion: motivo ?? null,
          confirmadoPor: estado === "CONFIRMADO" ? request.usuario!.id : anterior.confirmadoPor,
          confirmadoEn: estado === "CONFIRMADO" ? new Date() : anterior.confirmadoEn,
          actualizadoEn: new Date(),
        })
        .where(eq(proveedores.id, id))
        .returning();
      await registrarAuditoria(
        tx,
        { entidad: "proveedor", entidadId: id, accion: `ESTADO_${estado}`, valorAnterior: { estado: anterior.estado }, valorNuevo: { estado }, motivo: motivo ?? null },
        request,
      );
      const recalculados = await reevaluarPorProveedor(tx, id);
      return { proveedor: actualizado, comprobantesRecalculados: recalculados };
    });
  });

  /** Verificación manual documentada del timbrado, reutilizable para otros comprobantes (sección 11.4). */
  app.post<{ Params: { id: string } }>("/timbrados/:id/verificacion", async (request) => {
    exigirFinanciero(request);
    const id = Number(request.params.id);
    const datos = validar(esquemaVerificacionTimbrado, request.body);
    if (datos.vigenciaDesde && datos.vigenciaHasta && datos.vigenciaDesde > datos.vigenciaHasta) {
      throw new ErrorHttp(400, "DATOS_INVALIDOS", "Revisá los datos ingresados", { vigenciaHasta: "La vigencia termina antes de empezar" });
    }
    return db.transaction(async (tx) => {
      const [anterior] = await tx.select().from(timbrados).where(eq(timbrados.id, id));
      if (!anterior) throw new ErrorHttp(404, "NO_ENCONTRADO", "Timbrado inexistente");
      const [actualizado] = await tx
        .update(timbrados)
        .set({
          estadoVerificacion: datos.resultado,
          vigenciaDesde: datos.vigenciaDesde ?? null,
          vigenciaHasta: datos.vigenciaHasta ?? null,
          consultaEn: new Date(datos.consultaEn),
          verificadoPor: request.usuario!.id,
          evidenciaArchivoId: datos.evidenciaArchivoId ?? null,
          observacion: datos.observacion ?? null,
          actualizadoEn: new Date(),
        })
        .where(eq(timbrados.id, id))
        .returning();
      await registrarAuditoria(
        tx,
        { entidad: "timbrado", entidadId: id, accion: "VERIFICACION_MANUAL", valorAnterior: anterior, valorNuevo: actualizado },
        request,
      );
      const recalculados = await reevaluarPorProveedor(tx, anterior.proveedorId);
      return { timbrado: actualizado, comprobantesRecalculados: recalculados };
    });
  });

}
