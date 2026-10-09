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
