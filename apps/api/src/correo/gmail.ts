/**
 * Adaptador de Gmail API con OAuth 2.0 (sección 7.1). Permiso mínimo que permite leer
 * y etiquetar: gmail.modify. Nunca envía, borra ni archiva mensajes.
 */
import { auth, gmail_v1, gmail } from "@googleapis/gmail";
import { config } from "../config.js";

export const ALCANCES_GMAIL = ["https://www.googleapis.com/auth/gmail.modify"];
const ETIQUETA_LEIDO = "CPY-Leido";
const PREFIJO_ESTADO = "CPY-";

export class ErrorAutenticacionCorreo extends Error {}

/** Interfaz común de los buzones: permite agregar Outlook, IMAP u otros sin tocar el proceso central (RF-032). */
export interface AdaptadorCorreo {
  /** Ids de los mensajes todavía no procesados. */
  listarPendientes(): Promise<string[]>;
  obtenerCrudo(id: string): Promise<Buffer>;
  /** Etiqueta el mensaje como procesado y con su estado (pendiente, procesado, duplicado…). */
  marcar(id: string, estado: string): Promise<void>;
}

export function googleConfigurado() {
  return Boolean(config.google.clientId && config.google.clientSecret);
}

export function clienteOAuth() {
  if (!googleConfigurado()) throw new Error("Faltan GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en el archivo .env");
  return new auth.OAuth2(config.google.clientId, config.google.clientSecret, `${config.urlPublica}/api/correo/oauth/callback`);
}

export function urlAutorizacion(estado: string, direccion: string) {
  return clienteOAuth().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ALCANCES_GMAIL,
    state: estado,
    login_hint: direccion,
    include_granted_scopes: false,
  });
}

/** Canjea el código de autorización; devuelve el refresh token y la dirección autorizada. */
export async function canjearCodigo(codigo: string) {
  const cliente = clienteOAuth();
  const { tokens } = await cliente.getToken(codigo);
  if (!tokens.refresh_token) throw new Error("Google no devolvió un token de actualización; quitá el acceso de la aplicación en tu cuenta de Google y volvé a conectar");
  cliente.setCredentials(tokens);
  const perfil = await gmail({ version: "v1", auth: cliente }).users.getProfile({ userId: "me" });
  return { refreshToken: tokens.refresh_token, direccion: perfil.data.emailAddress?.toLowerCase() ?? "" };
}

export async function revocarToken(refreshToken: string) {
  try {
    await clienteOAuth().revokeToken(refreshToken);
  } catch {
    // Si ya estaba revocado no hay nada más que hacer.
  }
}

function esErrorDeAutenticacion(error: unknown) {
  const e = error as { code?: number | string; response?: { status?: number; data?: { error?: string } }; message?: string };
  return (
    e.response?.data?.error === "invalid_grant" ||
    e.response?.status === 401 ||
    e.code === 401 ||
    /invalid_grant|invalid_client|unauthorized/i.test(e.message ?? "")
  );
}

async function conAutenticacion<T>(operacion: () => Promise<T>): Promise<T> {
  try {
    return await operacion();
  } catch (error) {
    if (esErrorDeAutenticacion(error)) throw new ErrorAutenticacionCorreo((error as Error).message);
    throw error;
  }
}

export function adaptadorGmail(refreshToken: string, filtro: string | null, cliente?: gmail_v1.Gmail): AdaptadorCorreo {
  let api = cliente;
  if (!api) {
    const oauth = clienteOAuth();
    oauth.setCredentials({ refresh_token: refreshToken });
    api = gmail({ version: "v1", auth: oauth });
  }
  const g = api;
  const etiquetas = new Map<string, string>();

  async function idEtiqueta(nombre: string) {
    if (!etiquetas.size) {
      const lista = await g.users.labels.list({ userId: "me" });
      for (const e of lista.data.labels ?? []) if (e.name && e.id) etiquetas.set(e.name, e.id);
    }
    let id = etiquetas.get(nombre);
    if (!id) {
      const creada = await g.users.labels.create({
        userId: "me",
        requestBody: { name: nombre, labelListVisibility: "labelShow", messageListVisibility: "show" },
      });
      id = creada.data.id!;
      etiquetas.set(nombre, id);
    }
    return id;
  }

  return {
    listarPendientes: () =>
      conAutenticacion(async () => {
        const ids: string[] = [];
        let pagina: string | undefined;
        // Solo la etiqueta o carpeta configurada; nunca el buzón completo (sección 7.2).
        const consulta = `${filtro?.trim() || "in:inbox"} -label:${ETIQUETA_LEIDO.toLowerCase()} newer_than:180d`;
        do {
          const r = await g.users.messages.list({ userId: "me", q: consulta, maxResults: 100, pageToken: pagina });
          for (const m of r.data.messages ?? []) if (m.id) ids.push(m.id);
          pagina = r.data.nextPageToken ?? undefined;
        } while (pagina && ids.length < 500);
        // Del más antiguo al más nuevo.
        return ids.reverse();
      }),
    obtenerCrudo: (id) =>
      conAutenticacion(async () => {
        const r = await g.users.messages.get({ userId: "me", id, format: "raw" });
        return Buffer.from(r.data.raw ?? "", "base64url");
      }),
    marcar: (id, estado) =>
      conAutenticacion(async () => {
        const nombreEstado = `${PREFIJO_ESTADO}${estado.charAt(0)}${estado.slice(1).toLowerCase().replaceAll("_", "-")}`;
        await g.users.messages.modify({
          userId: "me",
          id,
          requestBody: { addLabelIds: [await idEtiqueta(ETIQUETA_LEIDO), await idEtiqueta(nombreEstado)] },
        });
      }),
  };
}
