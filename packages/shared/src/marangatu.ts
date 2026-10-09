/**
 * Registros de Compras (código 2) y Egresos (código 4) para la importación en
 * Marangatu, según la Especificación Técnica para Importación de junio 2021
 * (secciones 18.2 a 18.5 de la especificación funcional).
 *
 * Todos los importes se reciben ya convertidos a guaraníes enteros.
 */

import { buscarTipoComprobante, TIPO_IDENTIFICACION } from "./catalogos.js";
import { esNumeroComprobanteValido, fechaIsoADdMmAaaa, fechaIsoAMmAaaa, parsearFechaIso } from "./comprobante.js";
import type { IndicadoresSN } from "./imputacion.js";

export const FECHA_MINIMA = "2021-01-01";

/** Tipos de Compras donde solo se informa el total (campos 9 a 11 en 0). */
const COMPRAS_SOLO_TOTAL = new Set([101, 104, 105, 112]);
const COMPRAS_SIN_NUMERO = new Set([106, 107, 112]);
const COMPRAS_CON_ASOCIADO = new Set([110, 111]);
const COMPRAS_TIPO_ID_LIBRE = new Set([101, 107]);

const EGRESOS_FECHA_PERIODO = new Set([206, 208]);
const EGRESOS_SIN_NUMERO = new Set([205, 206, 207, 208]);
const EGRESOS_SIN_RECEPTOR = new Set([206, 207, 211]);
const EGRESOS_CON_CUENTA = new Set([207, 211]);

export interface CompraExportable {
  tipoRegistro: "COMPRA";
  /** Identificador interno, para informar errores y armar la conciliación. */
  id: string;
  tipoIdentificacionProveedor: number;
  /** RUC sin DV u otro número de identificación. */
  numeroIdentificacionProveedor: string;
  razonSocialProveedor: string;
  tipoComprobante: number;
  /** Fecha ISO `aaaa-mm-dd`. */
  fechaEmision: string;
  timbrado: number;
  numeroComprobante: string | null;
  gravado10: number;
  gravado5: number;
  exento: number;
  total: number;
  /** 1 contado, 2 crédito. */
  condicion: 1 | 2 | null;
  monedaExtranjera: boolean;
  indicadores: IndicadoresSN;
  numeroAsociado: string | null;
  timbradoAsociado: number | null;
}

export interface EgresoExportable {
  tipoRegistro: "EGRESO";
  id: string;
  tipoComprobante: number;
  /** Fecha ISO `aaaa-mm-dd`; para 206 y 208 se exporta solo mes y año. */
  fechaEmision: string;
  numeroComprobante: string | null;
  tipoIdentificacionReceptor: number | null;
  numeroIdentificacionReceptor: string | null;
  razonSocialReceptor: string | null;
  total: number;
  indicadores: IndicadoresSN;
  numeroCuenta: string | null;
  entidadFinanciera: string | null;
  numeroPatronalIps: string | null;
  especificarTipoDocumento: string | null;
  numeroCompraAsociada: string | null;
  timbradoCompraAsociada: number | null;
}

export type RegistroExportable = CompraExportable | EgresoExportable;

export interface ErrorValidacion {
  id: string;
  campo: string;
  mensaje: string;
}

const sn = (valor: boolean) => (valor ? "S" : "N");

/** Quita delimitadores y saltos de línea que romperían el archivo. */
function textoLimpio(valor: string | null | undefined, maximo: number): string {
  return (valor ?? "").replace(/[\t\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, maximo);
}

function esEnteroNoNegativo(valor: number) {
  return Number.isSafeInteger(valor) && valor >= 0;
}

function validarIndicadores(
  id: string,
  indicadores: IndicadoresSN,
  errores: ErrorValidacion[],
) {
  const alguna = indicadores.imputaIva || indicadores.imputaIre || indicadores.imputaIrpRsp;
  if (!alguna) {
    errores.push({
      id,
      campo: "imputacion",
      mensaje: indicadores.noImputa
        ? "\"No imputa\" = S exige que otra obligación sea S"
        : "El comprobante no tiene ninguna obligación imputada",
    });
  }
}

function validarFecha(id: string, fecha: string, condicionCredito: boolean, errores: ErrorValidacion[]) {
  if (!parsearFechaIso(fecha)) {
    errores.push({ id, campo: "fechaEmision", mensaje: `Fecha inválida: ${fecha}` });
    return;
  }
  if (fecha < FECHA_MINIMA && !condicionCredito) {
    errores.push({ id, campo: "fechaEmision", mensaje: "La fecha no puede ser anterior al 01/01/2021" });
  }
}

export function validarCompra(c: CompraExportable): ErrorValidacion[] {
  const errores: ErrorValidacion[] = [];
  const e = (campo: string, mensaje: string) => errores.push({ id: c.id, campo, mensaje });

  const tipo = buscarTipoComprobante(c.tipoComprobante);
  if (!tipo || tipo.destino !== "COMPRAS") {
    e("tipoComprobante", `El tipo ${c.tipoComprobante} no corresponde a Compras`);
  }
  if (!COMPRAS_TIPO_ID_LIBRE.has(c.tipoComprobante) && c.tipoIdentificacionProveedor !== TIPO_IDENTIFICACION.RUC) {
    e("tipoIdentificacionProveedor", "Para este tipo de comprobante el proveedor debe identificarse con RUC (11)");
  }
  if (!c.numeroIdentificacionProveedor.trim()) {
    e("numeroIdentificacionProveedor", "Falta la identificación del proveedor");
  } else if (c.numeroIdentificacionProveedor.includes("-")) {
    e("numeroIdentificacionProveedor", "El RUC se informa sin dígito verificador");
  } else if (c.numeroIdentificacionProveedor.length > 20) {
    e("numeroIdentificacionProveedor", "La identificación supera 20 caracteres");
  }
  const requiereRazonSocial = !(
    c.tipoIdentificacionProveedor === TIPO_IDENTIFICACION.RUC ||
    c.tipoIdentificacionProveedor === TIPO_IDENTIFICACION.CEDULA
  );
  if (requiereRazonSocial && !c.razonSocialProveedor.trim()) {
    e("razonSocialProveedor", "Falta el nombre o razón social del proveedor");
  }

  validarFecha(c.id, c.fechaEmision, c.condicion === 2, errores);

  if (c.tipoComprobante === 107) {
    if (c.timbrado !== 0) e("timbrado", "El despacho de importación (107) se informa con timbrado 0");
  } else if (!Number.isSafeInteger(c.timbrado) || c.timbrado <= 0 || c.timbrado > 99_999_999) {
    e("timbrado", "Timbrado requerido de hasta 8 dígitos");
  }

  if (!COMPRAS_SIN_NUMERO.has(c.tipoComprobante)) {
    if (!c.numeroComprobante || !esNumeroComprobanteValido(c.numeroComprobante)) {
      e("numeroComprobante", "Número requerido con formato ###-###-#######");
    }
  } else if (c.numeroComprobante && c.numeroComprobante.length > 20) {
    e("numeroComprobante", "El número supera 20 caracteres");
  }

  for (const campo of ["gravado10", "gravado5", "exento"] as const) {
    if (!esEnteroNoNegativo(c[campo])) e(campo, "Importe entero mayor o igual a 0");
  }
  if (!Number.isSafeInteger(c.total) || c.total <= 0) e("total", "El total debe ser un entero mayor a 0");

  if (COMPRAS_SOLO_TOTAL.has(c.tipoComprobante)) {
    if (c.gravado10 !== 0 || c.gravado5 !== 0 || c.exento !== 0) {
      e("importes", `Para el tipo ${c.tipoComprobante} solo se informa el total; gravados y exento deben ser 0`);
    }
  } else if (c.gravado10 + c.gravado5 + c.exento !== c.total) {
    e("total", "El total debe ser igual a gravado 10 % + gravado 5 % + exento");
  }

  if (c.tipoComprobante === 109 && c.condicion === null) {
    e("condicion", "La condición de compra es obligatoria para facturas");
  }

  validarIndicadores(c.id, c.indicadores, errores);

  if (COMPRAS_CON_ASOCIADO.has(c.tipoComprobante)) {
    if (!c.numeroAsociado || !esNumeroComprobanteValido(c.numeroAsociado)) {
      e("numeroAsociado", "La nota de crédito o débito requiere el número del comprobante asociado");
    }
    if (!c.timbradoAsociado || c.timbradoAsociado <= 0) {
      e("timbradoAsociado", "La nota de crédito o débito requiere el timbrado del comprobante asociado");
    }
  }

  return errores;
}

export function validarEgreso(g: EgresoExportable): ErrorValidacion[] {
  const errores: ErrorValidacion[] = [];
  const e = (campo: string, mensaje: string) => errores.push({ id: g.id, campo, mensaje });

  const tipo = buscarTipoComprobante(g.tipoComprobante);
  if (!tipo || tipo.destino !== "EGRESOS") {
    e("tipoComprobante", `El tipo ${g.tipoComprobante} no corresponde a Egresos`);
  }

  validarFecha(g.id, g.fechaEmision, false, errores);

  if (!EGRESOS_SIN_NUMERO.has(g.tipoComprobante) && !g.numeroComprobante?.trim()) {
    e("numeroComprobante", "Falta el número del comprobante o de la transacción");
  }
  if (g.numeroComprobante && g.numeroComprobante.length > 20) {
    e("numeroComprobante", "El número supera 20 caracteres");
  }

  if (!EGRESOS_SIN_RECEPTOR.has(g.tipoComprobante)) {
    if (g.tipoIdentificacionReceptor === null) {
      e("tipoIdentificacionReceptor", "Falta el tipo de identificación del receptor del pago");
    }
    if (!g.numeroIdentificacionReceptor?.trim()) {
      e("numeroIdentificacionReceptor", "Falta la identificación del receptor del pago");
    }
  }
  if ((g.tipoComprobante === 204 || g.tipoComprobante === 205) && g.tipoIdentificacionReceptor !== TIPO_IDENTIFICACION.RUC) {
    e("tipoIdentificacionReceptor", `Para el tipo ${g.tipoComprobante} el receptor se identifica con RUC (11)`);
  }
  if (g.tipoComprobante === 202 && g.tipoIdentificacionReceptor !== TIPO_IDENTIFICACION.IDENTIFICACION_EXTERIOR) {
    e("tipoIdentificacionReceptor", "Para el tipo 202 el receptor se identifica con el código 17");
  }
  if (g.numeroIdentificacionReceptor?.includes("-")) {
    e("numeroIdentificacionReceptor", "El RUC se informa sin dígito verificador");
  }

  const requiereNombre = !(
    g.tipoIdentificacionReceptor === TIPO_IDENTIFICACION.RUC ||
    g.tipoIdentificacionReceptor === TIPO_IDENTIFICACION.CEDULA ||
    g.tipoComprobante === 206
  );
  if (requiereNombre && !g.razonSocialReceptor?.trim()) {
    e("razonSocialReceptor", "Falta el nombre, razón social o descripción");
  }

  if (!Number.isSafeInteger(g.total) || g.total <= 0) e("total", "El total debe ser un entero mayor a 0");

  if (g.indicadores.imputaIva && g.tipoComprobante !== 207) {
    e("imputaIva", "En Egresos solo el tipo 207 (extracto TC/TD) puede imputar al IVA");
  }
  validarIndicadores(g.id, g.indicadores, errores);

  if (EGRESOS_CON_CUENTA.has(g.tipoComprobante)) {
    if (!g.numeroCuenta?.trim()) e("numeroCuenta", "Falta el número de cuenta o tarjeta");
    if (!g.entidadFinanciera?.trim()) e("entidadFinanciera", "Falta el banco, financiera o cooperativa");
  }
  if (g.tipoComprobante === 206 && !g.numeroPatronalIps?.trim()) {
    e("numeroPatronalIps", "Falta el número patronal de IPS");
  }
  if (g.tipoComprobante === 209 && !g.especificarTipoDocumento?.trim()) {
    e("especificarTipoDocumento", "Falta especificar el tipo de documento");
  }
  if (g.tipoComprobante === 201) {
    if (!g.numeroCompraAsociada || !esNumeroComprobanteValido(g.numeroCompraAsociada)) {
      e("numeroCompraAsociada", "El tipo 201 requiere el número de la compra a crédito asociada");
    }
    if (!g.timbradoCompraAsociada || g.timbradoCompraAsociada <= 0) {
      e("timbradoCompraAsociada", "El tipo 201 requiere el timbrado de la compra a crédito asociada");
    }
  }

  return errores;
}

export function validarRegistro(r: RegistroExportable): ErrorValidacion[] {
  return r.tipoRegistro === "COMPRA" ? validarCompra(r) : validarEgreso(r);
}

/** Campos de una fila de Compras (20), en el orden de la sección 18.4. Supone el registro validado. */
export function camposCompra(c: CompraExportable): string[] {
  const esIdSinNombre =
    c.tipoIdentificacionProveedor === TIPO_IDENTIFICACION.RUC ||
    c.tipoIdentificacionProveedor === TIPO_IDENTIFICACION.CEDULA;
  const soloTotal = COMPRAS_SOLO_TOTAL.has(c.tipoComprobante);
  return [
    "2",
    String(c.tipoIdentificacionProveedor),
    textoLimpio(c.numeroIdentificacionProveedor, 20),
    esIdSinNombre ? "" : textoLimpio(c.razonSocialProveedor, 250),
    String(c.tipoComprobante),
    fechaIsoADdMmAaaa(c.fechaEmision),
    String(c.tipoComprobante === 107 ? 0 : c.timbrado),
    COMPRAS_SIN_NUMERO.has(c.tipoComprobante) && !c.numeroComprobante ? "" : textoLimpio(c.numeroComprobante, 20),
    String(soloTotal ? 0 : c.gravado10),
    String(soloTotal ? 0 : c.gravado5),
    String(soloTotal ? 0 : c.exento),
    String(c.total),
    c.condicion === null ? "" : String(c.condicion),
    sn(c.monedaExtranjera),
    sn(c.indicadores.imputaIva),
    sn(c.indicadores.imputaIre),
    sn(c.indicadores.imputaIrpRsp),
    sn(c.indicadores.noImputa),
    COMPRAS_CON_ASOCIADO.has(c.tipoComprobante) ? textoLimpio(c.numeroAsociado, 20) : "",
    COMPRAS_CON_ASOCIADO.has(c.tipoComprobante) && c.timbradoAsociado ? String(c.timbradoAsociado) : "",
  ];
}

/** Campos de una fila de Egresos (18), en el orden de la sección 18.5. Supone el registro validado. */
export function camposEgreso(g: EgresoExportable): string[] {
  const sinReceptor = EGRESOS_SIN_RECEPTOR.has(g.tipoComprobante);
  const esIdSinNombre =
    g.tipoIdentificacionReceptor === TIPO_IDENTIFICACION.RUC ||
    g.tipoIdentificacionReceptor === TIPO_IDENTIFICACION.CEDULA;
  return [
    "4",
    String(g.tipoComprobante),
    EGRESOS_FECHA_PERIODO.has(g.tipoComprobante) ? fechaIsoAMmAaaa(g.fechaEmision) : fechaIsoADdMmAaaa(g.fechaEmision),
    textoLimpio(g.numeroComprobante, 20),
    sinReceptor || g.tipoIdentificacionReceptor === null ? "" : String(g.tipoIdentificacionReceptor),
    sinReceptor ? "" : textoLimpio(g.numeroIdentificacionReceptor, 20),
    esIdSinNombre || g.tipoComprobante === 206 ? "" : textoLimpio(g.razonSocialReceptor, 250),
    String(g.total),
    sn(g.indicadores.imputaIva),
    sn(g.indicadores.imputaIre),
    sn(g.indicadores.imputaIrpRsp),
    sn(g.indicadores.noImputa),
    EGRESOS_CON_CUENTA.has(g.tipoComprobante) ? textoLimpio(g.numeroCuenta, 30) : "",
    EGRESOS_CON_CUENTA.has(g.tipoComprobante) ? textoLimpio(g.entidadFinanciera, 250) : "",
    g.tipoComprobante === 206 ? textoLimpio(g.numeroPatronalIps, 30) : "",
    g.tipoComprobante === 209 ? textoLimpio(g.especificarTipoDocumento, 50) : "",
    g.tipoComprobante === 201 ? textoLimpio(g.numeroCompraAsociada, 20) : "",
    g.tipoComprobante === 201 && g.timbradoCompraAsociada ? String(g.timbradoCompraAsociada) : "",
  ];
}

export function camposRegistro(r: RegistroExportable): string[] {
  return r.tipoRegistro === "COMPRA" ? camposCompra(r) : camposEgreso(r);
}
