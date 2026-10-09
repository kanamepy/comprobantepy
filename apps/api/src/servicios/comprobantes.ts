/**
 * Lógica central de comprobantes: alta desde archivos o carga manual, asociación
 * de representaciones, asignación al contribuyente receptor, proveedores,
 * timbrados, duplicados, edición, imputación y cambios de estado.
 */
import {
  ACCIONES,
  CAMPOS_COMPROBANTE,
  calcularDV,
  combinarExtracciones,
  determinarNaturaleza,
  esBloqueante,
  estadoAutomatico,
  ESTADOS_AUTOMATICOS,
  ESTADOS_EDITABLES,
  evaluarComprobante,
  normalizarCdc,
  normalizarNumeroComprobante,
  resultadoVacio,
  separarRuc,
  type AccionFlujo,
  type CampoComprobante,
  type CampoExtraido,
  type CamposExtraidos,
  type ComprobanteEvaluable,
  type EdicionComprobante,
  type EstadoFlujo,
  type EstadoTimbrado,
  type ImputacionEntrada,
  type NaturalezaFiscal,
  type PerfilFlujo,
  type Problema,
  type ResultadoExtraccion,
} from "@comprobantepy/shared";
import { and, desc, eq, inArray, isNotNull, ne, or, sql } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import { registrarAuditoria } from "../auditoria.js";
import { ErrorHttp, type UsuarioSesion } from "../auth/sesiones.js";
import { cifrar } from "../cifrado.js";
import type { Ejecutor, Transaccion } from "../db/conexion.js";
import {
  actividades,
  comprobanteArchivos,
  comprobantes,
  contribuyenteObligaciones,
  contribuyentes,
  imputaciones,
  obligaciones,
  proveedores,
  timbrados,
} from "../db/esquema.js";

export type FilaComprobante = typeof comprobantes.$inferSelect;
type FilaProveedor = typeof proveedores.$inferSelect;
type FilaTimbrado = typeof timbrados.$inferSelect;
type Canal = FilaComprobante["canal"];

// ---------------------------------------------------------------------------
// Permisos
// ---------------------------------------------------------------------------

/** Perfiles de flujo del usuario para un contribuyente (o para los pendientes de asignación). */
export function perfilesFlujo(usuario: UsuarioSesion, contribuyenteId: number | null): PerfilFlujo[] {
  const perfiles = usuario.perfiles
    .filter((p) => contribuyenteId === null || p.contribuyenteId === contribuyenteId)
    .map((p) => p.perfil)
    .filter((p): p is PerfilFlujo => p === "AUXILIAR" || p === "FINANCIERO");
  return [...new Set(perfiles)];
}

export function idsVisibles(usuario: UsuarioSesion): number[] {
  return [...new Set(usuario.perfiles.map((p) => p.contribuyenteId))];
}

/** Los pendientes de asignación los ven quienes cargan o aprueban para algún contribuyente. */
export function puedeVerPendientes(usuario: UsuarioSesion): boolean {
  return perfilesFlujo(usuario, null).length > 0;
}

export function exigirVisible(usuario: UsuarioSesion, fila: Pick<FilaComprobante, "contribuyenteId">) {
  const visible =
    fila.contribuyenteId === null ? puedeVerPendientes(usuario) : idsVisibles(usuario).includes(fila.contribuyenteId);
  if (!visible) throw new ErrorHttp(404, "NO_ENCONTRADO", "Comprobante inexistente");
}

export function exigirPerfil(usuario: UsuarioSesion, contribuyenteId: number | null, requeridos: PerfilFlujo[]) {
  const perfiles = perfilesFlujo(usuario, contribuyenteId);
  if (!requeridos.some((p) => perfiles.includes(p))) {
    throw new ErrorHttp(403, "SIN_PERMISO", "Tu perfil no permite esta acción para este contribuyente");
  }
}

// ---------------------------------------------------------------------------
// Datos auxiliares
// ---------------------------------------------------------------------------

const hoyIso = () => new Date().toISOString().slice(0, 10);

export async function obligacionesActivas(db: Ejecutor, contribuyenteId: number | null, fecha: string | null) {
  if (contribuyenteId === null) return new Set<string>();
  const dia = fecha ?? hoyIso();
  const filas = await db
    .select({ codigo: contribuyenteObligaciones.obligacionCodigo })
    .from(contribuyenteObligaciones)
    .where(
      and(
        eq(contribuyenteObligaciones.contribuyenteId, contribuyenteId),
        eq(contribuyenteObligaciones.estado, "ACTIVO"),
        sql`${contribuyenteObligaciones.vigenteDesde} <= ${dia}`,
        sql`(${contribuyenteObligaciones.vigenteHasta} IS NULL OR ${contribuyenteObligaciones.vigenteHasta} >= ${dia})`,
      ),
    );
  return new Set(filas.map((f) => f.codigo));
}

/** Estado del timbrado a la fecha de emisión, a partir de la verificación registrada (sección 11.4). */
export function estadoTimbrado(timbrado: FilaTimbrado | null, fecha: string | null): EstadoTimbrado | null {
  if (!timbrado) return null;
  if (timbrado.estadoVerificacion !== "VALIDO") return timbrado.estadoVerificacion;
  if (fecha && timbrado.vigenciaDesde && fecha < timbrado.vigenciaDesde) return "RECHAZADO";
  if (fecha && timbrado.vigenciaHasta && fecha > timbrado.vigenciaHasta) return "RECHAZADO";
  return "VALIDO";
}

async function imputacionDe(db: Ejecutor, comprobanteId: number) {
  return db
    .select({
      obligacion: imputaciones.obligacionCodigo,
      actividadId: imputaciones.actividadId,
      porcentaje: imputaciones.porcentaje,
    })
    .from(imputaciones)
    .where(eq(imputaciones.comprobanteId, comprobanteId))
    .orderBy(imputaciones.id);
}

/** Otros comprobantes del mismo proveedor, fecha e importe con distinto número (sección 12). */
export async function buscarPosiblesDuplicados(db: Ejecutor, fila: FilaComprobante) {
  if (!fila.proveedorId || !fila.fechaEmision || !fila.total) return [];
  const descartados = (fila.duplicadosDescartados as number[]) ?? [];
  const candidatos = await db
    .select({ id: comprobantes.id, numero: comprobantes.numero, estadoFlujo: comprobantes.estadoFlujo, contribuyenteId: comprobantes.contribuyenteId })
    .from(comprobantes)
    .where(
      and(
        ne(comprobantes.id, fila.id),
        eq(comprobantes.proveedorId, fila.proveedorId),
        eq(comprobantes.fechaEmision, fila.fechaEmision),
        eq(comprobantes.total, fila.total),
        // Un duplicado ya anulado deja de marcar al que quedó vigente.
        ne(comprobantes.estadoFlujo, "ANULADO"),
      ),
    );
  return candidatos.filter((c) => !descartados.includes(c.id));
}

/** Duplicado exacto: mismo CDC o misma clave de negocio (sección 12). */
async function buscarDuplicadoExacto(
  db: Ejecutor,
  datos: { cdc: string | null; proveedorId: number | null; tipoComprobante: number | null; timbrado: number | null; numero: string | null },
  excluirId?: number,
) {
  const condiciones = [];
  if (datos.cdc) condiciones.push(eq(comprobantes.cdc, datos.cdc));
  if (datos.proveedorId && datos.tipoComprobante && datos.timbrado !== null && datos.numero) {
    condiciones.push(
      and(
        eq(comprobantes.proveedorId, datos.proveedorId),
        eq(comprobantes.tipoComprobante, datos.tipoComprobante),
        eq(comprobantes.timbrado, datos.timbrado),
        eq(comprobantes.numero, datos.numero),
      ),
    );
  }
  if (condiciones.length === 0) return null;
  const [fila] = await db
    .select({ id: comprobantes.id, contribuyenteId: comprobantes.contribuyenteId, nombre: contribuyentes.nombre, estadoFlujo: comprobantes.estadoFlujo })
    .from(comprobantes)
    .leftJoin(contribuyentes, eq(contribuyentes.id, comprobantes.contribuyenteId))
    .where(and(or(...condiciones), excluirId ? ne(comprobantes.id, excluirId) : undefined))
    .limit(1);
  return fila ?? null;
}

function errorDuplicado(existente: { id: number; nombre: string | null; estadoFlujo: string }) {
  return new ErrorHttp(
    409,
    "DUPLICADO_EXACTO",
    `Este comprobante ya está registrado (n.° ${existente.id}${existente.nombre ? `, de ${existente.nombre}` : ", sin contribuyente asignado"}, estado ${existente.estadoFlujo.toLowerCase().replaceAll("_", " ")})`,
    { comprobanteId: existente.id },
  );
}

/** Busca el proveedor por identificación o lo crea pendiente de confirmación (sección 11.1). */
export async function resolverProveedor(
  db: Ejecutor,
  datos: { tipoIdentificacion: number; numero: string; dv: number | null; razonSocial: string | null; fuente: string; emisorElectronico?: boolean },
): Promise<FilaProveedor> {
  const [existente] = await db
    .select()
    .from(proveedores)
    .where(and(eq(proveedores.tipoIdentificacion, datos.tipoIdentificacion), eq(proveedores.numeroIdentificacion, datos.numero)));
  if (existente) {
    // No se sobrescribe el maestro; solo se marca que emite documentos electrónicos.
    if (datos.emisorElectronico && !existente.emisorElectronico) {
      const [actualizado] = await db
        .update(proveedores)
        .set({ emisorElectronico: true, actualizadoEn: new Date() })
        .where(eq(proveedores.id, existente.id))
        .returning();
      return actualizado!;
    }
    return existente;
  }
  const [creado] = await db
    .insert(proveedores)
    .values({
      tipoIdentificacion: datos.tipoIdentificacion,
      numeroIdentificacion: datos.numero,
      dv: datos.dv,
      razonSocial: datos.razonSocial?.trim() || "(sin nombre detectado)",
      fuente: datos.fuente,
      emisorElectronico: datos.emisorElectronico ?? false,
    })
    .onConflictDoNothing()
    .returning();
  if (creado) return creado;
  // Otro proceso lo creó al mismo tiempo.
  const [otro] = await db
    .select()
    .from(proveedores)
    .where(and(eq(proveedores.tipoIdentificacion, datos.tipoIdentificacion), eq(proveedores.numeroIdentificacion, datos.numero)));
  return otro!;
}

async function resolverTimbrado(db: Ejecutor, proveedorId: number | null, numero: number | null) {
  if (!proveedorId || !numero) return null;
  await db.insert(timbrados).values({ proveedorId, numero }).onConflictDoNothing();
  const [fila] = await db
    .select()
    .from(timbrados)
    .where(and(eq(timbrados.proveedorId, proveedorId), eq(timbrados.numero, numero)));
  return fila ?? null;
}

/** Contribuyente informante según el receptor del documento (sección 2.3). */
async function contribuyentePorReceptor(db: Ejecutor, numero: string | null) {
  if (!numero) return { estado: "SIN_RECEPTOR" as const };
  const [fila] = await db
    .select({ id: contribuyentes.id, estado: contribuyentes.estado, nombre: contribuyentes.nombre })
    .from(contribuyentes)
    .where(eq(contribuyentes.numeroIdentificacion, numero.replace(/^0+/, "")));
  if (!fila) return { estado: "NO_ADMINISTRADO" as const };
  if (fila.estado === "BAJA") return { estado: "DADO_DE_BAJA" as const, nombre: fila.nombre };
  return { estado: "ADMINISTRADO" as const, id: fila.id };
}

// ---------------------------------------------------------------------------
// Evaluación
// ---------------------------------------------------------------------------

export async function evaluable(db: Ejecutor, fila: FilaComprobante): Promise<ComprobanteEvaluable> {
  const [proveedor] = fila.proveedorId ? await db.select().from(proveedores).where(eq(proveedores.id, fila.proveedorId)) : [];
  const [timbrado] = fila.timbradoId ? await db.select().from(timbrados).where(eq(timbrados.id, fila.timbradoId)) : [];
  const lineas = await imputacionDe(db, fila.id);
  const posibles = await buscarPosiblesDuplicados(db, fila);
  return {
    id: String(fila.id),
    contribuyenteId: fila.contribuyenteId,
    naturaleza: fila.naturaleza,
    tipoComprobante: fila.tipoComprobante,
    proveedor: proveedor
      ? {
          estado: proveedor.estado,
          tipoIdentificacion: proveedor.tipoIdentificacion,
          numeroIdentificacion: proveedor.numeroIdentificacion,
          dv: proveedor.dv,
          razonSocial: proveedor.razonSocial,
        }
      : null,
    timbrado: fila.timbrado,
    estadoTimbrado: estadoTimbrado(timbrado ?? null, fila.fechaEmision),
    numero: fila.numero,
    fechaEmision: fila.fechaEmision,
    moneda: fila.moneda,
    tipoCambio: fila.tipoCambio,
    condicion: fila.condicion === 1 || fila.condicion === 2 ? fila.condicion : null,
    gravado10: fila.gravado10,
    gravado5: fila.gravado5,
    exento: fila.exento,
    total: fila.total,
    asociadoNumero: fila.asociadoNumero,
    asociadoTimbrado: fila.asociadoTimbrado,
    asociadoCdc: fila.asociadoCdc,
    tieneNumeroCuenta: Boolean(fila.numeroCuentaCifrado),
    numeroCuentaExportable: fila.numeroCuentaCifrado ? (fila.numeroCuentaMascara ?? "****") : null,
    entidadFinanciera: fila.entidadFinanciera,
    numeroPatronalIps: fila.numeroPatronalIps,
    especificarTipoDocumento: fila.especificarTipoDocumento,
    imputacion: {
      lineas: lineas.map((l) => ({ obligacion: l.obligacion, actividad: l.actividadId ? String(l.actividadId) : undefined, porcentaje: Number(l.porcentaje) })),
      porcentajeNoImputado: Number(fila.porcentajeNoImputado),
    },
    obligacionesActivas: await obligacionesActivas(db, fila.contribuyenteId, fila.fechaEmision),
    posibleDuplicadoPendiente: posibles.length > 0 && fila.estadoFlujo !== "ANULADO",
  };
}

/** Recalcula los problemas y, en los estados automáticos, el estado de flujo. */
export async function reevaluar(db: Ejecutor, id: number): Promise<{ fila: FilaComprobante; problemas: Problema[] }> {
  const [fila] = await db.select().from(comprobantes).where(eq(comprobantes.id, id));
  if (!fila) throw new ErrorHttp(404, "NO_ENCONTRADO", "Comprobante inexistente");
  const problemas = fila.estadoFlujo === "ANULADO" ? [] : evaluarComprobante(await evaluable(db, fila));
  const estado = ESTADOS_AUTOMATICOS.includes(fila.estadoFlujo as EstadoFlujo) ? estadoAutomatico(problemas) : fila.estadoFlujo;
  const [actualizada] = await db
    .update(comprobantes)
    .set({ problemas, estadoFlujo: estado })
    .where(eq(comprobantes.id, id))
    .returning();
  return { fila: actualizada!, problemas };
}

// ---------------------------------------------------------------------------
// Alta desde una extracción (archivo o carga manual)
// ---------------------------------------------------------------------------

const v = (campos: CamposExtraidos, campo: CampoComprobante) => campos[campo]?.valor ?? null;
const entero = (valor: string | null) => (valor !== null && /^\d+$/.test(valor) ? Number(valor) : null);

interface DatosAlta {
  extraccion: ResultadoExtraccion;
  canal: Canal;
  estadoTecnico: string;
  archivoId: number | null;
  /** Contribuyente activo en pantalla: solo se usa si el documento no identifica al receptor. */
  contribuyenteSugerido: number | null;
  naturalezaIndicada: NaturalezaFiscal | null;
  usuario: UsuarioSesion;
  request?: FastifyRequest;
}

export type ResultadoAlta =
  | { resultado: "CREADO"; comprobanteId: number; avisos: string[] }
  | { resultado: "ASOCIADO"; comprobanteId: number; avisos: string[] }
  | { resultado: "YA_REGISTRADO"; comprobanteId: number; avisos: string[] };

/** Valores de columnas a partir de los campos extraídos. */
function columnasDesdeCampos(campos: CamposExtraidos) {
  const numero = v(campos, "numero");
  const cdc = v(campos, "cdc");
  const condicion = entero(v(campos, "condicion"));
  return {
    cdc: cdc ? normalizarCdc(cdc) : null,
    tipoComprobante: entero(v(campos, "tipoComprobante")),
    timbrado: entero(v(campos, "timbrado")),
    numero: numero ? (normalizarNumeroComprobante(numero) ?? numero) : null,
    fechaEmision: v(campos, "fechaEmision"),
    moneda: v(campos, "moneda") ?? "PYG",
    tipoCambio: v(campos, "tipoCambio"),
    condicion: condicion === 1 || condicion === 2 ? condicion : null,
    receptorTipoIdentificacion: v(campos, "receptorTipoIdentificacion") as "RUC" | "CI" | "OTRO" | null,
    receptorNumero: v(campos, "receptorNumero"),
    receptorDv: entero(v(campos, "receptorDv")),
    receptorNombre: v(campos, "receptorNombre"),
    gravado10: v(campos, "gravado10"),
    gravado5: v(campos, "gravado5"),
    exento: v(campos, "exento"),
    iva10: v(campos, "iva10"),
    iva5: v(campos, "iva5"),
    total: v(campos, "total"),
    asociadoNumero: v(campos, "asociadoNumero"),
    asociadoTimbrado: entero(v(campos, "asociadoTimbrado")),
    asociadoCdc: v(campos, "asociadoCdc"),
  };
}

export async function altaDesdeExtraccion(tx: Transaccion, datos: DatosAlta): Promise<ResultadoAlta> {
  const { extraccion, usuario } = datos;
  const campos = extraccion.campos;
  const avisos = [...extraccion.advertencias];

  const emisorRuc = v(campos, "emisorRuc");
  const proveedor = emisorRuc
    ? await resolverProveedor(tx, {
        tipoIdentificacion: 11,
        numero: emisorRuc,
        dv: entero(v(campos, "emisorDv")),
        razonSocial: v(campos, "emisorNombre"),
        fuente: campos.emisorRuc!.fuente,
        emisorElectronico: extraccion.indicios.xmlSifen,
      })
    : null;
  const columnas = columnasDesdeCampos(campos);

  // Asociación con un registro existente (sección 7.4): CDC o clave de negocio.
  const existente = await buscarDuplicadoExacto(tx, { ...columnas, proveedorId: proveedor?.id ?? null });
  if (existente) {
    const visible =
      existente.contribuyenteId === null ? puedeVerPendientes(usuario) : idsVisibles(usuario).includes(existente.contribuyenteId);
    if (!visible) {
      throw new ErrorHttp(409, "DUPLICADO_EXACTO", "Este comprobante ya está registrado para otro contribuyente");
    }
    if (!datos.archivoId) throw errorDuplicado(existente);
    {
      await tx.insert(comprobanteArchivos).values({ comprobanteId: existente.id, archivoId: datos.archivoId }).onConflictDoNothing();
      await completarConFuenteSuperior(tx, existente.id, campos);
      await registrarAuditoria(
        tx,
        { entidad: "comprobante", entidadId: existente.id, contribuyenteId: existente.contribuyenteId, accion: "EVIDENCIA_ASOCIADA", valorNuevo: { archivoId: datos.archivoId } },
        datos.request,
      );
      await reevaluar(tx, existente.id);
    }
    return { resultado: "ASOCIADO", comprobanteId: existente.id, avisos: [...avisos, "Se agregó como evidencia de un comprobante ya registrado"] };
  }

  // Contribuyente informante: el receptor manda (sección 2.3).
  const receptor = await contribuyentePorReceptor(tx, columnas.receptorNumero);
  let contribuyenteId: number | null = null;
  let asignacionManual = false;
  if (receptor.estado === "ADMINISTRADO") {
    contribuyenteId = receptor.id;
    if (datos.contribuyenteSugerido && datos.contribuyenteSugerido !== receptor.id) {
      avisos.push("El comprobante se asignó al contribuyente que figura como receptor, distinto del activo en pantalla");
    }
  } else if (receptor.estado === "NO_ADMINISTRADO") {
    avisos.push("Receptor no administrado: el comprobante queda pendiente de asignación");
  } else if (receptor.estado === "DADO_DE_BAJA") {
    avisos.push(`El receptor (${receptor.nombre}) está dado de baja: no se admiten nuevas cargas`);
  } else if (datos.contribuyenteSugerido && idsVisibles(usuario).includes(datos.contribuyenteSugerido)) {
    contribuyenteId = datos.contribuyenteSugerido;
    asignacionManual = true;
  }
  if (contribuyenteId !== null) exigirPerfil(usuario, contribuyenteId, ["AUXILIAR", "FINANCIERO"]);

  const sugerida = determinarNaturaleza(extraccion, { emiteVirtual: proveedor?.emisorVirtual });
  const naturaleza =
    sugerida.naturaleza === "NO_DETERMINADA" && datos.naturalezaIndicada ? datos.naturalezaIndicada : sugerida.naturaleza;
  const naturalezaMotivo = naturaleza === sugerida.naturaleza ? sugerida.motivo : "Indicada por el usuario al cargar";

  const timbrado = await resolverTimbrado(tx, proveedor?.id ?? null, columnas.timbrado);
  const [creado] = await tx
    .insert(comprobantes)
    .values({
      ...columnas,
      contribuyenteId,
      asignacionManual,
      proveedorId: proveedor?.id ?? null,
      timbradoId: timbrado?.id ?? null,
      canal: datos.canal,
      naturaleza,
      naturalezaMotivo,
      estadoTecnico: datos.estadoTecnico,
      estadoFlujo: "BORRADOR",
      camposOrigen: campos,
      advertenciasExtraccion: avisos,
      creadoPor: usuario.id,
    })
    .returning();
  const id = creado!.id;
  if (datos.archivoId) await tx.insert(comprobanteArchivos).values({ comprobanteId: id, archivoId: datos.archivoId });

  // Sugerencia de imputación: la del último comprobante del mismo proveedor y contribuyente.
  if (contribuyenteId && proveedor) await sugerirImputacion(tx, id, contribuyenteId, proveedor.id);

  await registrarAuditoria(
    tx,
    { entidad: "comprobante", entidadId: id, contribuyenteId, accion: "CREAR", valorNuevo: { canal: datos.canal, naturaleza, campos: Object.keys(campos) } },
    datos.request,
  );
  if (asignacionManual) {
    await registrarAuditoria(
      tx,
      { entidad: "comprobante", entidadId: id, contribuyenteId, accion: "ASIGNACION_MANUAL", motivo: "El documento no identifica al receptor" },
      datos.request,
    );
  }
  await reevaluarConRelacionados(tx, id);
  return { resultado: "CREADO", comprobanteId: id, avisos };
}

async function sugerirImputacion(tx: Transaccion, id: number, contribuyenteId: number, proveedorId: number) {
  const [anterior] = await tx
    .select({ id: comprobantes.id, porcentajeNoImputado: comprobantes.porcentajeNoImputado })
    .from(comprobantes)
    .where(
      and(
        eq(comprobantes.contribuyenteId, contribuyenteId),
        eq(comprobantes.proveedorId, proveedorId),
        ne(comprobantes.id, id),
        ne(comprobantes.estadoFlujo, "ANULADO"),
        sql`EXISTS (SELECT 1 FROM imputaciones i WHERE i.comprobante_id = ${comprobantes.id})`,
      ),
    )
    .orderBy(desc(comprobantes.id))
    .limit(1);
  if (!anterior) return;
  const lineas = await imputacionDe(tx, anterior.id);
  await tx.insert(imputaciones).values(
    lineas.map((l) => ({ comprobanteId: id, obligacionCodigo: l.obligacion, actividadId: l.actividadId, porcentaje: l.porcentaje })),
  );
  await tx
    .update(comprobantes)
    .set({
      porcentajeNoImputado: anterior.porcentajeNoImputado,
      camposOrigen: sql`${comprobantes.camposOrigen} || ${JSON.stringify({ _imputacionSugeridaDe: anterior.id })}::jsonb`,
    })
    .where(eq(comprobantes.id, id));
}

/**
 * Cuando llega otra representación del mismo comprobante (por ejemplo, el XML
 * después del PDF), completa o mejora los campos según la prioridad de fuentes,
 * sin pisar correcciones manuales.
 */
async function completarConFuenteSuperior(tx: Transaccion, id: number, nuevos: CamposExtraidos) {
  const [fila] = await tx.select().from(comprobantes).where(eq(comprobantes.id, id));
  if (!fila || !ESTADOS_EDITABLES.includes(fila.estadoFlujo as EstadoFlujo)) return;
  const actuales = resultadoVacio();
  actuales.campos = (fila.camposOrigen ?? {}) as CamposExtraidos;
  const nuevo = resultadoVacio();
  nuevo.campos = Object.fromEntries(
    Object.entries(nuevos).filter(([clave]) => (actuales.campos as Record<string, CampoExtraido>)[clave]?.fuente !== "MANUAL"),
  );
  const combinado = combinarExtracciones(actuales, nuevo).campos;
  const columnas = columnasDesdeCampos(combinado);
  // Solo se actualizan columnas cuyo valor cambió por una fuente de mayor prioridad.
  const cambios: Partial<typeof comprobantes.$inferInsert> = {};
  for (const clave of Object.keys(columnas) as (keyof typeof columnas)[]) {
    const campo = clave as CampoComprobante;
    if (CAMPOS_COMPROBANTE.includes(campo) && combinado[campo] && combinado[campo] !== actuales.campos[campo]) {
      (cambios as Record<string, unknown>)[clave] = columnas[clave];
    }
  }
  if (nuevos.cdc && fila.naturaleza === "NO_DETERMINADA") {
    cambios.naturaleza = "ELECTRONICO";
    cambios.naturalezaMotivo = "CDC válido en otra representación del comprobante";
  }
  await tx
    .update(comprobantes)
    .set({ ...cambios, camposOrigen: { ...(fila.camposOrigen as object), ...combinado }, actualizadoEn: new Date() })
    .where(eq(comprobantes.id, id));
}

// ---------------------------------------------------------------------------
// Edición
// ---------------------------------------------------------------------------

const CAMPOS_RECEPTOR = ["receptorTipoIdentificacion", "receptorNumero", "receptorDv"] as const;

function mascaraCuenta(numero: string) {
  const digitos = numero.replace(/\s/g, "");
  return digitos.length <= 4 ? "****" : `****${digitos.slice(-4)}`;
}

export async function editarComprobante(
  tx: Transaccion,
  id: number,
  cambios: EdicionComprobante,
  usuario: UsuarioSesion,
  request?: FastifyRequest,
): Promise<FilaComprobante> {
  const [anterior] = await tx.select().from(comprobantes).where(eq(comprobantes.id, id)).for("update");
  if (!anterior) throw new ErrorHttp(404, "NO_ENCONTRADO", "Comprobante inexistente");
  exigirVisible(usuario, anterior);
  exigirPerfil(usuario, anterior.contribuyenteId, ["AUXILIAR", "FINANCIERO"]);
  if (!ESTADOS_EDITABLES.includes(anterior.estadoFlujo as EstadoFlujo)) {
    throw new ErrorHttp(409, "NO_EDITABLE", "En este estado el comprobante no se puede modificar; primero hay que observarlo");
  }

  const { motivo, proveedor: proveedorEntrada, numeroCuenta, contribuyenteId: contribuyentePedido, ...resto } = cambios;
  const actualizacion: Partial<typeof comprobantes.$inferInsert> = {};
  const origen = { ...(anterior.camposOrigen as Record<string, unknown>) };
  const marcarManual = (campo: string, valor: unknown) => {
    const previo = origen[campo] as (CampoExtraido & { detectado?: unknown }) | undefined;
    origen[campo] = {
      valor: valor === null ? "" : String(valor),
      fuente: "MANUAL",
      confianza: 1,
      detectado: previo?.fuente === "MANUAL" ? previo.detectado : previo,
      usuarioId: usuario.id,
      fecha: new Date().toISOString(),
    };
  };

  for (const [clave, valor] of Object.entries(resto) as [keyof typeof resto, unknown][]) {
    if (valor === undefined) continue;
    let normalizado = valor;
    if ((clave === "numero" || clave === "asociadoNumero") && typeof valor === "string" && valor) {
      normalizado = normalizarNumeroComprobante(valor) ?? valor;
    }
    if (clave === "asociadoCdc" && typeof valor === "string") normalizado = normalizarCdc(valor) || null;
    if (clave === "cdc" as string) continue;
    if ((anterior as Record<string, unknown>)[clave] === normalizado) continue;
    (actualizacion as Record<string, unknown>)[clave] = normalizado === "" ? null : normalizado;
    if (clave !== "observaciones") marcarManual(clave, normalizado);
  }

  if (cambios.naturaleza && cambios.naturaleza !== anterior.naturaleza) {
    actualizacion.naturalezaMotivo = motivo ? `Cambio manual: ${motivo}` : "Cambio manual";
  }

  if (numeroCuenta !== undefined) {
    actualizacion.numeroCuentaCifrado = numeroCuenta ? cifrar(numeroCuenta) : null;
    actualizacion.numeroCuentaMascara = numeroCuenta ? mascaraCuenta(numeroCuenta) : null;
  }

  // Proveedor
  let proveedorId = anterior.proveedorId;
  if (proveedorEntrada !== undefined) {
    if (proveedorEntrada === null) {
      proveedorId = null;
    } else {
      const { numero, dv } =
        proveedorEntrada.tipoIdentificacion === 11
          ? separarRuc(proveedorEntrada.identificacion)
          : { numero: proveedorEntrada.identificacion, dv: null };
      if (proveedorEntrada.tipoIdentificacion === 11 && dv === null) {
        throw new ErrorHttp(400, "DATOS_INVALIDOS", "Revisá los datos ingresados", { proveedor: `Ingresá el RUC con DV (${numero}-${calcularDV(numero)})` });
      }
      const proveedor = await resolverProveedor(tx, {
        tipoIdentificacion: proveedorEntrada.tipoIdentificacion,
        numero,
        dv,
        razonSocial: proveedorEntrada.razonSocial ?? null,
        fuente: "MANUAL",
      });
      proveedorId = proveedor.id;
    }
    if (proveedorId !== anterior.proveedorId) {
      actualizacion.proveedorId = proveedorId;
      marcarManual("emisorRuc", proveedorEntrada?.identificacion ?? null);
    }
  }
  const timbradoNumero = actualizacion.timbrado !== undefined ? actualizacion.timbrado : anterior.timbrado;
  if (actualizacion.proveedorId !== undefined || actualizacion.timbrado !== undefined) {
    actualizacion.timbradoId = (await resolverTimbrado(tx, proveedorId, timbradoNumero ?? null))?.id ?? null;
  }

  // Receptor y contribuyente (sección 2.3)
  const tocaReceptor = CAMPOS_RECEPTOR.some((c) => actualizacion[c] !== undefined);
  if (tocaReceptor && anterior.receptorNumero && !motivo) {
    throw new ErrorHttp(400, "MOTIVO_REQUERIDO", "Corregir el receptor leído del documento requiere un motivo", { motivo: "Indicá por qué se corrige el receptor" });
  }
  const receptorNumero = actualizacion.receptorNumero !== undefined ? actualizacion.receptorNumero : anterior.receptorNumero;
  if (tocaReceptor || contribuyentePedido !== undefined) {
    const receptor = await contribuyentePorReceptor(tx, receptorNumero ?? null);
    if (receptor.estado === "ADMINISTRADO") {
      if (contribuyentePedido && contribuyentePedido !== receptor.id) {
        throw new ErrorHttp(409, "RECEPTOR_DISTINTO", "El comprobante pertenece al contribuyente que figura como receptor; no puede asignarse a otro");
      }
      actualizacion.contribuyenteId = receptor.id;
      actualizacion.asignacionManual = false;
    } else if (receptor.estado === "SIN_RECEPTOR") {
      if (contribuyentePedido !== undefined) {
        if (contribuyentePedido !== null && !idsVisibles(usuario).includes(contribuyentePedido)) {
          throw new ErrorHttp(403, "SIN_PERMISO", "No tenés acceso a ese contribuyente");
        }
        actualizacion.contribuyenteId = contribuyentePedido;
        actualizacion.asignacionManual = contribuyentePedido !== null;
      }
    } else {
      if (contribuyentePedido) {
        throw new ErrorHttp(409, "RECEPTOR_NO_ADMINISTRADO", "El receptor del documento no es un contribuyente administrado; no puede asignarse a otro");
      }
      actualizacion.contribuyenteId = null;
      actualizacion.asignacionManual = false;
    }
  }
  const contribuyenteFinal = actualizacion.contribuyenteId !== undefined ? actualizacion.contribuyenteId : anterior.contribuyenteId;
  if (contribuyenteFinal !== anterior.contribuyenteId && contribuyenteFinal !== null) {
    exigirPerfil(usuario, contribuyenteFinal, ["AUXILIAR", "FINANCIERO"]);
  }

  if (Object.keys(actualizacion).length === 0 && cambios.observaciones === undefined) return anterior;

  // Duplicado exacto con otro registro (sección 12).
  const clave = {
    cdc: anterior.cdc,
    proveedorId,
    tipoComprobante: actualizacion.tipoComprobante !== undefined ? actualizacion.tipoComprobante : anterior.tipoComprobante,
    timbrado: timbradoNumero ?? null,
    numero: actualizacion.numero !== undefined ? actualizacion.numero : anterior.numero,
  };
  const duplicado = await buscarDuplicadoExacto(tx, clave, id);
  if (duplicado) throw errorDuplicado(duplicado);

  await tx
    .update(comprobantes)
    .set({ ...actualizacion, camposOrigen: origen, actualizadoEn: new Date() })
    .where(eq(comprobantes.id, id));

  const valorAnterior: Record<string, unknown> = {};
  const valorNuevo: Record<string, unknown> = {};
  for (const claveCambio of Object.keys(actualizacion)) {
    if (claveCambio === "numeroCuentaCifrado") continue;
    valorAnterior[claveCambio] = (anterior as Record<string, unknown>)[claveCambio];
    valorNuevo[claveCambio] = (actualizacion as Record<string, unknown>)[claveCambio];
  }
  await registrarAuditoria(
    tx,
    { entidad: "comprobante", entidadId: id, contribuyenteId: contribuyenteFinal, accion: "EDITAR", valorAnterior, valorNuevo, motivo: motivo ?? null },
    request,
  );
  return reevaluarConRelacionados(tx, id, await buscarPosiblesDuplicados(tx, anterior));
}

/**
 * Reevalúa el comprobante y los que eran o pasan a ser sus posibles duplicados,
 * para que la marca aparezca (o desaparezca) en ambos.
 */
export async function reevaluarConRelacionados(tx: Ejecutor, id: number, previos: { id: number }[] = []) {
  const { fila } = await reevaluar(tx, id);
  const actuales = await buscarPosiblesDuplicados(tx, fila);
  const ids = new Set([...previos, ...actuales].map((c) => c.id));
  for (const otro of ids) await reevaluar(tx, otro);
  return fila;
}

// ---------------------------------------------------------------------------
// Imputación
// ---------------------------------------------------------------------------

export async function guardarImputacion(
  tx: Transaccion,
  id: number,
  entrada: ImputacionEntrada,
  usuario: UsuarioSesion,
  request?: FastifyRequest,
) {
  const [fila] = await tx.select().from(comprobantes).where(eq(comprobantes.id, id)).for("update");
  if (!fila) throw new ErrorHttp(404, "NO_ENCONTRADO", "Comprobante inexistente");
  exigirVisible(usuario, fila);
  exigirPerfil(usuario, fila.contribuyenteId, ["AUXILIAR", "FINANCIERO"]);
  if (!ESTADOS_EDITABLES.includes(fila.estadoFlujo as EstadoFlujo)) {
    throw new ErrorHttp(409, "NO_EDITABLE", "En este estado no se puede modificar la imputación");
  }
  if (fila.contribuyenteId === null && entrada.lineas.length > 0) {
    throw new ErrorHttp(409, "SIN_CONTRIBUYENTE", "Asigná primero el contribuyente");
  }

  const codigos = [...new Set(entrada.lineas.map((l) => l.obligacion))];
  if (codigos.length) {
    const existentes = await tx.select({ codigo: obligaciones.codigo }).from(obligaciones).where(inArray(obligaciones.codigo, codigos));
    const faltantes = codigos.filter((c) => !existentes.some((e) => e.codigo === c));
    if (faltantes.length) throw new ErrorHttp(400, "OBLIGACION_INEXISTENTE", `Obligación inexistente: ${faltantes.join(", ")}`);
  }
  const actividadesIds = [...new Set(entrada.lineas.map((l) => l.actividadId).filter((a): a is number => Boolean(a)))];
  if (actividadesIds.length) {
    const validas = await tx
      .select({ id: actividades.id })
      .from(actividades)
      .where(and(inArray(actividades.id, actividadesIds), eq(actividades.contribuyenteId, fila.contribuyenteId!)));
    if (validas.length !== actividadesIds.length) {
      throw new ErrorHttp(400, "ACTIVIDAD_INVALIDA", "Alguna actividad no pertenece al contribuyente");
    }
  }

  const anterior = await imputacionDe(tx, id);
  await tx.delete(imputaciones).where(eq(imputaciones.comprobanteId, id));
  if (entrada.lineas.length) {
    await tx.insert(imputaciones).values(
      entrada.lineas.map((l) => ({
        comprobanteId: id,
        obligacionCodigo: l.obligacion,
        actividadId: l.actividadId ?? null,
        porcentaje: String(l.porcentaje),
      })),
    );
  }
  await tx
    .update(comprobantes)
    .set({ porcentajeNoImputado: String(entrada.porcentajeNoImputado), actualizadoEn: new Date() })
    .where(eq(comprobantes.id, id));
  await registrarAuditoria(
    tx,
    {
      entidad: "comprobante",
      entidadId: id,
      contribuyenteId: fila.contribuyenteId,
      accion: "IMPUTAR",
      valorAnterior: { lineas: anterior, porcentajeNoImputado: fila.porcentajeNoImputado },
      valorNuevo: entrada,
    },
    request,
  );
  return reevaluar(tx, id);
}

// ---------------------------------------------------------------------------
// Acciones de flujo (tabla 15.2)
// ---------------------------------------------------------------------------

export interface ResultadoAccion {
  ok: boolean;
  id: number;
  motivo?: string;
  categoria?: "BLOQUEADO" | "OBSERVADO" | "POSIBLE_DUPLICADO" | "ESTADO" | "PERMISO";
}

export async function ejecutarAccion(
  tx: Transaccion,
  id: number,
  accion: AccionFlujo,
  motivo: string | undefined,
  usuario: UsuarioSesion,
  request?: FastifyRequest,
): Promise<ResultadoAccion> {
  const regla = ACCIONES[accion];
  const [fila] = await tx.select().from(comprobantes).where(eq(comprobantes.id, id)).for("update");
  if (!fila) return { ok: false, id, motivo: "Comprobante inexistente", categoria: "ESTADO" };
  exigirVisible(usuario, fila);

  const perfiles = perfilesFlujo(usuario, fila.contribuyenteId);
  if (!regla.perfiles.some((p) => perfiles.includes(p))) {
    return { ok: false, id, motivo: "Tu perfil no permite esta acción", categoria: "PERMISO" };
  }
  const estado = fila.estadoFlujo as EstadoFlujo;
  const desdeOk = regla.desde === "CUALQUIERA" ? estado !== "ANULADO" : regla.desde.includes(estado);
  if (!desdeOk && accion === "CONFIRMAR" && ESTADOS_AUTOMATICOS.includes(estado)) {
    const { problemas } = await reevaluar(tx, id);
    const bloqueantes = problemas.filter(esBloqueante);
    return {
      ok: false,
      id,
      motivo: bloqueantes.map((p) => p.mensaje).join("; ") || "Revisá el comprobante antes de confirmarlo",
      categoria: estado === "POSIBLE_DUPLICADO" ? "POSIBLE_DUPLICADO" : "BLOQUEADO",
    };
  }
  if (!desdeOk) {
    const categoria = estado === "OBSERVADO" ? "OBSERVADO" : estado === "POSIBLE_DUPLICADO" ? "POSIBLE_DUPLICADO" : "ESTADO";
    return { ok: false, id, motivo: `No se puede ${accion.toLowerCase().replaceAll("_", " ")} un comprobante en estado ${estado.toLowerCase().replaceAll("_", " ")}`, categoria };
  }
  if (regla.requiereMotivo && !motivo?.trim()) {
    return { ok: false, id, motivo: "Esta acción requiere un motivo", categoria: "ESTADO" };
  }

  if (regla.exigeSinBloqueantes) {
    const { problemas } = await reevaluar(tx, id);
    const bloqueantes = problemas.filter(esBloqueante);
    if (bloqueantes.length) {
      return { ok: false, id, motivo: bloqueantes.map((p) => p.mensaje).join("; "), categoria: "BLOQUEADO" };
    }
  }

  const cambios: Partial<typeof comprobantes.$inferInsert> = {
    estadoFlujo: regla.hacia,
    motivoEstado: motivo?.trim() || null,
    actualizadoEn: new Date(),
  };
  if (accion === "ANULAR") {
    cambios.anuladoMotivo = motivo!.trim();
    cambios.anuladoEn = new Date();
    cambios.anuladoPor = usuario.id;
  }
  const relacionadosPrevios = await buscarPosiblesDuplicados(tx, fila);
  if (accion === "DESCARTAR_DUPLICADO") {
    const posibles = relacionadosPrevios;
    cambios.duplicadosDescartados = [...((fila.duplicadosDescartados as number[]) ?? []), ...posibles.map((p) => p.id)];
    // El otro comprobante también deja de considerarse duplicado de este.
    for (const otro of posibles) {
      await tx
        .update(comprobantes)
        .set({ duplicadosDescartados: sql`${comprobantes.duplicadosDescartados} || ${JSON.stringify([id])}::jsonb` })
        .where(eq(comprobantes.id, otro.id));
    }
  }
  await tx.update(comprobantes).set(cambios).where(eq(comprobantes.id, id));
  await registrarAuditoria(
    tx,
    {
      entidad: "comprobante",
      entidadId: id,
      contribuyenteId: fila.contribuyenteId,
      accion,
      perfil: perfiles.includes("FINANCIERO") ? "FINANCIERO" : "AUXILIAR",
      valorAnterior: { estadoFlujo: estado },
      valorNuevo: { estadoFlujo: regla.hacia },
      motivo: motivo ?? null,
    },
    request,
  );
  // Los posibles duplicados vinculados se recalculan.
  await reevaluarConRelacionados(tx, id, relacionadosPrevios);
  return { ok: true, id };
}

/** Recalcula todos los comprobantes no anulados que dependen de un proveedor o timbrado. */
export async function reevaluarPorProveedor(tx: Transaccion, proveedorId: number) {
  const filas = await tx
    .select({ id: comprobantes.id })
    .from(comprobantes)
    .where(and(eq(comprobantes.proveedorId, proveedorId), ne(comprobantes.estadoFlujo, "ANULADO")));
  for (const f of filas) await reevaluar(tx, f.id);
  return filas.length;
}

export async function reevaluarPorContribuyente(tx: Transaccion, contribuyenteId: number) {
  const filas = await tx
    .select({ id: comprobantes.id })
    .from(comprobantes)
    .where(and(eq(comprobantes.contribuyenteId, contribuyenteId), ne(comprobantes.estadoFlujo, "ANULADO"), isNotNull(comprobantes.id)));
  for (const f of filas) await reevaluar(tx, f.id);
}
