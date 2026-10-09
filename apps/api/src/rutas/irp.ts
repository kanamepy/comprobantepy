import {
  esquemaIngreso,
  esquemaMovimientoIrp,
  esquemaParametrosIrp,
  esquemaTratamientoEgresos,
  validarTramos,
} from "@comprobantepy/shared";
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { registrarAuditoria } from "../auditoria.js";
import { ErrorHttp, exigirSesion } from "../auth/sesiones.js";
import type { BaseDeDatos } from "../db/conexion.js";
import { actividades, comprobantes, ingresos, irpCierres, irpMovimientos, irpParametros } from "../db/esquema.js";
import {
  calcularTablero,
  diferenciasConCierres,
  egresosIrp,
  exigirMotivoSiCerrado,
  parametrosDe,
  resumenParaCierre,
} from "../servicios/irp.js";
import { exigirAccesoContribuyente, exigirFinanciero } from "../servicios/lotes.js";
import { perfilesFlujo } from "../servicios/comprobantes.js";
import { validar } from "../validacion.js";

const parametrosRuta = z.object({ c: z.coerce.number().int().positive(), e: z.coerce.number().int().min(2021).max(2100) });
const soloContribuyente = z.object({ c: z.coerce.number().int().positive(), id: z.coerce.number().int().positive().optional() });
const motivoObligatorio = z.object({ motivo: z.string().trim().min(3, "Indicá el motivo").max(500) });

export async function rutasIrp(app: FastifyInstance, { db }: { db: BaseDeDatos }) {
  app.addHook("preHandler", exigirSesion);

  const acceso = (request: FastifyRequest, c: number) => exigirAccesoContribuyente(request.usuario!, c);
  /** El Financiero registra datos del IRP-RSP; el Auxiliar puede cargar ingresos y créditos como pendientes (sección 5). */
  const puedeCargar = (request: FastifyRequest, c: number) => {
    const perfiles = perfilesFlujo(request.usuario!, c);
    if (!perfiles.length) throw new ErrorHttp(403, "SIN_PERMISO", "Tu perfil no permite cargar datos del IRP-RSP");
    return perfiles.includes("FINANCIERO") ? "CONFIRMADO" : "PENDIENTE";
  };

  app.get("/:c/:e", async (request) => {
    const { c, e } = validar(parametrosRuta, request.params);
    acceso(request, c);
    return { tablero: await calcularTablero(db, c, e), cierres: await diferenciasConCierres(db, c, e) };
  });

  // ---------------------------------------------------------------- Egresos
  app.get("/:c/:e/egresos", async (request) => {
    const { c, e } = validar(parametrosRuta, request.params);
    acceso(request, c);
    return egresosIrp(db, c, e);
  });

  /** Confirmar el tratamiento de uno o varios egresos, o aceptar las sugerencias (sección 20.3). */
  app.post("/:c/egresos/tratamiento", async (request) => {
    const { c } = validar(soloContribuyente, request.params);
    acceso(request, c);
    exigirFinanciero(request.usuario!, c);
    const datos = validar(esquemaTratamientoEgresos, request.body);
    return db.transaction(async (tx) => {
      const filas = await tx.select().from(comprobantes).where(inArray(comprobantes.id, datos.ids));
      if (filas.length !== datos.ids.length || filas.some((f) => f.contribuyenteId !== c)) {
        throw new ErrorHttp(409, "MEZCLA_CONTRIBUYENTES", "Todos los comprobantes deben ser del mismo contribuyente");
      }
      const ejercicios = [...new Set(filas.map((f) => Number(f.fechaEmision?.slice(0, 4))))];
      const sugerencias = new Map<number, { tratamiento: string; porcentajeAdmitido: number | null }>();
      if (datos.usarSugerencia) {
        for (const e of ejercicios) for (const eg of await egresosIrp(tx, c, e)) sugerencias.set(eg.id, eg.sugerencia);
      }
      const aplicados: number[] = [];
      const excluidos: { id: number; motivo: string }[] = [];
      for (const fila of filas) {
        const sugerida = sugerencias.get(fila.id);
        const tratamiento = (datos.tratamiento ?? sugerida?.tratamiento) as typeof fila.irpTratamiento;
        if (!tratamiento || tratamiento === "PENDIENTE_ANALISIS") {
          excluidos.push({ id: fila.id, motivo: "Sin sugerencia: hay que analizarlo" });
          continue;
        }
        if (fila.fechaEmision) await exigirMotivoSiCerrado(tx, c, fila.fechaEmision, datos.motivo);
        const porcentaje = tratamiento === "PARCIAL" ? (datos.porcentajeAdmitido ?? sugerida?.porcentajeAdmitido ?? null) : null;
        await tx
          .update(comprobantes)
          .set({
            irpTratamiento: tratamiento,
            irpPorcentajeAdmitido: porcentaje === null ? null : String(porcentaje),
            irpTratamientoConfirmado: true,
            irpTratamientoMotivo: datos.motivo ?? null,
            actualizadoEn: new Date(),
          })
          .where(eq(comprobantes.id, fila.id));
        await registrarAuditoria(
          tx,
          {
            entidad: "comprobante",
            entidadId: fila.id,
            contribuyenteId: c,
            accion: "TRATAMIENTO_IRP",
            perfil: "FINANCIERO",
            valorAnterior: { tratamiento: fila.irpTratamiento, porcentaje: fila.irpPorcentajeAdmitido, confirmado: fila.irpTratamientoConfirmado },
            valorNuevo: { tratamiento, porcentaje, confirmado: true },
            motivo: datos.motivo ?? null,
          },
          request,
        );
        aplicados.push(fila.id);
      }
      return { aplicados, excluidos };
    });
  });

  // ---------------------------------------------------------------- Ingresos
  app.get("/:c/:e/ingresos", async (request) => {
    const { c, e } = validar(parametrosRuta, request.params);
    acceso(request, c);
    return db
      .select({ ingreso: ingresos, actividad: actividades.descripcion })
      .from(ingresos)
      .leftJoin(actividades, eq(actividades.id, ingresos.actividadId))
      .where(and(eq(ingresos.contribuyenteId, c), gte(ingresos.fecha, `${e}-01-01`), lte(ingresos.fecha, `${e}-12-31`)))
      .orderBy(asc(ingresos.fecha), asc(ingresos.id))
      .then((filas) => filas.map((f) => ({ ...f.ingreso, actividad: f.actividad })));
  });

  async function validarActividad(c: number, actividadId: number | null | undefined) {
    if (!actividadId) return;
    const [a] = await db.select({ id: actividades.id }).from(actividades).where(and(eq(actividades.id, actividadId), eq(actividades.contribuyenteId, c)));
    if (!a) throw new ErrorHttp(400, "DATOS_INVALIDOS", "Revisá los datos ingresados", { actividadId: "La actividad no pertenece al contribuyente" });
  }

  app.post("/:c/ingresos", async (request, reply) => {
    const { c } = validar(soloContribuyente, request.params);
    acceso(request, c);
    const estado = puedeCargar(request, c);
    const { motivo, ...datos } = validar(esquemaIngreso, request.body);
    await validarActividad(c, datos.actividadId);
    const creado = await db.transaction(async (tx) => {
      const cierre = await exigirMotivoSiCerrado(tx, c, datos.fecha, motivo);
      const [fila] = await tx
        .insert(ingresos)
        .values({ ...datos, contribuyenteId: c, importe: String(datos.importe), estado, creadoPor: request.usuario!.id })
        .returning();
      await registrarAuditoria(tx, { entidad: "ingreso", entidadId: fila!.id, contribuyenteId: c, accion: cierre ? "CREAR_POST_CIERRE" : "CREAR", valorNuevo: fila, motivo: motivo ?? null }, request);
      return fila;
    });
    reply.code(201);
    return creado;
  });

  app.patch("/:c/ingresos/:id", async (request) => {
    const { c, id } = validar(soloContribuyente, request.params);
    acceso(request, c);
    exigirFinanciero(request.usuario!, c);
    const { motivo, ...cambios } = validar(esquemaIngreso.partial(), request.body);
    await validarActividad(c, cambios.actividadId);
    return db.transaction(async (tx) => {
      const [anterior] = await tx.select().from(ingresos).where(and(eq(ingresos.id, id!), eq(ingresos.contribuyenteId, c)));
      if (!anterior || anterior.estado === "ANULADO") throw new ErrorHttp(404, "NO_ENCONTRADO", "Ingreso inexistente");
      // Si cambia la fecha, se controlan el período original y el nuevo.
      const cierre = (await exigirMotivoSiCerrado(tx, c, anterior.fecha, motivo)) ?? (cambios.fecha ? await exigirMotivoSiCerrado(tx, c, cambios.fecha, motivo) : null);
      const [fila] = await tx
        .update(ingresos)
        .set({ ...cambios, importe: cambios.importe === undefined ? undefined : String(cambios.importe), actualizadoEn: new Date() })
        .where(eq(ingresos.id, id!))
        .returning();
      await registrarAuditoria(tx, { entidad: "ingreso", entidadId: id, contribuyenteId: c, accion: cierre ? "EDITAR_POST_CIERRE" : "EDITAR", valorAnterior: anterior, valorNuevo: fila, motivo: motivo ?? null }, request);
      return fila;
    });
  });

  app.post("/:c/ingresos/:id/confirmar", async (request) => {
    const { c, id } = validar(soloContribuyente, request.params);
    acceso(request, c);
    exigirFinanciero(request.usuario!, c);
    const [fila] = await db
      .update(ingresos)
      .set({ estado: "CONFIRMADO", actualizadoEn: new Date() })
      .where(and(eq(ingresos.id, id!), eq(ingresos.contribuyenteId, c), eq(ingresos.estado, "PENDIENTE")))
      .returning();
    if (!fila) throw new ErrorHttp(409, "ESTADO_INVALIDO", "El ingreso no está pendiente");
    await registrarAuditoria(db, { entidad: "ingreso", entidadId: id, contribuyenteId: c, accion: "CONFIRMAR" }, request);
    return fila;
  });

  app.post("/:c/ingresos/:id/anular", async (request) => {
    const { c, id } = validar(soloContribuyente, request.params);
    acceso(request, c);
    exigirFinanciero(request.usuario!, c);
    const { motivo } = validar(motivoObligatorio, request.body);
    return db.transaction(async (tx) => {
      const [anterior] = await tx.select().from(ingresos).where(and(eq(ingresos.id, id!), eq(ingresos.contribuyenteId, c)));
      if (!anterior || anterior.estado === "ANULADO") throw new ErrorHttp(404, "NO_ENCONTRADO", "Ingreso inexistente");
      const cierre = await exigirMotivoSiCerrado(tx, c, anterior.fecha, motivo);
      const [fila] = await tx.update(ingresos).set({ estado: "ANULADO", anuladoMotivo: motivo, actualizadoEn: new Date() }).where(eq(ingresos.id, id!)).returning();
      await registrarAuditoria(tx, { entidad: "ingreso", entidadId: id, contribuyenteId: c, accion: cierre ? "ANULAR_POST_CIERRE" : "ANULAR", valorAnterior: anterior, motivo }, request);
      return fila;
    });
  });

  // ---------------------------------------------------------------- Créditos y saldos
  app.get("/:c/:e/movimientos", async (request) => {
    const { c, e } = validar(parametrosRuta, request.params);
    acceso(request, c);
    return db
      .select()
      .from(irpMovimientos)
      .where(and(eq(irpMovimientos.contribuyenteId, c), eq(irpMovimientos.ejercicio, e)))
      .orderBy(asc(irpMovimientos.fecha), asc(irpMovimientos.id));
  });

  app.post("/:c/:e/movimientos", async (request, reply) => {
    const { c, e } = validar(parametrosRuta, request.params);
    acceso(request, c);
    const estado = puedeCargar(request, c);
    const { motivo, ...datos } = validar(esquemaMovimientoIrp, request.body);
    const creado = await db.transaction(async (tx) => {
      const cierre = await exigirMotivoSiCerrado(tx, c, datos.fecha, motivo);
      const [fila] = await tx
        .insert(irpMovimientos)
        .values({ ...datos, contribuyenteId: c, ejercicio: e, importe: String(datos.importe), estado, creadoPor: request.usuario!.id })
        .returning();
      await registrarAuditoria(tx, { entidad: "irp_movimiento", entidadId: fila!.id, contribuyenteId: c, accion: cierre ? "CREAR_POST_CIERRE" : "CREAR", valorNuevo: fila, motivo: motivo ?? null }, request);
      return fila;
    });
    reply.code(201);
    return creado;
  });

  app.post("/:c/movimientos/:id/confirmar", async (request) => {
    const { c, id } = validar(soloContribuyente, request.params);
    acceso(request, c);
    exigirFinanciero(request.usuario!, c);
    const [fila] = await db
      .update(irpMovimientos)
      .set({ estado: "CONFIRMADO", actualizadoEn: new Date() })
      .where(and(eq(irpMovimientos.id, id!), eq(irpMovimientos.contribuyenteId, c), eq(irpMovimientos.estado, "PENDIENTE")))
      .returning();
    if (!fila) throw new ErrorHttp(409, "ESTADO_INVALIDO", "El movimiento no está pendiente");
    await registrarAuditoria(db, { entidad: "irp_movimiento", entidadId: id, contribuyenteId: c, accion: "CONFIRMAR" }, request);
    return fila;
  });

  app.post("/:c/movimientos/:id/anular", async (request) => {
    const { c, id } = validar(soloContribuyente, request.params);
    acceso(request, c);
    exigirFinanciero(request.usuario!, c);
    const { motivo } = validar(motivoObligatorio, request.body);
    return db.transaction(async (tx) => {
      const [anterior] = await tx.select().from(irpMovimientos).where(and(eq(irpMovimientos.id, id!), eq(irpMovimientos.contribuyenteId, c)));
      if (!anterior || anterior.estado === "ANULADO") throw new ErrorHttp(404, "NO_ENCONTRADO", "Movimiento inexistente");
      const cierre = await exigirMotivoSiCerrado(tx, c, anterior.fecha, motivo);
      const [fila] = await tx.update(irpMovimientos).set({ estado: "ANULADO", anuladoMotivo: motivo, actualizadoEn: new Date() }).where(eq(irpMovimientos.id, id!)).returning();
      await registrarAuditoria(tx, { entidad: "irp_movimiento", entidadId: id, contribuyenteId: c, accion: cierre ? "ANULAR_POST_CIERRE" : "ANULAR", valorAnterior: anterior, motivo }, request);
      return fila;
    });
  });

  // ---------------------------------------------------------------- Cierres (sección 20.7)
  app.post("/:c/:e/cierres", async (request, reply) => {
    const { c, e } = validar(parametrosRuta, request.params);
    acceso(request, c);
    exigirFinanciero(request.usuario!, c);
    const { mes } = validar(z.object({ mes: z.number().int().min(1).max(12).nullable() }), request.body);
    const creado = await db.transaction(async (tx) => {
      const tablero = await calcularTablero(tx, c, e, mes ?? undefined);
      const [fila] = await tx
        .insert(irpCierres)
        .values({ contribuyenteId: c, ejercicio: e, mes, fotografia: { resumen: resumenParaCierre(tablero), tablero }, cerradoPor: request.usuario!.id })
        .onConflictDoNothing()
        .returning();
      if (!fila) throw new ErrorHttp(409, "YA_CERRADO", mes ? "Ese mes ya está cerrado" : "El ejercicio ya está cerrado");
      await registrarAuditoria(tx, { entidad: "irp_cierre", entidadId: fila.id, contribuyenteId: c, accion: mes ? "CIERRE_MENSUAL" : "CIERRE_ANUAL", valorNuevo: { ejercicio: e, mes, resumen: resumenParaCierre(tablero) } }, request);
      return fila;
    });
    reply.code(201);
    return { ...creado, fotografia: undefined };
  });

  /** La reapertura requiere autorización (perfil Financiero) y motivo; queda auditada. */
  app.post("/:c/cierres/:id/reabrir", async (request) => {
    const { c, id } = validar(soloContribuyente, request.params);
    acceso(request, c);
    exigirFinanciero(request.usuario!, c);
    const { motivo } = validar(motivoObligatorio, request.body);
    const [fila] = await db
      .update(irpCierres)
      .set({ estado: "REABIERTO", reabiertoPor: request.usuario!.id, reabiertoEn: new Date(), motivoReapertura: motivo })
      .where(and(eq(irpCierres.id, id!), eq(irpCierres.contribuyenteId, c), eq(irpCierres.estado, "CERRADO")))
      .returning();
    if (!fila) throw new ErrorHttp(404, "NO_ENCONTRADO", "Cierre inexistente o ya reabierto");
    await registrarAuditoria(db, { entidad: "irp_cierre", entidadId: id, contribuyenteId: c, accion: "REAPERTURA", motivo }, request);
    return { ...fila, fotografia: undefined };
  });

  // ---------------------------------------------------------------- Parámetros por ejercicio (RF-038)
  app.get("/parametros/:e", async (request) => {
    const { e } = validar(z.object({ e: z.coerce.number().int().min(2021).max(2100) }), request.params);
    return parametrosDe(db, e);
  });

  app.put("/parametros/:e", async (request) => {
    const { e } = validar(z.object({ e: z.coerce.number().int().min(2021).max(2100) }), request.params);
    if (!request.usuario!.perfiles.some((p) => p.perfil === "FINANCIERO")) {
      throw new ErrorHttp(403, "SIN_PERMISO", "Solo el perfil Financiero modifica tasas y tramos");
    }
    const datos = validar(esquemaParametrosIrp, request.body);
    const errores = validarTramos(datos.tramos);
    if (errores.length) throw new ErrorHttp(400, "DATOS_INVALIDOS", errores.join("; "), { tramos: errores.join("; ") });
    return db.transaction(async (tx) => {
      const anterior = await parametrosDe(tx, e);
      const [fila] = await tx
        .insert(irpParametros)
        .values({ ejercicio: e, ...datos, version: anterior.version + 1, actualizadoPor: request.usuario!.id })
        .onConflictDoUpdate({
          target: irpParametros.ejercicio,
          set: { ...datos, version: anterior.version + 1, actualizadoPor: request.usuario!.id, actualizadoEn: new Date() },
        })
        .returning();
      await registrarAuditoria(tx, { entidad: "irp_parametros", entidadId: e, accion: "EDITAR", valorAnterior: anterior, valorNuevo: fila }, request);
      return fila;
    });
  });
}
