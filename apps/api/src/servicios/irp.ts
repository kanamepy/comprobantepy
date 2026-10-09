/**
 * Seguimiento anual y proyección informativa del IRP-RSP (sección 20). No sustituye la
 * declaración jurada (Formulario N.° 515) ni el criterio del profesional responsable.
 */
import {
  aGuaranies,
  fraccionAdmitida,
  proyectarIrpRsp,
  TRAMOS_IRP_RSP_INICIALES,
  type Proyeccion,
  type Tramo,
  type TratamientoEgreso,
} from "@comprobantepy/shared";
import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, ne, sql } from "drizzle-orm";
import { ErrorHttp } from "../auth/sesiones.js";
import type { Ejecutor } from "../db/conexion.js";
import {
  comprobantes,
  contribuyenteObligaciones,
  imputaciones,
  ingresos,
  irpCierres,
  irpMovimientos,
  irpParametros,
  proveedores,
} from "../db/esquema.js";

export const AVISO_INFORMATIVO =
  "Proyección informativa: no sustituye la declaración jurada (Formulario N.° 515) ni el criterio del profesional responsable.";

export async function parametrosDe(db: Ejecutor, ejercicio: number) {
  const [fila] = await db.select().from(irpParametros).where(eq(irpParametros.ejercicio, ejercicio));
  return {
    ejercicio,
    tramos: (fila?.tramos as Tramo[] | undefined) ?? [...TRAMOS_IRP_RSP_INICIALES],
    compensacionesHabilitadas: fila?.compensacionesHabilitadas ?? false,
    fuente: fila?.fuente ?? "Instructivo del Formulario N.° 515, versión 1 (valores por defecto)",
    version: fila?.version ?? 0,
  };
}

const finDeMes = (ejercicio: number, mes: number) =>
  `${ejercicio}-${String(mes).padStart(2, "0")}-${String(new Date(Date.UTC(ejercicio, mes, 0)).getUTCDate()).padStart(2, "0")}`;

/** ¿La fecha cae en un mes (o ejercicio) cerrado? Las modificaciones posteriores exigen motivo (sección 20.7). */
export async function cierreVigente(db: Ejecutor, contribuyenteId: number, fecha: string) {
  const ejercicio = Number(fecha.slice(0, 4));
  const mes = Number(fecha.slice(5, 7));
  const [cierre] = await db
    .select()
    .from(irpCierres)
    .where(
      and(
        eq(irpCierres.contribuyenteId, contribuyenteId),
        eq(irpCierres.ejercicio, ejercicio),
        eq(irpCierres.estado, "CERRADO"),
        sql`(${irpCierres.mes} IS NULL OR ${irpCierres.mes} = ${mes})`,
      ),
    )
    .limit(1);
  return cierre ?? null;
}

export async function exigirMotivoSiCerrado(db: Ejecutor, contribuyenteId: number, fecha: string, motivo: string | undefined) {
  const cierre = await cierreVigente(db, contribuyenteId, fecha);
  if (cierre && !motivo?.trim()) {
    throw new ErrorHttp(409, "PERIODO_CERRADO", "El período está cerrado: la modificación requiere un motivo", { motivo: "Indicá el motivo de la modificación posterior al cierre" });
  }
  return cierre;
}

export interface EgresoIrp {
  id: number;
  fechaEmision: string;
  mes: number;
  proveedor: string | null;
  proveedorId: number | null;
  numero: string | null;
  tipoComprobante: number | null;
  naturaleza: string;
  estadoFlujo: string;
  totalGs: number;
  porcentajeIrp: number;
  imputado: number;
  tratamiento: TratamientoEgreso | null;
  porcentajeAdmitido: number | null;
  confirmado: boolean;
  sugerencia: { tratamiento: TratamientoEgreso; porcentajeAdmitido: number | null; motivo: string };
  categoria: "CONFIRMADO" | "NO_DEDUCIBLE" | "PENDIENTE" | "EXCLUIDO";
  admitido: number;
  admitidoProyectado: number;
}

/** Comprobantes del ejercicio imputados al IRP-RSP, con su tratamiento y el importe admitido. */
export async function egresosIrp(db: Ejecutor, contribuyenteId: number, ejercicio: number, hasta?: string): Promise<EgresoIrp[]> {
  const filas = await db
    .select({
      c: comprobantes,
      proveedor: proveedores.razonSocial,
      porcentaje: sql<string>`sum(${imputaciones.porcentaje})`,
    })
    .from(comprobantes)
    .innerJoin(imputaciones, and(eq(imputaciones.comprobanteId, comprobantes.id), eq(imputaciones.obligacionCodigo, "IRP_RSP")))
    .leftJoin(proveedores, eq(proveedores.id, comprobantes.proveedorId))
    .where(
      and(
        eq(comprobantes.contribuyenteId, contribuyenteId),
        gte(comprobantes.fechaEmision, `${ejercicio}-01-01`),
        lte(comprobantes.fechaEmision, hasta ?? `${ejercicio}-12-31`),
        ne(comprobantes.estadoFlujo, "ANULADO"),
        ne(comprobantes.estadoFlujo, "RECHAZADO"),
        isNull(comprobantes.reemplazadoPorId),
      ),
    )
    .groupBy(comprobantes.id, proveedores.razonSocial)
    .orderBy(comprobantes.fechaEmision, comprobantes.id);

  // Sugerencia por historial: el último tratamiento confirmado del mismo proveedor (sección 20.3).
  const proveedoresIds = [...new Set(filas.map((f) => f.c.proveedorId).filter((p): p is number => p !== null))];
  const historial = proveedoresIds.length
    ? await db
        .select({ proveedorId: comprobantes.proveedorId, tratamiento: comprobantes.irpTratamiento, porcentaje: comprobantes.irpPorcentajeAdmitido })
        .from(comprobantes)
        .where(
          and(
            eq(comprobantes.contribuyenteId, contribuyenteId),
            inArray(comprobantes.proveedorId, proveedoresIds),
            eq(comprobantes.irpTratamientoConfirmado, true),
            isNotNull(comprobantes.irpTratamiento),
          ),
        )
        .orderBy(desc(comprobantes.actualizadoEn))
    : [];

  return filas.map(({ c, proveedor, porcentaje }) => {
    const totalGs = aGuaranies(c.total, c.moneda, c.tipoCambio) ?? 0;
    const porcentajeIrp = Math.min(Number(porcentaje), 100);
    const imputado = Math.round((totalGs * porcentajeIrp) / 100);
    const previo = historial.find((h) => h.proveedorId === c.proveedorId);
    const sugerencia = previo
      ? { tratamiento: previo.tratamiento as TratamientoEgreso, porcentajeAdmitido: previo.porcentaje ? Number(previo.porcentaje) : null, motivo: "Mismo tratamiento que el último comprobante confirmado del proveedor" }
      : { tratamiento: "PENDIENTE_ANALISIS" as TratamientoEgreso, porcentajeAdmitido: null, motivo: "Sin historial del proveedor: analizar" };
    const tratamiento = c.irpTratamiento as TratamientoEgreso | null;
    const porcentajeAdmitido = c.irpPorcentajeAdmitido ? Number(c.irpPorcentajeAdmitido) : null;

    let categoria: EgresoIrp["categoria"];
    let admitido = 0;
    let admitidoProyectado = 0;
    if (c.estadoFlujo === "POSIBLE_DUPLICADO") {
      // Un posible duplicado no suma hasta resolverse (sección 19).
      categoria = "EXCLUIDO";
    } else if (c.estadoFlujo === "APROBADO" && c.irpTratamientoConfirmado && (tratamiento === "DEDUCIBLE" || tratamiento === "PARCIAL")) {
      categoria = "CONFIRMADO";
      admitido = Math.round(imputado * fraccionAdmitida(tratamiento, porcentajeAdmitido));
      admitidoProyectado = admitido;
    } else if (c.irpTratamientoConfirmado && tratamiento === "NO_DEDUCIBLE") {
      categoria = "NO_DEDUCIBLE";
    } else {
      categoria = "PENDIENTE";
      // En el escenario proyectado, un egreso sin analizar se supone deducible (se informa).
      const efectivo = tratamiento ?? sugerencia.tratamiento;
      const fraccion = efectivo === "DEDUCIBLE" || efectivo === "PARCIAL" ? fraccionAdmitida(efectivo, porcentajeAdmitido ?? sugerencia.porcentajeAdmitido) : efectivo === "NO_DEDUCIBLE" ? 0 : 1;
      admitidoProyectado = Math.round(imputado * fraccion);
    }
    return {
      id: c.id,
      fechaEmision: c.fechaEmision!,
      mes: Number(c.fechaEmision!.slice(5, 7)),
      proveedor,
      proveedorId: c.proveedorId,
      numero: c.numero,
      tipoComprobante: c.tipoComprobante,
      naturaleza: c.naturaleza,
      estadoFlujo: c.estadoFlujo,
      totalGs,
      porcentajeIrp,
      imputado,
      tratamiento,
      porcentajeAdmitido,
      confirmado: c.irpTratamientoConfirmado,
      sugerencia,
      categoria,
      admitido,
      admitidoProyectado,
    };
  });
}

interface Sumas {
  confirmado: number;
  pendiente: number;
}
const suma = (): Sumas => ({ confirmado: 0, pendiente: 0 });

export interface Tablero {
  ejercicio: number;
  hastaMes: number | null;
  aviso: string;
  parametros: Awaited<ReturnType<typeof parametrosDe>>;
  ingresos: { gravados: Sumas; exonerados: Sumas };
  egresos: { admitidosConfirmados: number; pendientes: number; noDeducibles: number; excluidos: number; cantidadPendientes: number; cantidad: number };
  creditos: { saldoAnterior: Sumas; retenciones: Sumas; percepciones: Sumas; ajustesYMultas: Sumas };
  escenarios: { confirmado: Proyeccion; proyectado: Proyeccion };
  porMes: { mes: number; ingresosGravados: number; egresosConfirmados: number; egresosPendientes: number; cerrado: boolean }[];
  completitud: { porcentaje: number; mesesTranscurridos: number; mesesConIngresos: number; egresosConfirmados: number; egresosTotales: number; saldoAnteriorRegistrado: boolean };
  advertencias: string[];
}

/** Tablero del ejercicio, opcionalmente acumulado hasta un mes (para los cierres). */
export async function calcularTablero(db: Ejecutor, contribuyenteId: number, ejercicio: number, hastaMes?: number): Promise<Tablero> {
  const hasta = hastaMes ? finDeMes(ejercicio, hastaMes) : `${ejercicio}-12-31`;
  const parametros = await parametrosDe(db, ejercicio);

  const listaIngresos = await db
    .select()
    .from(ingresos)
    .where(and(eq(ingresos.contribuyenteId, contribuyenteId), gte(ingresos.fecha, `${ejercicio}-01-01`), lte(ingresos.fecha, hasta), ne(ingresos.estado, "ANULADO")));
  const listaMovimientos = await db
    .select()
    .from(irpMovimientos)
    .where(and(eq(irpMovimientos.contribuyenteId, contribuyenteId), eq(irpMovimientos.ejercicio, ejercicio), lte(irpMovimientos.fecha, hasta), ne(irpMovimientos.estado, "ANULADO")));
  const egresos = await egresosIrp(db, contribuyenteId, ejercicio, hasta);

  const tablero: Tablero["ingresos"] = { gravados: suma(), exonerados: suma() };
  for (const i of listaIngresos) {
    const destino = i.tratamiento === "GRAVADO" ? tablero.gravados : tablero.exonerados;
    destino[i.estado === "CONFIRMADO" ? "confirmado" : "pendiente"] += Number(i.importe);
  }
  const creditos: Tablero["creditos"] = { saldoAnterior: suma(), retenciones: suma(), percepciones: suma(), ajustesYMultas: suma() };
  for (const m of listaMovimientos) {
    const clave = m.tipo === "SALDO_ANTERIOR" ? "saldoAnterior" : m.tipo === "RETENCION" ? "retenciones" : m.tipo === "PERCEPCION" ? "percepciones" : "ajustesYMultas";
    creditos[clave][m.estado === "CONFIRMADO" ? "confirmado" : "pendiente"] += Number(m.importe);
  }

  const admitidosConfirmados = egresos.reduce((s, e) => s + e.admitido, 0);
  const pendientes = egresos.filter((e) => e.categoria === "PENDIENTE").reduce((s, e) => s + e.admitidoProyectado, 0);
  const total = (s: Sumas) => s.confirmado + s.pendiente;

  const confirmado = proyectarIrpRsp({
    ingresosGravados: tablero.gravados.confirmado,
    egresosDeducibles: admitidosConfirmados,
    ajustesYMultas: creditos.ajustesYMultas.confirmado,
    saldoAFavorAnterior: creditos.saldoAnterior.confirmado,
    retenciones: creditos.retenciones.confirmado,
    percepciones: creditos.percepciones.confirmado,
    tramos: parametros.tramos,
  });
  const proyectado = proyectarIrpRsp({
    ingresosGravados: total(tablero.gravados),
    egresosDeducibles: admitidosConfirmados + pendientes,
    ajustesYMultas: total(creditos.ajustesYMultas),
    saldoAFavorAnterior: total(creditos.saldoAnterior),
    retenciones: total(creditos.retenciones),
    percepciones: total(creditos.percepciones),
    tramos: parametros.tramos,
  });

  const cierres = await db
    .select({ mes: irpCierres.mes })
    .from(irpCierres)
    .where(and(eq(irpCierres.contribuyenteId, contribuyenteId), eq(irpCierres.ejercicio, ejercicio), eq(irpCierres.estado, "CERRADO")));
  const anualCerrado = cierres.some((c) => c.mes === null);
  const ultimoMes = hastaMes ?? 12;
  const porMes = Array.from({ length: ultimoMes }, (_, i) => {
    const mes = i + 1;
    return {
      mes,
      ingresosGravados: listaIngresos.filter((x) => x.tratamiento === "GRAVADO" && Number(x.fecha.slice(5, 7)) === mes).reduce((s, x) => s + Number(x.importe), 0),
      egresosConfirmados: egresos.filter((e) => e.mes === mes).reduce((s, e) => s + e.admitido, 0),
      egresosPendientes: egresos.filter((e) => e.mes === mes && e.categoria === "PENDIENTE").reduce((s, e) => s + e.admitidoProyectado, 0),
      cerrado: anualCerrado || cierres.some((c) => c.mes === mes),
    };
  });

  // Completitud: meses con ingresos, egresos con tratamiento confirmado y saldo anterior registrado.
  const hoy = new Date();
  const mesesTranscurridos = Math.min(
    ultimoMes,
    ejercicio < hoy.getFullYear() ? 12 : ejercicio === hoy.getFullYear() ? hoy.getMonth() + 1 : 0,
  );
  const mesesConIngresos = porMes.filter((m) => m.mes <= mesesTranscurridos && m.ingresosGravados > 0).length;
  const egresosConfirmados = egresos.filter((e) => e.categoria === "CONFIRMADO" || e.categoria === "NO_DEDUCIBLE").length;
  const saldoAnteriorRegistrado = listaMovimientos.some((m) => m.tipo === "SALDO_ANTERIOR");
  const fraccionMeses = mesesTranscurridos ? mesesConIngresos / mesesTranscurridos : 1;
  const fraccionEgresos = egresos.length ? egresosConfirmados / egresos.length : 1;
  const porcentaje = Math.round(100 * (0.4 * fraccionMeses + 0.4 * fraccionEgresos + 0.2 * (saldoAnteriorRegistrado ? 1 : 0)));

  const advertencias: string[] = [];
  const [obligacion] = await db
    .select({ id: contribuyenteObligaciones.id })
    .from(contribuyenteObligaciones)
    .where(
      and(
        eq(contribuyenteObligaciones.contribuyenteId, contribuyenteId),
        eq(contribuyenteObligaciones.obligacionCodigo, "IRP_RSP"),
        eq(contribuyenteObligaciones.estado, "ACTIVO"),
        lte(contribuyenteObligaciones.vigenteDesde, `${ejercicio}-12-31`),
        sql`(${contribuyenteObligaciones.vigenteHasta} IS NULL OR ${contribuyenteObligaciones.vigenteHasta} >= ${`${ejercicio}-01-01`})`,
      ),
    );
  if (!obligacion) advertencias.push("El contribuyente no tiene la obligación IRP-RSP activa en este ejercicio");
  const sinIngresos = porMes.filter((m) => m.mes <= mesesTranscurridos && m.ingresosGravados === 0).map((m) => m.mes);
  if (sinIngresos.length) advertencias.push(`Meses sin ingresos registrados: ${sinIngresos.join(", ")}`);
  if (!saldoAnteriorRegistrado) advertencias.push("Falta registrar el saldo a favor del ejercicio anterior (aunque sea 0)");
  const sinAprobar = egresos.filter((e) => e.categoria === "PENDIENTE" && e.estadoFlujo !== "APROBADO").length;
  if (sinAprobar) advertencias.push(`${sinAprobar} comprobantes imputados al IRP-RSP todavía no están aprobados`);
  const sinTratamiento = egresos.filter((e) => e.estadoFlujo === "APROBADO" && !e.confirmado).length;
  if (sinTratamiento) advertencias.push(`${sinTratamiento} egresos aprobados sin tratamiento confirmado (deducible o no)`);
  const excluidos = egresos.filter((e) => e.categoria === "EXCLUIDO");
  if (excluidos.length) advertencias.push(`${excluidos.length} posibles duplicados no se suman hasta resolverlos`);
  const pendientesIngresos = tablero.gravados.pendiente + tablero.exonerados.pendiente;
  if (pendientesIngresos) advertencias.push("Hay ingresos pendientes de confirmar: solo se suman en el escenario proyectado");
  if (parametros.version === 0) advertencias.push(`No hay parámetros cargados para ${ejercicio}: se usan las tasas por defecto`);

  return {
    ejercicio,
    hastaMes: hastaMes ?? null,
    aviso: AVISO_INFORMATIVO,
    parametros,
    ingresos: tablero,
    egresos: {
      admitidosConfirmados,
      pendientes,
      noDeducibles: egresos.filter((e) => e.categoria === "NO_DEDUCIBLE").reduce((s, e) => s + e.imputado, 0),
      excluidos: excluidos.reduce((s, e) => s + e.imputado, 0),
      cantidadPendientes: egresos.filter((e) => e.categoria === "PENDIENTE").length,
      cantidad: egresos.length,
    },
    creditos,
    escenarios: { confirmado, proyectado },
    porMes,
    completitud: { porcentaje, mesesTranscurridos, mesesConIngresos, egresosConfirmados, egresosTotales: egresos.length, saldoAnteriorRegistrado },
    advertencias,
  };
}

/** Valores que se comparan contra la fotografía de un cierre. */
export function resumenParaCierre(t: Tablero) {
  return {
    ingresosGravados: t.ingresos.gravados.confirmado,
    ingresosExonerados: t.ingresos.exonerados.confirmado,
    egresosAdmitidos: t.egresos.admitidosConfirmados,
    saldoAnterior: t.creditos.saldoAnterior.confirmado,
    retenciones: t.creditos.retenciones.confirmado,
    percepciones: t.creditos.percepciones.confirmado,
    ajustesYMultas: t.creditos.ajustesYMultas.confirmado,
    rentaNetaImponible: t.escenarios.confirmado.rentaNetaImponible,
    impuestoDeterminado: t.escenarios.confirmado.impuestoDeterminado,
    saldoProyectado: t.escenarios.confirmado.saldoProyectado,
  };
}

/** Diferencias entre la fotografía cerrada y los valores actuales (sección 20.7). */
export async function diferenciasConCierres(db: Ejecutor, contribuyenteId: number, ejercicio: number) {
  const cierres = await db
    .select()
    .from(irpCierres)
    .where(and(eq(irpCierres.contribuyenteId, contribuyenteId), eq(irpCierres.ejercicio, ejercicio)))
    .orderBy(irpCierres.id);
  const resultado = [];
  for (const cierre of cierres) {
    let diferencias: { concepto: string; cerrado: number; actual: number }[] = [];
    if (cierre.estado === "CERRADO") {
      const actual = resumenParaCierre(await calcularTablero(db, contribuyenteId, ejercicio, cierre.mes ?? undefined));
      const congelado = (cierre.fotografia as { resumen: Record<string, number> }).resumen;
      diferencias = Object.entries(actual)
        .filter(([clave, valor]) => congelado[clave] !== valor)
        .map(([concepto, valor]) => ({ concepto, cerrado: congelado[concepto] ?? 0, actual: valor }));
    }
    resultado.push({ ...cierre, fotografia: undefined, resumen: (cierre.fotografia as { resumen: unknown }).resumen, diferencias });
  }
  return resultado;
}
