/**
 * Lotes de exportación a Marangatu (sección 18): preparación con conciliación previa,
 * generación de archivos (que nunca se regeneran), envío y resultado de la DNIT.
 */
import {
  calcularElegibilidad,
  camposRegistro,
  construirRegistroExportable,
  esBloqueante,
  type EstadoFlujo,
  type Problema,
  type RegistroExportable,
} from "@comprobantepy/shared";
import { conciliar, generarLote, type FormatoArchivo } from "@comprobantepy/shared/lote";
import { and, asc, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import type { Almacenamiento } from "../archivos/almacenamiento.js";
import { registrarAuditoria } from "../auditoria.js";
import { ErrorHttp, type UsuarioSesion } from "../auth/sesiones.js";
import { descifrar } from "../cifrado.js";
import type { Ejecutor, Transaccion } from "../db/conexion.js";
import { comprobantes, contribuyentes, loteArchivos, loteComprobantes, lotes, proveedores } from "../db/esquema.js";
import { evaluable, perfilesFlujo, reevaluar, type FilaComprobante } from "./comprobantes.js";

export const VERSION_MATRIZ = "Tabla 4 – Especificación técnica de importación, junio 2021";
export const VERSION_MAPEO = "Mapeo inicial de indicadores S/N v1";

export interface Periodo {
  anio: number;
  mes: number | null;
}

export function rangoPeriodo(obligacion: "955" | "956", periodo: Periodo) {
  if (obligacion === "955") {
    if (!periodo.mes) throw new ErrorHttp(400, "DATOS_INVALIDOS", "El registro mensual (955) requiere el mes");
    const mes = String(periodo.mes).padStart(2, "0");
    const ultimo = new Date(Date.UTC(periodo.anio, periodo.mes, 0)).getUTCDate();
    return { desde: `${periodo.anio}-${mes}-01`, hasta: `${periodo.anio}-${mes}-${ultimo}` };
  }
  return { desde: `${periodo.anio}-01-01`, hasta: `${periodo.anio}-12-31` };
}

export function exigirFinanciero(usuario: UsuarioSesion, contribuyenteId: number) {
  if (!perfilesFlujo(usuario, contribuyenteId).includes("FINANCIERO")) {
    throw new ErrorHttp(403, "SIN_PERMISO", "Solo el perfil Financiero del contribuyente genera y gestiona lotes");
  }
}

export function exigirAccesoContribuyente(usuario: UsuarioSesion, contribuyenteId: number) {
  if (!usuario.perfiles.some((p) => p.contribuyenteId === contribuyenteId)) {
    throw new ErrorHttp(404, "NO_ENCONTRADO", "Contribuyente inexistente");
  }
}

async function contribuyenteConObligacion(db: Ejecutor, contribuyenteId: number) {
  const [contribuyente] = await db.select().from(contribuyentes).where(eq(contribuyentes.id, contribuyenteId));
  if (!contribuyente) throw new ErrorHttp(404, "NO_ENCONTRADO", "Contribuyente inexistente");
  if (!contribuyente.obligacionRegistro) {
    throw new ErrorHttp(
      409,
      "SIN_OBLIGACION_REGISTRO",
      "Definí en Contribuyentes si el registro es mensual (955) o anual (956) antes de generar lotes",
    );
  }
  return contribuyente as typeof contribuyente & { obligacionRegistro: "955" | "956" };
}

/** Registro del archivo para un comprobante, con el número de cuenta descifrado. */
async function registroDe(db: Ejecutor, fila: FilaComprobante): Promise<RegistroExportable | null> {
  const datos = await evaluable(db, fila);
  if (fila.numeroCuentaCifrado) datos.numeroCuentaExportable = descifrar(fila.numeroCuentaCifrado);
  return construirRegistroExportable(datos);
}

export interface Candidato {
  id: number;
  numero: string | null;
  fechaEmision: string | null;
  tipoComprobante: number | null;
  proveedor: string | null;
  total: string | null;
  elegibilidad: { estado: string; motivo: string };
}

/** Comprobantes físicos del período: los elegibles y los que no, con su motivo (sección 18.6). */
export async function prepararLote(db: Ejecutor, contribuyenteId: number, periodo: Periodo) {
  const contribuyente = await contribuyenteConObligacion(db, contribuyenteId);
  const { desde, hasta } = rangoPeriodo(contribuyente.obligacionRegistro, periodo);
  const filas = await db
    .select({ comprobante: comprobantes, proveedor: proveedores.razonSocial })
    .from(comprobantes)
    .leftJoin(proveedores, eq(proveedores.id, comprobantes.proveedorId))
    .where(
      and(
        eq(comprobantes.contribuyenteId, contribuyenteId),
        eq(comprobantes.naturaleza, "FISICO"),
        ne(comprobantes.estadoFlujo, "ANULADO"),
        gte(comprobantes.fechaEmision, desde),
        lte(comprobantes.fechaEmision, hasta),
      ),
    )
    .orderBy(asc(comprobantes.fechaEmision), asc(comprobantes.numero));

  const elegibles: Candidato[] = [];
  const noElegibles: Candidato[] = [];
  const registros: RegistroExportable[] = [];
  for (const { comprobante: c, proveedor } of filas) {
    const elegibilidad = calcularElegibilidad({
      naturaleza: c.naturaleza,
      tipoComprobante: c.tipoComprobante,
      estadoFlujo: c.estadoFlujo as EstadoFlujo,
      tieneBloqueantes: (c.problemas as Problema[]).some(esBloqueante),
      estadoMarangatu: c.estadoMarangatu,
    });
    const candidato = {
      id: c.id,
      numero: c.numero,
      fechaEmision: c.fechaEmision,
      tipoComprobante: c.tipoComprobante,
      proveedor,
      total: c.total,
      elegibilidad,
    };
    if (elegibilidad.estado === "ELEGIBLE") {
      elegibles.push(candidato);
      const registro = await registroDe(db, c);
      if (registro) registros.push(registro);
    } else {
      noElegibles.push(candidato);
    }
  }
  return {
    contribuyente: { id: contribuyente.id, nombre: contribuyente.nombre, ruc: contribuyente.numeroIdentificacion, obligacion: contribuyente.obligacionRegistro },
    periodo: { ...periodo, desde, hasta },
    elegibles,
    noElegibles,
    conciliacion: conciliar(registros),
  };
}

export interface DatosGeneracion {
  contribuyenteId: number;
  periodo: Periodo;
  ids: number[];
  formato: FormatoArchivo;
  delimitadorCsv?: "," | ";";
}

export async function generarLoteDesdeSeleccion(
  tx: Transaccion,
  almacenamiento: Almacenamiento,
  datos: DatosGeneracion,
  usuario: UsuarioSesion,
  request?: FastifyRequest,
) {
  exigirFinanciero(usuario, datos.contribuyenteId);
  const contribuyente = await contribuyenteConObligacion(tx, datos.contribuyenteId);
  if (contribuyente.estado !== "ACTIVO") throw new ErrorHttp(409, "CONTRIBUYENTE_BAJA", "El contribuyente está dado de baja");
  if (contribuyente.tipoIdentificacion !== "RUC") {
    throw new ErrorHttp(409, "SIN_RUC", "El contribuyente no tiene RUC: no corresponde el registro de comprobantes");
  }
  const { desde, hasta } = rangoPeriodo(contribuyente.obligacionRegistro, datos.periodo);
  const mes = contribuyente.obligacionRegistro === "955" ? datos.periodo.mes : null;

  // Se bloquean las filas para que dos generaciones simultáneas no tomen el mismo comprobante.
  const filas = await tx
    .select()
    .from(comprobantes)
    .where(inArray(comprobantes.id, datos.ids))
    .orderBy(asc(comprobantes.fechaEmision), asc(comprobantes.numero))
    .for("update");

  const errores: { id: string; campo: string; mensaje: string }[] = [];
  const registros: RegistroExportable[] = [];
  for (const id of datos.ids) {
    if (!filas.some((f) => f.id === id)) errores.push({ id: String(id), campo: "comprobante", mensaje: "Comprobante inexistente" });
  }
  for (const fila of filas) {
    const error = (mensaje: string) => errores.push({ id: String(fila.id), campo: "comprobante", mensaje });
    if (fila.contribuyenteId !== datos.contribuyenteId) {
      error("Pertenece a otro contribuyente: un lote nunca mezcla contribuyentes");
      continue;
    }
    if (!fila.fechaEmision || fila.fechaEmision < desde || fila.fechaEmision > hasta) {
      error("La fecha de emisión está fuera del período del lote");
      continue;
    }
    const { fila: actual, problemas } = await reevaluar(tx, fila.id);
    const elegibilidad = calcularElegibilidad({
      naturaleza: actual.naturaleza,
      tipoComprobante: actual.tipoComprobante,
      estadoFlujo: actual.estadoFlujo as EstadoFlujo,
      tieneBloqueantes: problemas.some(esBloqueante),
      estadoMarangatu: actual.estadoMarangatu,
    });
    if (elegibilidad.estado !== "ELEGIBLE") {
      error(`No es elegible: ${elegibilidad.motivo}`);
      continue;
    }
    const registro = await registroDe(tx, actual);
    if (!registro) error("No tiene destino Compras ni Egresos");
    else registros.push(registro);
  }
  if (errores.length) throw new ErrorHttp(422, "LOTE_CON_ERRORES", "Hay comprobantes que no se pueden exportar", errores);

  const usados = await tx
    .select({ identificador: loteArchivos.identificador })
    .from(loteArchivos)
    .where(
      and(
        eq(loteArchivos.contribuyenteId, datos.contribuyenteId),
        eq(loteArchivos.anio, datos.periodo.anio),
        sql`coalesce(${loteArchivos.mes}, 0) = ${mes ?? 0}`,
      ),
    );

  const resultado = await generarLote(registros, {
    rucInformante: contribuyente.numeroIdentificacion,
    obligacion: contribuyente.obligacionRegistro,
    periodo: { anio: datos.periodo.anio, mes: mes ?? undefined },
    identificadoresUsados: new Set(usados.map((u) => u.identificador)),
    formato: datos.formato,
    delimitadorCsv: datos.delimitadorCsv,
  });
  if (!resultado.ok) {
    throw new ErrorHttp(422, "LOTE_CON_ERRORES", "Hay comprobantes que no cumplen el formato de Marangatu", resultado.errores);
  }

  // Elegibles del período que quedaron afuera, para la trazabilidad del lote.
  const preparacion = await prepararLote(tx, datos.contribuyenteId, datos.periodo);
  const excluidos = [
    ...preparacion.elegibles
      .filter((e) => !datos.ids.includes(e.id))
      .map((e) => ({ id: e.id, numero: e.numero, motivo: "No seleccionado" })),
    ...preparacion.noElegibles
      .filter((e) => !datos.ids.includes(e.id))
      .map((e) => ({ id: e.id, numero: e.numero, motivo: e.elegibilidad.motivo })),
  ];

  const [lote] = await tx
    .insert(lotes)
    .values({
      contribuyenteId: datos.contribuyenteId,
      obligacion: contribuyente.obligacionRegistro,
      anio: datos.periodo.anio,
      mes,
      formato: datos.formato,
      versionMatriz: VERSION_MATRIZ,
      versionMapeo: VERSION_MAPEO,
      conciliacion: resultado.conciliacion,
      excluidos,
      generadoPor: usuario.id,
    })
    .returning();

  for (const archivo of resultado.archivos) {
    const contenido = Buffer.from(archivo.zip);
    const ruta = await almacenamiento.guardar(contenido, archivo.sha256Zip);
    const [filaArchivo] = await tx
      .insert(loteArchivos)
      .values({
        loteId: lote!.id,
        contribuyenteId: datos.contribuyenteId,
        anio: datos.periodo.anio,
        mes,
        identificador: archivo.identificador,
        nombreBase: archivo.nombreBase,
        nombreArchivo: archivo.nombreArchivo,
        nombreZip: archivo.nombreZip,
        sha256Zip: archivo.sha256Zip,
        tamano: contenido.length,
        filas: archivo.idsRegistros.length,
        ruta,
      })
      .returning();
    await tx.insert(loteComprobantes).values(
      archivo.idsRegistros.map((id, i) => ({
        loteId: lote!.id,
        loteArchivoId: filaArchivo!.id,
        comprobanteId: Number(id),
        fila: i + 1,
        campos: camposRegistro(registros.find((r) => r.id === id)!),
      })),
    );
  }
  await tx
    .update(comprobantes)
    .set({ estadoMarangatu: "INCLUIDO_EN_LOTE", actualizadoEn: new Date() })
    .where(inArray(comprobantes.id, datos.ids));
  await registrarAuditoria(
    tx,
    {
      entidad: "lote",
      entidadId: lote!.id,
      contribuyenteId: datos.contribuyenteId,
      accion: "GENERAR",
      perfil: "FINANCIERO",
      valorNuevo: {
        archivos: resultado.archivos.map((a) => ({ nombre: a.nombreZip, sha256: a.sha256Zip, filas: a.idsRegistros.length })),
        comprobantes: datos.ids,
      },
    },
    request,
  );
  for (const id of datos.ids) {
    await registrarAuditoria(
      tx,
      { entidad: "comprobante", entidadId: id, contribuyenteId: datos.contribuyenteId, accion: "INCLUIDO_EN_LOTE", valorNuevo: { loteId: lote!.id } },
      request,
    );
  }
  return lote!;
}

async function loteParaModificar(tx: Transaccion, id: number, usuario: UsuarioSesion) {
  const [lote] = await tx.select().from(lotes).where(eq(lotes.id, id)).for("update");
  if (!lote) throw new ErrorHttp(404, "NO_ENCONTRADO", "Lote inexistente");
  exigirAccesoContribuyente(usuario, lote.contribuyenteId);
  exigirFinanciero(usuario, lote.contribuyenteId);
  return lote;
}

async function idsDelLote(tx: Transaccion, loteId: number, estados?: string[]) {
  const filas = await tx
    .select({ comprobanteId: loteComprobantes.comprobanteId, estado: loteComprobantes.estado })
    .from(loteComprobantes)
    .where(eq(loteComprobantes.loteId, loteId));
  return filas.filter((f) => !estados || estados.includes(f.estado)).map((f) => f.comprobanteId);
}

/** Anular un lote todavía no importado: los comprobantes vuelven a ser elegibles. */
export async function anularLote(tx: Transaccion, id: number, motivo: string, usuario: UsuarioSesion, request?: FastifyRequest) {
  const lote = await loteParaModificar(tx, id, usuario);
  if (lote.estado !== "GENERADO") {
    throw new ErrorHttp(409, "LOTE_ENVIADO", "Un lote ya importado en Marangatu no se anula: registrá el resultado de la DNIT");
  }
  const ids = await idsDelLote(tx, id);
  await tx.update(lotes).set({ estado: "ANULADO", anuladoMotivo: motivo }).where(eq(lotes.id, id));
  await tx.update(loteComprobantes).set({ estado: "RETIRADO", activo: false }).where(eq(loteComprobantes.loteId, id));
  if (ids.length) {
    // Si antes había sido rechazado por la DNIT se conserva esa marca; si no, se limpia.
    await tx
      .update(comprobantes)
      .set({
        estadoMarangatu: sql`CASE WHEN EXISTS (SELECT 1 FROM lote_comprobantes lc WHERE lc.comprobante_id = ${comprobantes.id} AND lc.estado = 'RECHAZADO_DNIT') THEN 'RECHAZADO_DNIT' ELSE NULL END`,
        actualizadoEn: new Date(),
      })
      .where(inArray(comprobantes.id, ids));
  }
  await registrarAuditoria(tx, { entidad: "lote", entidadId: id, contribuyenteId: lote.contribuyenteId, accion: "ANULAR", motivo }, request);
  return { ...lote, estado: "ANULADO" as const };
}

/** El Financiero informa que importó el archivo en Marangatu. */
export async function marcarEnviado(tx: Transaccion, id: number, fecha: string, usuario: UsuarioSesion, request?: FastifyRequest) {
  const lote = await loteParaModificar(tx, id, usuario);
  if (lote.estado !== "GENERADO") throw new ErrorHttp(409, "ESTADO_INVALIDO", "El lote ya fue marcado como enviado o está cerrado");
  const ids = await idsDelLote(tx, id);
  await tx.update(lotes).set({ estado: "ENVIADO", enviadoEn: fecha, enviadoPor: usuario.id }).where(eq(lotes.id, id));
  await tx.update(loteComprobantes).set({ estado: "ENVIADO" }).where(eq(loteComprobantes.loteId, id));
  if (ids.length) await tx.update(comprobantes).set({ estadoMarangatu: "ENVIADO", actualizadoEn: new Date() }).where(inArray(comprobantes.id, ids));
  await registrarAuditoria(tx, { entidad: "lote", entidadId: id, contribuyenteId: lote.contribuyenteId, accion: "ENVIADO", valorNuevo: { fecha } }, request);
}

/**
 * Resultado informado por la DNIT (sección 18.7): los rechazados pasan a observados para
 * corregirlos y reenviarlos en un lote nuevo; al cerrar, el resto queda aceptado.
 */
export async function registrarResultado(
  tx: Transaccion,
  id: number,
  datos: { rechazados: { comprobanteId: number; error: string }[]; cerrar: boolean },
  usuario: UsuarioSesion,
  request?: FastifyRequest,
) {
  const lote = await loteParaModificar(tx, id, usuario);
  if (lote.estado !== "ENVIADO") throw new ErrorHttp(409, "ESTADO_INVALIDO", "Primero marcá el lote como enviado");
  const enviados = await idsDelLote(tx, id, ["ENVIADO"]);
  for (const rechazo of datos.rechazados) {
    if (!enviados.includes(rechazo.comprobanteId)) {
      throw new ErrorHttp(400, "DATOS_INVALIDOS", `El comprobante ${rechazo.comprobanteId} no está pendiente de resultado en este lote`);
    }
  }
  for (const rechazo of datos.rechazados) {
    await tx
      .update(loteComprobantes)
      .set({ estado: "RECHAZADO_DNIT", activo: false, errorDnit: rechazo.error })
      .where(and(eq(loteComprobantes.loteId, id), eq(loteComprobantes.comprobanteId, rechazo.comprobanteId)));
    const motivo = `Rechazado por la DNIT: ${rechazo.error}`;
    await tx
      .update(comprobantes)
      .set({ estadoMarangatu: "RECHAZADO_DNIT", estadoFlujo: "OBSERVADO", motivoEstado: motivo, actualizadoEn: new Date() })
      .where(eq(comprobantes.id, rechazo.comprobanteId));
    await registrarAuditoria(
      tx,
      { entidad: "comprobante", entidadId: rechazo.comprobanteId, contribuyenteId: lote.contribuyenteId, accion: "RECHAZADO_DNIT", motivo, valorNuevo: { loteId: id, estadoFlujo: "OBSERVADO" } },
      request,
    );
  }
  if (datos.cerrar) {
    const aceptados = enviados.filter((c) => !datos.rechazados.some((r) => r.comprobanteId === c));
    await tx
      .update(loteComprobantes)
      .set({ estado: "ACEPTADO_DNIT" })
      .where(and(eq(loteComprobantes.loteId, id), eq(loteComprobantes.estado, "ENVIADO")));
    if (aceptados.length) {
      await tx.update(comprobantes).set({ estadoMarangatu: "ACEPTADO_DNIT", actualizadoEn: new Date() }).where(inArray(comprobantes.id, aceptados));
    }
    await tx.update(lotes).set({ estado: "CERRADO", cerradoEn: new Date() }).where(eq(lotes.id, id));
  }
  await registrarAuditoria(
    tx,
    { entidad: "lote", entidadId: id, contribuyenteId: lote.contribuyenteId, accion: datos.cerrar ? "RESULTADO_Y_CIERRE" : "RESULTADO_PARCIAL", valorNuevo: datos },
    request,
  );
}
