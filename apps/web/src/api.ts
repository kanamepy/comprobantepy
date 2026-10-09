/** Cliente mínimo de la API. Las cookies de sesión viajan automáticamente. */

export class ErrorApi extends Error {
  constructor(
    public readonly estado: number,
    public readonly codigo: string,
    mensaje: string,
    public readonly detalles?: Record<string, string>,
  ) {
    super(mensaje);
  }
}

export async function api<T>(ruta: string, opciones: { metodo?: string; cuerpo?: unknown } = {}): Promise<T> {
  const respuesta = await fetch(`/api${ruta}`, {
    method: opciones.metodo ?? (opciones.cuerpo === undefined ? "GET" : "POST"),
    headers: opciones.cuerpo === undefined ? {} : { "Content-Type": "application/json" },
    body: opciones.cuerpo === undefined ? undefined : JSON.stringify(opciones.cuerpo),
    credentials: "same-origin",
  });
  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) {
    throw new ErrorApi(
      respuesta.status,
      datos.codigo ?? "ERROR",
      datos.error ?? "No se pudo completar la operación",
      datos.detalles,
    );
  }
  return datos as T;
}

export interface ContribuyenteResumen {
  id: number;
  nombre: string;
  estado: "ACTIVO" | "BAJA";
  perfiles: string[];
}

export interface RespuestaYo {
  usuario: {
    id: number;
    email: string;
    nombre: string;
    esAdministrador: boolean;
    totpActivo: boolean;
    requiereConfigurar2fa: boolean;
  };
  contribuyentes: ContribuyenteResumen[];
}

export interface Contribuyente {
  id: number;
  nombre: string;
  tipoIdentificacion: "RUC" | "CI";
  numeroIdentificacion: string;
  dv: number | null;
  relacion: string | null;
  obligacionRegistro: "955" | "956" | null;
  correoContacto: string | null;
  estado: "ACTIVO" | "BAJA";
  autorizacionFecha: string;
  autorizacionForma: string;
  autorizacionAlcance: string;
  bajaMotivo: string | null;
}

/** Envío de archivos (multipart). */
export async function apiFormulario<T>(ruta: string, datos: FormData): Promise<T> {
  const respuesta = await fetch(`/api${ruta}`, { method: "POST", body: datos, credentials: "same-origin" });
  const cuerpo = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) {
    throw new ErrorApi(respuesta.status, cuerpo.codigo ?? "ERROR", cuerpo.error ?? "No se pudo completar la operación", cuerpo.detalles);
  }
  return cuerpo as T;
}

export interface ProblemaApi {
  codigo: string;
  mensaje: string;
  severidad: "FALTA_DATO" | "ERROR" | "ADVERTENCIA";
  campo?: string;
}

export interface CampoOrigen {
  valor: string;
  fuente: "XML" | "PDF_TEXTO" | "QR" | "CDC" | "OCR" | "MANUAL";
  confianza: number;
  detectado?: CampoOrigen;
}

export interface ComprobanteApi {
  id: number;
  contribuyenteId: number | null;
  asignacionManual: boolean;
  proveedorId: number | null;
  canal: string;
  naturaleza: "FISICO" | "ELECTRONICO" | "VIRTUAL" | "NO_DETERMINADA";
  naturalezaMotivo: string | null;
  tipoComprobante: number | null;
  cdc: string | null;
  timbrado: number | null;
  numero: string | null;
  fechaEmision: string | null;
  moneda: string;
  tipoCambio: string | null;
  condicion: number | null;
  receptorTipoIdentificacion: "RUC" | "CI" | "OTRO" | null;
  receptorNumero: string | null;
  receptorDv: number | null;
  receptorNombre: string | null;
  gravado10: string | null;
  gravado5: string | null;
  exento: string | null;
  iva10: string | null;
  iva5: string | null;
  total: string | null;
  asociadoNumero: string | null;
  asociadoTimbrado: number | null;
  asociadoCdc: string | null;
  numeroCuentaMascara: string | null;
  entidadFinanciera: string | null;
  numeroPatronalIps: string | null;
  especificarTipoDocumento: string | null;
  porcentajeNoImputado: string;
  estadoTecnico: string;
  estadoFlujo: string;
  motivoEstado: string | null;
  problemas: ProblemaApi[];
  camposOrigen: Record<string, CampoOrigen | number | undefined>;
  advertenciasExtraccion: string[];
  observaciones: string | null;
  creadoEn: string;
}

export interface Elegibilidad {
  estado: string;
  motivo: string;
}

export interface FilaBandeja extends ComprobanteApi {
  proveedor: { id: number; razonSocial: string; numeroIdentificacion: string; dv: number | null; estado: string } | null;
  contribuyente: { id: number; nombre: string } | null;
  archivoId: number | null;
  obligaciones: string[];
  estadoTimbrado: string | null;
  destino: string | null;
  elegibilidad: Elegibilidad;
  resumenProblemas: { faltanDatos: number; errores: number; advertencias: number };
  acciones: string[];
}

export interface Proveedor {
  id: number;
  tipoIdentificacion: number;
  numeroIdentificacion: string;
  dv: number | null;
  razonSocial: string;
  nombreFantasia: string | null;
  estado: "PENDIENTE_DE_CONFIRMAR" | "CONFIRMADO" | "OBSERVADO" | "RECHAZADO";
  emisorElectronico: boolean;
  emisorVirtual: boolean;
  fuente: string;
  observacion: string | null;
}

export interface Timbrado {
  id: number;
  proveedorId: number;
  numero: number;
  vigenciaDesde: string | null;
  vigenciaHasta: string | null;
  estadoVerificacion: string;
  consultaEn: string | null;
  evidenciaArchivoId: number | null;
  observacion: string | null;
}

export interface DetalleComprobante {
  comprobante: ComprobanteApi;
  proveedor: Proveedor | null;
  timbrado: (Timbrado & { estado: string | null }) | null;
  contribuyente: { id: number; nombre: string } | null;
  archivos: { id: number; nombreOriginal: string; tipoMime: string; tipoDetectado: string; tamano: number; sha256: string; canal: string }[];
  imputacion: {
    lineas: { id: number; obligacion: string; actividadId: number | null; actividad: string | null; porcentaje: string }[];
    porcentajeNoImputado: string;
  };
  problemas: ProblemaApi[];
  destino: string | null;
  elegibilidad: Elegibilidad;
  acciones: string[];
  posiblesDuplicados: { id: number; numero: string | null; estadoFlujo: string; contribuyenteId: number | null }[];
  historial: { id: number; ocurridoEn: string; accion: string; motivo: string | null; usuario: string | null; valorAnterior: unknown; valorNuevo: unknown }[];
  obligacionesActivas: { codigo: string; descripcion: string }[];
  actividades: { id: number; descripcion: string }[];
}
