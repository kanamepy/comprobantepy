/**
 * Evaluación de un comprobante: qué datos faltan, qué errores bloquean la
 * confirmación y qué advertencias se muestran (secciones 10 a 15 y 23).
 * Para los comprobantes físicos exportables se aplican además las mismas reglas
 * del archivo Marangatu, para que lo aprobado sea siempre exportable.
 */
import { buscarTipoComprobante, destinoExportacion, TIPO_IDENTIFICACION, type NaturalezaFiscal } from "./catalogos.js";
import { esNumeroComprobanteValido, parsearFechaIso } from "./comprobante.js";
import { traducirImputacion, type Imputacion, type IndicadoresSN } from "./imputacion.js";
import { validarCompra, validarEgreso, type CompraExportable, type EgresoExportable } from "./marangatu.js";
import type { EstadoFlujo } from "./estados.js";
import { calcularDV } from "./ruc.js";

export type SeveridadProblema = "FALTA_DATO" | "ERROR" | "ADVERTENCIA";

export interface Problema {
  codigo: string;
  mensaje: string;
  severidad: SeveridadProblema;
  campo?: string;
}

export const esBloqueante = (p: Problema) => p.severidad !== "ADVERTENCIA";

export type EstadoProveedor = "PENDIENTE_DE_CONFIRMAR" | "CONFIRMADO" | "OBSERVADO" | "RECHAZADO";
export type EstadoTimbrado = "VALIDO" | "RECHAZADO" | "NO_VERIFICADO" | "ERROR_DE_CONSULTA";

export interface ProveedorEvaluable {
  estado: EstadoProveedor;
  tipoIdentificacion: number;
  numeroIdentificacion: string;
  dv: number | null;
  razonSocial: string;
}

export interface ComprobanteEvaluable {
  id: string;
  contribuyenteId: number | null;
  naturaleza: NaturalezaFiscal;
  tipoComprobante: number | null;
  proveedor: ProveedorEvaluable | null;
  timbrado: number | null;
  estadoTimbrado: EstadoTimbrado | null;
  numero: string | null;
  fechaEmision: string | null;
  moneda: string;
  tipoCambio: string | null;
  condicion: 1 | 2 | null;
  gravado10: string | null;
  gravado5: string | null;
  exento: string | null;
  total: string | null;
  asociadoNumero: string | null;
  asociadoTimbrado: number | null;
  asociadoCdc: string | null;
  tieneNumeroCuenta: boolean;
  /** Últimos 4 dígitos u otro valor que se exporta; el número completo se guarda cifrado. */
  numeroCuentaExportable: string | null;
  entidadFinanciera: string | null;
  numeroPatronalIps: string | null;
  especificarTipoDocumento: string | null;
  imputacion: Imputacion;
  obligacionesActivas: ReadonlySet<string>;
  posibleDuplicadoPendiente: boolean;
}

/** Convierte un importe en la moneda original a guaraníes enteros. [A CONFIRMAR] criterio de redondeo (D-08). */
export function aGuaranies(valor: string | null, moneda: string, tipoCambio: string | null): number | null {
  if (valor === null || valor === "") return null;
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return null;
  if (moneda === "PYG") return Number.isInteger(numero) ? numero : null;
  const cambio = Number(tipoCambio);
  if (!tipoCambio || !Number.isFinite(cambio) || cambio <= 0) return null;
  return Math.round(numero * cambio);
}

export function indicadoresDe(c: Pick<ComprobanteEvaluable, "imputacion" | "obligacionesActivas">): {
  indicadores: IndicadoresSN;
  errores: string[];
} {
  return traducirImputacion(c.imputacion, c.obligacionesActivas);
}

/** Arma el registro del archivo Marangatu, o null si el comprobante no es exportable. */
export function construirRegistroExportable(c: ComprobanteEvaluable): CompraExportable | EgresoExportable | null {
  if (c.tipoComprobante === null || !c.proveedor || !c.fechaEmision) return null;
  const destino = destinoExportacion(c.tipoComprobante, c.naturaleza);
  if (destino === "NO_EXPORTABLE") return null;
  const gs = (valor: string | null) => aGuaranies(valor, c.moneda, c.tipoCambio) ?? NaN;
  const { indicadores } = indicadoresDe(c);

  if (destino === "COMPRAS") {
    return {
      tipoRegistro: "COMPRA",
      id: c.id,
      tipoIdentificacionProveedor: c.proveedor.tipoIdentificacion,
      numeroIdentificacionProveedor: c.proveedor.numeroIdentificacion,
      razonSocialProveedor: c.proveedor.razonSocial,
      tipoComprobante: c.tipoComprobante,
      fechaEmision: c.fechaEmision,
      timbrado: c.timbrado ?? NaN,
      numeroComprobante: c.numero,
      gravado10: gs(c.gravado10 ?? "0"),
      gravado5: gs(c.gravado5 ?? "0"),
      exento: gs(c.exento ?? "0"),
      total: gs(c.total),
      condicion: c.condicion,
      monedaExtranjera: c.moneda !== "PYG",
      indicadores,
      numeroAsociado: c.asociadoNumero,
      timbradoAsociado: c.asociadoTimbrado,
    };
  }
  return {
    tipoRegistro: "EGRESO",
    id: c.id,
    tipoComprobante: c.tipoComprobante,
    fechaEmision: c.fechaEmision,
    numeroComprobante: c.numero,
    tipoIdentificacionReceptor: c.proveedor.tipoIdentificacion,
    numeroIdentificacionReceptor: c.proveedor.numeroIdentificacion,
    razonSocialReceptor: c.proveedor.razonSocial,
    total: gs(c.total),
    indicadores,
    numeroCuenta: c.numeroCuentaExportable,
    entidadFinanciera: c.entidadFinanciera,
    numeroPatronalIps: c.numeroPatronalIps,
    especificarTipoDocumento: c.especificarTipoDocumento,
    numeroCompraAsociada: c.asociadoNumero,
    timbradoCompraAsociada: c.asociadoTimbrado,
  };
}

const TIPOS_SIN_NUMERO = new Set([106, 107, 112, 205, 206, 207, 208]);
const TIPOS_SIN_TIMBRADO = new Set([107, 201, 202, 204, 205, 206, 207, 208, 209, 211]);

export function evaluarComprobante(c: ComprobanteEvaluable): Problema[] {
  const problemas: Problema[] = [];
  const agregar = (codigo: string, severidad: SeveridadProblema, mensaje: string, campo?: string) =>
    problemas.push({ codigo, severidad, mensaje, campo });

  if (c.contribuyenteId === null) {
    agregar("SIN_CONTRIBUYENTE", "FALTA_DATO", "Falta asignar el contribuyente informante (receptor)", "contribuyenteId");
  }
  if (c.naturaleza === "NO_DETERMINADA") {
    agregar("NATURALEZA_NO_DETERMINADA", "FALTA_DATO", "Indicá si el comprobante es físico, electrónico o virtual", "naturaleza");
  }
  if (c.tipoComprobante === null) {
    agregar("SIN_TIPO", "FALTA_DATO", "Falta el tipo de comprobante", "tipoComprobante");
  } else if (!buscarTipoComprobante(c.tipoComprobante)) {
    agregar("TIPO_NO_EXPORTABLE", "ADVERTENCIA", "Tipo de comprobante no incluido en la matriz: no se exporta", "tipoComprobante");
  }

  if (!c.proveedor) {
    agregar("SIN_PROVEEDOR", "FALTA_DATO", "Falta el proveedor", "proveedor");
  } else {
    if (c.proveedor.tipoIdentificacion === TIPO_IDENTIFICACION.RUC) {
      const esperado = calcularDV(c.proveedor.numeroIdentificacion);
      if (c.proveedor.dv === null) {
        agregar("PROVEEDOR_SIN_DV", "FALTA_DATO", "Falta el dígito verificador del RUC del proveedor", "proveedor");
      } else if (c.proveedor.dv !== esperado) {
        agregar("RUC_DV_INVALIDO", "ERROR", `El DV del RUC del proveedor es incorrecto (se esperaba ${esperado})`, "proveedor");
      }
    }
    if (c.proveedor.estado === "PENDIENTE_DE_CONFIRMAR") {
      agregar("PROVEEDOR_PENDIENTE", "ERROR", "El proveedor está pendiente de confirmación", "proveedor");
    } else if (c.proveedor.estado !== "CONFIRMADO") {
      agregar("PROVEEDOR_NO_CONFIRMADO", "ERROR", `El proveedor está ${c.proveedor.estado.toLowerCase()}`, "proveedor");
    }
  }

  if (!c.fechaEmision) agregar("SIN_FECHA", "FALTA_DATO", "Falta la fecha de emisión", "fechaEmision");
  else if (!parsearFechaIso(c.fechaEmision)) agregar("FECHA_INVALIDA", "ERROR", "Fecha de emisión inválida", "fechaEmision");

  const tipo = c.tipoComprobante;
  if (tipo !== null && !TIPOS_SIN_TIMBRADO.has(tipo) && !c.timbrado) {
    agregar("SIN_TIMBRADO", "FALTA_DATO", "Falta el número de timbrado", "timbrado");
  }
  if (tipo !== null && !TIPOS_SIN_NUMERO.has(tipo) && !c.numero) {
    agregar("SIN_NUMERO", "FALTA_DATO", "Falta el número del comprobante", "numero");
  } else if (c.numero && tipo !== null && tipo < 200 && !esNumeroComprobanteValido(c.numero)) {
    agregar("NUMERO_INVALIDO", "ERROR", "El número debe tener el formato ###-###-#######", "numero");
  }

  if (!c.total || Number(c.total) <= 0) agregar("SIN_TOTAL", "FALTA_DATO", "Falta el importe total", "total");
  if (c.moneda !== "PYG" && !c.tipoCambio) {
    agregar("SIN_TIPO_CAMBIO", "FALTA_DATO", "Falta el tipo de cambio de la moneda extranjera", "tipoCambio");
  }

  if ((tipo === 110 || tipo === 111) && !c.asociadoCdc && (!c.asociadoNumero || !c.asociadoTimbrado)) {
    agregar("SIN_ASOCIADO", "FALTA_DATO", "La nota de crédito o débito requiere el comprobante asociado", "asociadoNumero");
  }

  if (c.estadoTimbrado === "RECHAZADO") {
    agregar("TIMBRADO_RECHAZADO", "ERROR", "El timbrado fue verificado como inválido o fuera de vigencia", "timbrado");
  } else if (c.estadoTimbrado === "NO_VERIFICADO" && c.naturaleza === "FISICO") {
    agregar("TIMBRADO_NO_VERIFICADO", "ADVERTENCIA", "Timbrado no verificado: registrá la verificación manual en la DNIT", "timbrado");
  } else if (c.estadoTimbrado === "ERROR_DE_CONSULTA") {
    agregar("TIMBRADO_ERROR_CONSULTA", "ADVERTENCIA", "No se pudo consultar el timbrado; reintentar", "timbrado");
  }

  const imputacion = indicadoresDe(c);
  for (const error of imputacion.errores) {
    agregar("IMPUTACION", c.imputacion.lineas.length === 0 ? "FALTA_DATO" : "ERROR", error, "imputacion");
  }

  if (c.posibleDuplicadoPendiente) {
    agregar("POSIBLE_DUPLICADO", "ERROR", "Hay otro comprobante muy parecido: confirmá si es un duplicado", "duplicado");
  }

  // Reglas del archivo Marangatu para los físicos exportables, sin repetir lo ya informado.
  const yaInformados = new Set(problemas.map((p) => p.campo));
  const registro = c.naturaleza === "FISICO" ? construirRegistroExportable(c) : null;
  if (registro) {
    const errores = registro.tipoRegistro === "COMPRA" ? validarCompra(registro) : validarEgreso(registro);
    const equivalencias: Record<string, string> = {
      numeroComprobante: "numero",
      numeroIdentificacionProveedor: "proveedor",
      tipoIdentificacionProveedor: "proveedor",
      razonSocialProveedor: "proveedor",
      numeroIdentificacionReceptor: "proveedor",
      tipoIdentificacionReceptor: "proveedor",
      razonSocialReceptor: "proveedor",
      numeroAsociado: "asociadoNumero",
      timbradoAsociado: "asociadoNumero",
      numeroCompraAsociada: "asociadoNumero",
      timbradoCompraAsociada: "asociadoNumero",
      importes: "total",
    };
    for (const error of errores) {
      const campo = equivalencias[error.campo] ?? error.campo;
      if (yaInformados.has(campo) || (campo === "imputaIva" && yaInformados.has("imputacion"))) continue;
      if (campo === "total" && Number.isNaN(registro.total)) continue;
      agregar(`MARANGATU_${error.campo.toUpperCase()}`, "ERROR", error.mensaje, campo);
      yaInformados.add(campo);
    }
    if (registro.tipoRegistro === "COMPRA" && c.moneda === "PYG" && c.total && !Number.isInteger(Number(c.total))) {
      agregar("IMPORTE_CON_DECIMALES", "ERROR", "Los importes en guaraníes no llevan decimales", "total");
    }
  }

  return problemas;
}

/** Estado de flujo que corresponde según los problemas, para los estados automáticos. */
export function estadoAutomatico(problemas: readonly Problema[]): EstadoFlujo {
  const codigos = new Set(problemas.map((p) => p.codigo));
  if (codigos.has("SIN_CONTRIBUYENTE")) return "PENDIENTE_ASIGNACION_CONTRIBUYENTE";
  if (codigos.has("POSIBLE_DUPLICADO")) return "POSIBLE_DUPLICADO";
  if (codigos.has("PROVEEDOR_PENDIENTE")) return "PENDIENTE_CONFIRMACION_PROVEEDOR";
  if (problemas.some((p) => p.severidad === "FALTA_DATO")) return "PENDIENTE_DATOS";
  return "PENDIENTE_DE_REVISION";
}
