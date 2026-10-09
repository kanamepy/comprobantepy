/** Estados del comprobante en tres dimensiones (sección 15). */
import { destinoExportacion, type NaturalezaFiscal } from "./catalogos.js";

export const ESTADOS_TECNICOS = [
  "RECIBIDO",
  "PROCESANDO",
  "EXTRAIDO",
  "ILEGIBLE",
  "XML_VALIDO",
  "XML_INVALIDO",
  "VALIDACION_PENDIENTE",
  "VALIDADO_SIFEN",
  "RECHAZADO_SIFEN",
] as const;
export type EstadoTecnico = (typeof ESTADOS_TECNICOS)[number];

export const ESTADOS_FLUJO = [
  "BORRADOR",
  "PENDIENTE_ASIGNACION_CONTRIBUYENTE",
  "PENDIENTE_DE_REVISION",
  "PENDIENTE_DATOS",
  "PENDIENTE_CONFIRMACION_PROVEEDOR",
  "POSIBLE_DUPLICADO",
  "CONFIRMADO",
  "OBSERVADO",
  "APROBADO",
  "RECHAZADO",
  "ANULADO",
] as const;
export type EstadoFlujo = (typeof ESTADOS_FLUJO)[number];

export const ETIQUETA_ESTADO_FLUJO: Record<EstadoFlujo, string> = {
  BORRADOR: "Borrador",
  PENDIENTE_ASIGNACION_CONTRIBUYENTE: "Falta asignar contribuyente",
  PENDIENTE_DE_REVISION: "Pendiente de revisión",
  PENDIENTE_DATOS: "Faltan datos",
  PENDIENTE_CONFIRMACION_PROVEEDOR: "Proveedor a confirmar",
  POSIBLE_DUPLICADO: "Posible duplicado",
  CONFIRMADO: "Confirmado",
  OBSERVADO: "Observado",
  APROBADO: "Aprobado",
  RECHAZADO: "Rechazado",
  ANULADO: "Anulado",
};

/** Estados que el sistema recalcula al cambiar los datos (antes de la confirmación). */
export const ESTADOS_AUTOMATICOS: readonly EstadoFlujo[] = [
  "BORRADOR",
  "PENDIENTE_ASIGNACION_CONTRIBUYENTE",
  "PENDIENTE_DE_REVISION",
  "PENDIENTE_DATOS",
  "PENDIENTE_CONFIRMACION_PROVEEDOR",
  "POSIBLE_DUPLICADO",
];

/** Estados en los que se pueden editar los datos del comprobante. */
export const ESTADOS_EDITABLES: readonly EstadoFlujo[] = [...ESTADOS_AUTOMATICOS, "OBSERVADO"];

export type AccionFlujo =
  | "CONFIRMAR"
  | "APROBAR"
  | "OBSERVAR"
  | "RECHAZAR"
  | "ENVIAR_A_REVISION"
  | "REABRIR"
  | "ANULAR"
  | "DESCARTAR_DUPLICADO";

export type PerfilFlujo = "AUXILIAR" | "FINANCIERO";

interface ReglaAccion {
  desde: readonly EstadoFlujo[] | "CUALQUIERA";
  hacia: EstadoFlujo;
  perfiles: readonly PerfilFlujo[];
  requiereMotivo: boolean;
  /** La acción exige que el comprobante no tenga problemas bloqueantes. */
  exigeSinBloqueantes: boolean;
}

/** Transiciones de la tabla 15.2. "ENVIAR_A_REVISION" y "DESCARTAR_DUPLICADO" vuelven al cálculo automático. */
export const ACCIONES: Record<AccionFlujo, ReglaAccion> = {
  CONFIRMAR: { desde: ["PENDIENTE_DE_REVISION"], hacia: "CONFIRMADO", perfiles: ["AUXILIAR", "FINANCIERO"], requiereMotivo: false, exigeSinBloqueantes: true },
  APROBAR: { desde: ["CONFIRMADO"], hacia: "APROBADO", perfiles: ["FINANCIERO"], requiereMotivo: false, exigeSinBloqueantes: true },
  OBSERVAR: {
    desde: ["PENDIENTE_DE_REVISION", "CONFIRMADO", "APROBADO"],
    hacia: "OBSERVADO",
    perfiles: ["AUXILIAR", "FINANCIERO"],
    requiereMotivo: true,
    exigeSinBloqueantes: false,
  },
  RECHAZAR: { desde: ["CONFIRMADO", "OBSERVADO"], hacia: "RECHAZADO", perfiles: ["FINANCIERO"], requiereMotivo: true, exigeSinBloqueantes: false },
  ENVIAR_A_REVISION: { desde: ["OBSERVADO"], hacia: "PENDIENTE_DE_REVISION", perfiles: ["AUXILIAR", "FINANCIERO"], requiereMotivo: false, exigeSinBloqueantes: false },
  REABRIR: { desde: ["RECHAZADO"], hacia: "PENDIENTE_DE_REVISION", perfiles: ["FINANCIERO"], requiereMotivo: true, exigeSinBloqueantes: false },
  ANULAR: { desde: "CUALQUIERA", hacia: "ANULADO", perfiles: ["FINANCIERO"], requiereMotivo: true, exigeSinBloqueantes: false },
  DESCARTAR_DUPLICADO: { desde: ["POSIBLE_DUPLICADO"], hacia: "PENDIENTE_DE_REVISION", perfiles: ["FINANCIERO"], requiereMotivo: true, exigeSinBloqueantes: false },
};

export const ETIQUETA_ACCION: Record<AccionFlujo, string> = {
  CONFIRMAR: "Confirmar",
  APROBAR: "Aprobar",
  OBSERVAR: "Observar",
  RECHAZAR: "Rechazar",
  ENVIAR_A_REVISION: "Enviar a revisión",
  REABRIR: "Reabrir",
  ANULAR: "Anular",
  DESCARTAR_DUPLICADO: "No es duplicado",
};

export function accionesDisponibles(estado: EstadoFlujo, perfiles: readonly PerfilFlujo[]): AccionFlujo[] {
  return (Object.keys(ACCIONES) as AccionFlujo[]).filter((accion) => {
    const regla = ACCIONES[accion];
    const desdeOk = regla.desde === "CUALQUIERA" ? estado !== "ANULADO" : regla.desde.includes(estado);
    return desdeOk && regla.perfiles.some((p) => perfiles.includes(p));
  });
}

/** Estado de elegibilidad para Marangatu (sección 15.3). */
export type EstadoElegibilidad =
  | "NO_APLICA_ELECTRONICO"
  | "NO_APLICA_VIRTUAL"
  | "NO_EXPORTABLE"
  | "NO_ELEGIBLE"
  | "ELEGIBLE"
  | "INCLUIDO_EN_LOTE"
  | "ENVIADO"
  | "ACEPTADO_DNIT"
  | "RECHAZADO_DNIT";

/** Estados de un comprobante dentro de un lote, guardados en el comprobante. */
export type EstadoLoteComprobante = "INCLUIDO_EN_LOTE" | "ENVIADO" | "ACEPTADO_DNIT" | "RECHAZADO_DNIT";

/** Mientras está en uno de estos estados el comprobante no se modifica ni se observa (sección 15.3). */
export const ESTADOS_LOTE_BLOQUEANTES: readonly string[] = ["INCLUIDO_EN_LOTE", "ENVIADO", "ACEPTADO_DNIT"];

export function calcularElegibilidad(datos: {
  naturaleza: NaturalezaFiscal;
  tipoComprobante: number | null;
  estadoFlujo: EstadoFlujo;
  tieneBloqueantes: boolean;
  estadoMarangatu?: string | null;
}): { estado: EstadoElegibilidad; motivo: string } {
  if (datos.naturaleza === "ELECTRONICO") return { estado: "NO_APLICA_ELECTRONICO", motivo: "Marangatu lo obtiene de SIFEN" };
  if (datos.naturaleza === "VIRTUAL") return { estado: "NO_APLICA_VIRTUAL", motivo: "Marangatu lo obtiene del sistema de comprobantes virtuales" };
  if (datos.estadoMarangatu === "INCLUIDO_EN_LOTE") return { estado: "INCLUIDO_EN_LOTE", motivo: "Incluido en un lote generado" };
  if (datos.estadoMarangatu === "ENVIADO") return { estado: "ENVIADO", motivo: "El archivo fue importado en Marangatu" };
  if (datos.estadoMarangatu === "ACEPTADO_DNIT") return { estado: "ACEPTADO_DNIT", motivo: "La DNIT no informó errores" };
  if (datos.naturaleza === "NO_DETERMINADA") return { estado: "NO_ELEGIBLE", motivo: "Naturaleza fiscal no determinada" };
  if (datos.tipoComprobante === null || destinoExportacion(datos.tipoComprobante, datos.naturaleza) === "NO_EXPORTABLE") {
    return { estado: "NO_EXPORTABLE", motivo: "El tipo de comprobante no tiene destino Compras ni Egresos" };
  }
  if (datos.estadoFlujo === "ANULADO") return { estado: "NO_ELEGIBLE", motivo: "Anulado" };
  const listo = !datos.tieneBloqueantes && datos.estadoFlujo === "APROBADO";
  if (datos.estadoMarangatu === "RECHAZADO_DNIT" && !listo) {
    return { estado: "RECHAZADO_DNIT", motivo: "La DNIT informó un error: corregir, aprobar y reenviar" };
  }
  if (datos.tieneBloqueantes) return { estado: "NO_ELEGIBLE", motivo: "Tiene errores bloqueantes" };
  if (datos.estadoFlujo !== "APROBADO") return { estado: "NO_ELEGIBLE", motivo: "Falta la aprobación del Financiero" };
  return {
    estado: "ELEGIBLE",
    motivo: datos.estadoMarangatu === "RECHAZADO_DNIT" ? "Corregido: listo para reenviar" : "Listo para incluir en un lote",
  };
}
