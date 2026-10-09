import {
  accionesDisponibles,
  calcularElegibilidad,
  destinoExportacion,
  esBloqueante,
  esquemaAccion,
  esquemaAccionMasiva,
  esquemaClasificacionMasiva,
  esquemaEdicionComprobante,
  esquemaImputacion,
  ESTADOS_FLUJO,
  resultadoVacio,
  type EstadoFlujo,
  type NaturalezaFiscal,
  type Problema,
} from "@comprobantepy/shared";
import { aliasedTable, and, desc, eq, ilike, inArray, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Almacenamiento } from "../archivos/almacenamiento.js";
import { ErrorHttp, exigirSesion } from "../auth/sesiones.js";
import type { BaseDeDatos } from "../db/conexion.js";
import {
  actividades,
  archivos,
  auditoria,
  comprobanteArchivos,
  comprobantes,
  contribuyentes,
  imputaciones,
  mensajeArchivos,
  mensajesCorreo,
  obligaciones,
  proveedores,
  timbrados,
  usuarios,
} from "../db/esquema.js";
import { procesarArchivo, type ResultadoCarga } from "../servicios/carga.js";
import { encolarLectura } from "../servicios/trabajos.js";
import {
  AVISO_LEYENDO,
  altaDesdeExtraccion,
  buscarPosiblesDuplicados,
  editarComprobante,
  ejecutarAccion,
  estadoTimbrado,
  exigirPerfil,
  exigirVisible,
  guardarImputacion,
  idsVisibles,
  obligacionesActivas,
  perfilesFlujo,
  puedeVerPendientes,
  type FilaComprobante,
  type ResultadoAccion,
} from "../servicios/comprobantes.js";
import { validar } from "../validacion.js";

const esquemaFiltros = z.object({
  contribuyenteId: z.coerce.number().int().positive().optional(),
  estado: z.enum(ESTADOS_FLUJO).optional(),
  naturaleza: z.enum(["FISICO", "ELECTRONICO", "VIRTUAL", "NO_DETERMINADA"]).optional(),
  proveedorId: z.coerce.number().int().positive().optional(),
  buscar: z.string().trim().max(100).optional(),
  incluirAnulados: z.enum(["true", "false"]).optional(),
  limite: z.coerce.number().int().min(1).max(500).default(200),
});

const esquemaAltaManual = z.object({
  contribuyenteId: z.number().int().positive().nullable().optional(),
  naturaleza: z.enum(["FISICO", "ELECTRONICO", "VIRTUAL", "NO_DETERMINADA"]).optional(),
});

/** Quita los datos sensibles antes de responder. */
function publico(fila: FilaComprobante) {
  const { numeroCuentaCifrado: _cifrado, ...resto } = fila;
  return resto;
}

function resumenProblemas(problemas: Problema[]) {
  return {
    faltanDatos: problemas.filter((p) => p.severidad === "FALTA_DATO").length,
    errores: problemas.filter((p) => p.severidad === "ERROR").length,
    advertencias: problemas.filter((p) => p.severidad === "ADVERTENCIA").length,
  };
}

export async function rutasComprobantes(
  app: FastifyInstance,
  { db, almacenamiento }: { db: BaseDeDatos; almacenamiento: Almacenamiento },
) {
  app.addHook("preHandler", exigirSesion);

  /** Carga de uno o varios archivos (RF-002, RF-003). */
  app.post("/carga", async (request) => {
    const usuario = request.usuario!;
    if (!puedeVerPendientes(usuario)) throw new ErrorHttp(403, "SIN_PERMISO", "Tu perfil no permite cargar comprobantes");
    const partes = request.parts();
    const campos: Record<string, string> = {};
    const archivosRecibidos: { nombre: string; contenido: Buffer }[] = [];
    for await (const parte of partes) {
      if (parte.type === "file") {
        archivosRecibidos.push({ nombre: parte.filename || "archivo", contenido: await parte.toBuffer() });
      } else {
        campos[parte.fieldname] = String(parte.value);
      }
    }
    if (archivosRecibidos.length === 0) throw new ErrorHttp(400, "SIN_ARCHIVOS", "Adjuntá al menos un archivo");
    const contribuyenteSugerido = campos.contribuyenteId ? Number(campos.contribuyenteId) : null;
    const naturaleza = ["FISICO", "ELECTRONICO", "VIRTUAL"].includes(campos.naturaleza ?? "")
      ? (campos.naturaleza as NaturalezaFiscal)
      : null;
    const canal = campos.canal === "CAMARA" ? "CAMARA" : "CARGA";

    const resultados: ResultadoCarga[] = [];
    for (const archivo of archivosRecibidos) {
      resultados.push(
        await procesarArchivo(
          db,
          almacenamiento,
          { ...archivo, canal },
          { contribuyenteSugerido, naturalezaIndicada: naturaleza },
          usuario,
          request,
        ),
      );
    }
    return { resultados };
  });

  /** Carga manual sin archivo (mecanismo alternativo, sección 1). */
  app.post("/", async (request, reply) => {
    const usuario = request.usuario!;
    const { contribuyenteId, naturaleza } = validar(esquemaAltaManual, request.body ?? {});
    const resultado = await db.transaction((tx) =>
      altaDesdeExtraccion(tx, {
        extraccion: resultadoVacio(),
        canal: "MANUAL",
        estadoTecnico: "EXTRAIDO",
        archivoId: null,
        contribuyenteSugerido: contribuyenteId ?? null,
        naturalezaIndicada: naturaleza ?? null,
        usuario,
        request,
      }),
    );
    reply.code(201);
    return resultado;
  });

  app.get("/", async (request) => {
    const usuario = request.usuario!;
    const filtros = validar(esquemaFiltros, request.query);
    const visibles = idsVisibles(usuario);
    const alcance: SQL[] = [];
    if (visibles.length) alcance.push(inArray(comprobantes.contribuyenteId, visibles));
    if (puedeVerPendientes(usuario)) alcance.push(isNull(comprobantes.contribuyenteId));
    if (alcance.length === 0) return { comprobantes: [] };

    const condiciones: (SQL | undefined)[] = [or(...alcance)];
    if (filtros.contribuyenteId) condiciones.push(eq(comprobantes.contribuyenteId, filtros.contribuyenteId));
    if (filtros.estado) condiciones.push(eq(comprobantes.estadoFlujo, filtros.estado));
    else if (filtros.incluirAnulados !== "true") condiciones.push(ne(comprobantes.estadoFlujo, "ANULADO"));
    if (filtros.naturaleza) condiciones.push(eq(comprobantes.naturaleza, filtros.naturaleza));
    if (filtros.proveedorId) condiciones.push(eq(comprobantes.proveedorId, filtros.proveedorId));
    if (filtros.buscar) {
      const patron = `%${filtros.buscar}%`;
      condiciones.push(
        or(
          ilike(comprobantes.numero, patron),
          ilike(proveedores.razonSocial, patron),
          ilike(proveedores.numeroIdentificacion, patron),
          ilike(comprobantes.cdc, patron),
        ),
      );
    }

    const filas = await db
      .select({
        comprobante: comprobantes,
        proveedor: { id: proveedores.id, razonSocial: proveedores.razonSocial, numeroIdentificacion: proveedores.numeroIdentificacion, dv: proveedores.dv, estado: proveedores.estado },
        contribuyente: { id: contribuyentes.id, nombre: contribuyentes.nombre },
        timbrado: timbrados,
        archivoId: sql<number | null>`(SELECT min(ca.archivo_id) FROM comprobante_archivos ca WHERE ca.comprobante_id = ${comprobantes.id})`,
        imputaciones: sql<string[]>`COALESCE((SELECT array_agg(DISTINCT i.obligacion_codigo) FROM imputaciones i WHERE i.comprobante_id = ${comprobantes.id}), '{}')`,
      })
      .from(comprobantes)
      .leftJoin(proveedores, eq(proveedores.id, comprobantes.proveedorId))
      .leftJoin(contribuyentes, eq(contribuyentes.id, comprobantes.contribuyenteId))
      .leftJoin(timbrados, eq(timbrados.id, comprobantes.timbradoId))
      .where(and(...condiciones))
      .orderBy(desc(comprobantes.creadoEn))
      .limit(filtros.limite);

    return {
      comprobantes: filas.map((f) => {
        const problemas = f.comprobante.problemas as Problema[];
        return {
          ...publico(f.comprobante),
          proveedor: f.proveedor,
          contribuyente: f.contribuyente,
          archivoId: f.archivoId,
          obligaciones: f.imputaciones,
          estadoTimbrado: estadoTimbrado(f.timbrado, f.comprobante.fechaEmision),
          destino: f.comprobante.tipoComprobante ? destinoExportacion(f.comprobante.tipoComprobante, f.comprobante.naturaleza) : null,
          elegibilidad: calcularElegibilidad({
            naturaleza: f.comprobante.naturaleza,
            tipoComprobante: f.comprobante.tipoComprobante,
            estadoFlujo: f.comprobante.estadoFlujo as EstadoFlujo,
            tieneBloqueantes: problemas.some(esBloqueante),
            estadoMarangatu: f.comprobante.estadoMarangatu,
          }),
          resumenProblemas: resumenProblemas(problemas),
          acciones: accionesDisponibles(f.comprobante.estadoFlujo as EstadoFlujo, perfilesFlujo(usuario, f.comprobante.contribuyenteId)),
        };
      }),
    };
  });

  app.get<{ Params: { id: string } }>("/:id", async (request) => {
    const usuario = request.usuario!;
    const id = Number(request.params.id);
    const [fila] = await db.select().from(comprobantes).where(eq(comprobantes.id, id));
    if (!fila) throw new ErrorHttp(404, "NO_ENCONTRADO", "Comprobante inexistente");
    exigirVisible(usuario, fila);

    const [proveedor] = fila.proveedorId ? await db.select().from(proveedores).where(eq(proveedores.id, fila.proveedorId)) : [];
    const [timbrado] = fila.timbradoId ? await db.select().from(timbrados).where(eq(timbrados.id, fila.timbradoId)) : [];
    const [contribuyente] = fila.contribuyenteId
      ? await db.select({ id: contribuyentes.id, nombre: contribuyentes.nombre }).from(contribuyentes).where(eq(contribuyentes.id, fila.contribuyenteId))
      : [];
    const listaArchivos = await db
      .select({ id: archivos.id, nombreOriginal: archivos.nombreOriginal, tipoMime: archivos.tipoMime, tipoDetectado: archivos.tipoDetectado, tamano: archivos.tamano, sha256: archivos.sha256, canal: archivos.canal, creadoEn: archivos.creadoEn })
      .from(comprobanteArchivos)
      .innerJoin(archivos, eq(archivos.id, comprobanteArchivos.archivoId))
      .where(eq(comprobanteArchivos.comprobanteId, id))
      .orderBy(archivos.id);
    // Correos por los que llegó (puede ser más de uno, sección 12).
    const correos = listaArchivos.length
      ? await db
          .selectDistinct({
            id: mensajesCorreo.id,
            remitenteOriginal: mensajesCorreo.remitenteOriginal,
            reenviadoPor: mensajesCorreo.reenviadoPor,
            asunto: mensajesCorreo.asunto,
            fecha: mensajesCorreo.fecha,
          })
          .from(mensajeArchivos)
          .innerJoin(mensajesCorreo, eq(mensajesCorreo.id, mensajeArchivos.mensajeId))
          .where(inArray(mensajeArchivos.archivoId, listaArchivos.map((a) => a.id)))
      : [];
    const lineas = await db
      .select({ id: imputaciones.id, obligacion: imputaciones.obligacionCodigo, actividadId: imputaciones.actividadId, actividad: actividades.descripcion, porcentaje: imputaciones.porcentaje })
      .from(imputaciones)
      .leftJoin(actividades, eq(actividades.id, imputaciones.actividadId))
      .where(eq(imputaciones.comprobanteId, id))
      .orderBy(imputaciones.id);
    const usuarioAuditoria = aliasedTable(usuarios, "usuario_auditoria");
    const historial = await db
      .select({ id: auditoria.id, ocurridoEn: auditoria.ocurridoEn, accion: auditoria.accion, motivo: auditoria.motivo, valorAnterior: auditoria.valorAnterior, valorNuevo: auditoria.valorNuevo, usuario: usuarioAuditoria.nombre })
      .from(auditoria)
      .leftJoin(usuarioAuditoria, eq(usuarioAuditoria.id, auditoria.usuarioId))
      .where(and(eq(auditoria.entidad, "comprobante"), eq(auditoria.entidadId, String(id))))
      .orderBy(desc(auditoria.id));
    const posibles = await buscarPosiblesDuplicados(db, fila);
    const problemas = fila.problemas as Problema[];
    const activas = await obligacionesActivas(db, fila.contribuyenteId, fila.fechaEmision);
    const listaActividades = fila.contribuyenteId
      ? await db
          .select({ id: actividades.id, descripcion: actividades.descripcion })
          .from(actividades)
          .where(and(eq(actividades.contribuyenteId, fila.contribuyenteId), eq(actividades.estado, "ACTIVO")))
      : [];
    const catalogoObligaciones = await db.select().from(obligaciones).where(eq(obligaciones.estado, "ACTIVO"));

    return {
      comprobante: publico(fila),
      proveedor: proveedor ?? null,
      timbrado: timbrado ? { ...timbrado, estado: estadoTimbrado(timbrado, fila.fechaEmision) } : null,
      contribuyente: contribuyente ?? null,
      archivos: listaArchivos,
      correos,
      imputacion: { lineas, porcentajeNoImputado: fila.porcentajeNoImputado },
      problemas,
      destino: fila.tipoComprobante ? destinoExportacion(fila.tipoComprobante, fila.naturaleza) : null,
      elegibilidad: calcularElegibilidad({
        naturaleza: fila.naturaleza,
        tipoComprobante: fila.tipoComprobante,
        estadoFlujo: fila.estadoFlujo as EstadoFlujo,
        tieneBloqueantes: problemas.some(esBloqueante),
        estadoMarangatu: fila.estadoMarangatu,
      }),
      acciones: accionesDisponibles(fila.estadoFlujo as EstadoFlujo, perfilesFlujo(usuario, fila.contribuyenteId)),
      posiblesDuplicados: posibles,
      historial,
      obligacionesActivas: catalogoObligaciones.filter((o) => activas.has(o.codigo)),
      actividades: listaActividades,
    };
  });

  app.patch<{ Params: { id: string } }>("/:id", async (request) => {
    const cambios = validar(esquemaEdicionComprobante, request.body);
    const fila = await db.transaction((tx) => editarComprobante(tx, Number(request.params.id), cambios, request.usuario!, request));
    return { comprobante: publico(fila) };
  });

  /** Vuelve a leer automáticamente las imágenes y PDF escaneados del comprobante. */
  app.post<{ Params: { id: string } }>("/:id/releer", async (request) => {
    const id = Number(request.params.id);
    const [fila] = await db.select().from(comprobantes).where(eq(comprobantes.id, id));
    if (!fila) throw new ErrorHttp(404, "NO_ENCONTRADO", "Comprobante inexistente");
    exigirVisible(request.usuario!, fila);
    exigirPerfil(request.usuario!, fila.contribuyenteId, ["AUXILIAR", "FINANCIERO"]);
    const lista = await db
      .select({ id: archivos.id, tipo: archivos.tipoDetectado })
      .from(comprobanteArchivos)
      .innerJoin(archivos, eq(archivos.id, comprobanteArchivos.archivoId))
      .where(eq(comprobanteArchivos.comprobanteId, id));
    const leibles = lista.filter((a) => a.tipo !== "XML");
    if (!leibles.length) throw new ErrorHttp(409, "SIN_IMAGENES", "El comprobante no tiene imágenes ni PDF para leer");
    await db.transaction(async (tx) => {
      for (const a of leibles) await encolarLectura(tx, id, a.id);
      await tx
        .update(comprobantes)
        .set({ estadoTecnico: "PROCESANDO", advertenciasExtraccion: [...new Set([...(fila.advertenciasExtraccion as string[]), AVISO_LEYENDO])] })
        .where(eq(comprobantes.id, id));
    });
    return { encolados: leibles.length };
  });

  app.put<{ Params: { id: string } }>("/:id/imputacion", async (request) => {
    const entrada = validar(esquemaImputacion, request.body);
    const { fila, problemas } = await db.transaction((tx) => guardarImputacion(tx, Number(request.params.id), entrada, request.usuario!, request));
    return { comprobante: publico(fila), problemas };
  });

  app.post<{ Params: { id: string } }>("/:id/acciones", async (request) => {
    const { accion, motivo } = validar(esquemaAccion, request.body);
    const resultado = await db.transaction((tx) => ejecutarAccion(tx, Number(request.params.id), accion, motivo, request.usuario!, request));
    if (!resultado.ok) throw new ErrorHttp(409, `ACCION_${resultado.categoria}`, resultado.motivo ?? "No se pudo completar la acción");
    return resultado;
  });

  /** Verifica que todos los comprobantes sean del contribuyente indicado (sección 2.4). */
  async function exigirMismoContribuyente(ids: number[], contribuyenteId: number) {
    const filas = await db
      .select({ id: comprobantes.id, contribuyenteId: comprobantes.contribuyenteId })
      .from(comprobantes)
      .where(inArray(comprobantes.id, ids));
    const ajenos = filas.filter((f) => f.contribuyenteId !== contribuyenteId).map((f) => f.id);
    const inexistentes = ids.filter((id) => !filas.some((f) => f.id === id));
    if (ajenos.length || inexistentes.length) {
      throw new ErrorHttp(
        409,
        "MEZCLA_CONTRIBUYENTES",
        "La selección incluye comprobantes de otro contribuyente o sin asignar. Las acciones masivas se aplican a un solo contribuyente por vez.",
        { ids: [...ajenos, ...inexistentes].join(",") },
      );
    }
  }

  /** Confirmación, aprobación y demás acciones masivas: solo se aplican a los válidos (sección 16.3). */
  app.post("/masivo/acciones", async (request) => {
    const { ids, contribuyenteId, accion, motivo } = validar(esquemaAccionMasiva, request.body);
    await exigirMismoContribuyente(ids, contribuyenteId);
    const resultados: ResultadoAccion[] = [];
    for (const id of ids) {
      resultados.push(await db.transaction((tx) => ejecutarAccion(tx, id, accion, motivo, request.usuario!, request)));
    }
    return {
      aplicados: resultados.filter((r) => r.ok).map((r) => r.id),
      excluidos: resultados.filter((r) => !r.ok),
    };
  });

  /** Clasificación masiva: agregar, reemplazar o completar solo los vacíos (sección 16.3). */
  app.post("/masivo/clasificar", async (request) => {
    const { ids, contribuyenteId, modo, lineas, porcentajeNoImputado } = validar(esquemaClasificacionMasiva, request.body);
    await exigirMismoContribuyente(ids, contribuyenteId);
    const aplicados: number[] = [];
    const excluidos: { id: number; motivo: string }[] = [];
    for (const id of ids) {
      try {
        await db.transaction(async (tx) => {
          const actuales = await tx
            .select({ obligacion: imputaciones.obligacionCodigo, actividadId: imputaciones.actividadId, porcentaje: imputaciones.porcentaje })
            .from(imputaciones)
            .where(eq(imputaciones.comprobanteId, id));
          if (modo === "COMPLETAR_VACIOS" && actuales.length > 0) throw new ErrorHttp(409, "YA_CLASIFICADO", "Ya tenía imputación");
          const nuevas =
            modo === "AGREGAR"
              ? [
                  ...actuales
                    .filter((a) => !lineas.some((l) => l.obligacion === a.obligacion))
                    .map((a) => ({ obligacion: a.obligacion, actividadId: a.actividadId, porcentaje: Number(a.porcentaje) })),
                  ...lineas,
                ]
              : lineas;
          await guardarImputacion(tx, id, { lineas: nuevas, porcentajeNoImputado }, request.usuario!, request);
        });
        aplicados.push(id);
      } catch (error) {
        if (!(error instanceof ErrorHttp)) throw error;
        excluidos.push({ id, motivo: error.message });
      }
    }
    return { aplicados, excluidos };
  });
}
