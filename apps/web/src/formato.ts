import { ETIQUETA_ESTADO_FLUJO, buscarTipoComprobante, type EstadoFlujo } from "@comprobantepy/shared";

const formateadorGs = new Intl.NumberFormat("es-PY", { maximumFractionDigits: 2 });

export function importe(valor: string | null | undefined, moneda = "PYG") {
  if (valor === null || valor === undefined || valor === "") return "—";
  const texto = formateadorGs.format(Number(valor));
  return moneda === "PYG" ? `₲ ${texto}` : `${moneda} ${texto}`;
}

export function fecha(valor: string | null | undefined) {
  if (!valor) return "—";
  const [a, m, d] = valor.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

export function fechaHora(valor: string) {
  return new Date(valor).toLocaleString("es-PY", { dateStyle: "short", timeStyle: "short" });
}

export function etiquetaEstado(estado: string) {
  return ETIQUETA_ESTADO_FLUJO[estado as EstadoFlujo] ?? estado;
}

export function tipoTexto(codigo: number | null) {
  if (codigo === null) return "Tipo sin definir";
  return buscarTipoComprobante(codigo)?.descripcion ?? `Tipo ${codigo}`;
}

export const ETIQUETA_NATURALEZA: Record<string, string> = {
  FISICO: "Físico",
  ELECTRONICO: "Electrónico",
  VIRTUAL: "Virtual",
  NO_DETERMINADA: "Sin determinar",
};

export const ETIQUETA_ELEGIBILIDAD: Record<string, string> = {
  NO_APLICA_ELECTRONICO: "No se exporta (electrónico)",
  NO_APLICA_VIRTUAL: "No se exporta (virtual)",
  NO_EXPORTABLE: "No exportable",
  NO_ELEGIBLE: "Todavía no exportable",
  ELEGIBLE: "Listo para exportar",
  INCLUIDO_EN_LOTE: "En un lote generado",
  ENVIADO: "Enviado a Marangatu",
  ACEPTADO_DNIT: "Aceptado por la DNIT",
  RECHAZADO_DNIT: "Rechazado por la DNIT",
};

export const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export function periodoTexto(anio: number, mes: number | null) {
  return mes ? `${MESES[mes - 1]} ${anio}` : `año ${anio}`;
}

export const ETIQUETA_TECNICO: Record<string, string> = {
  RECIBIDO: "Recibido",
  PROCESANDO: "Procesando",
  EXTRAIDO: "Datos extraídos",
  ILEGIBLE: "Ilegible",
  XML_VALIDO: "XML válido",
  XML_INVALIDO: "XML inválido",
  VALIDACION_PENDIENTE: "Sin verificar en SIFEN",
  VALIDADO_SIFEN: "Validado en SIFEN",
  RECHAZADO_SIFEN: "Rechazado en SIFEN",
};

export const ETIQUETA_FUENTE: Record<string, string> = {
  XML: "XML",
  PDF_TEXTO: "texto del PDF",
  QR: "QR",
  CDC: "CDC",
  OCR: "OCR",
  MANUAL: "carga manual",
};

/** Tono por estado: el color acompaña siempre a un texto e ícono (sección 16.4). */
export function tonoEstado(estado: string): "verde" | "azul" | "ambar" | "rojo" | "gris" {
  if (estado === "APROBADO") return "verde";
  if (estado === "CONFIRMADO") return "azul";
  if (estado === "RECHAZADO" || estado === "POSIBLE_DUPLICADO") return "rojo";
  if (estado === "ANULADO") return "gris";
  return "ambar";
}

export const ICONO_TONO = { verde: "✔", azul: "●", ambar: "◐", rojo: "✖", gris: "⊘" } as const;
