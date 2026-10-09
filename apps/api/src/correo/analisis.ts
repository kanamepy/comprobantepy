/**
 * Análisis de un mensaje de correo (sección 7.3): remitente original, dirección que
 * reenvió, buzón de llegada y adjuntos, incluidos los de un correo adjunto (.eml).
 */
import { simpleParser, type AddressObject, type Attachment, type ParsedMail } from "mailparser";
import { detectarTipo, type TipoArchivo } from "../archivos/tipo.js";

export interface AdjuntoCorreo {
  nombre: string;
  contenido: Buffer;
  tipo: TipoArchivo;
  /** true si vino dentro de un correo adjunto (reenvío como .eml). */
  enCorreoAdjunto: boolean;
}

export interface MensajeAnalizado {
  messageId: string | null;
  asunto: string | null;
  fecha: Date | null;
  de: string | null;
  para: string | null;
  remitenteOriginal: string | null;
  reenviadoPor: string | null;
  esReenvio: boolean;
  adjuntos: AdjuntoCorreo[];
  ignorados: { nombre: string; motivo: string }[];
}

const PATRON_CORREO = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;

function primeraDireccion(valor: AddressObject | AddressObject[] | undefined): string | null {
  const lista = Array.isArray(valor) ? valor : valor ? [valor] : [];
  for (const grupo of lista) {
    for (const d of grupo.value) if (d.address) return d.address.toLowerCase();
  }
  return null;
}

function cabecera(mensaje: ParsedMail, nombre: string): string | null {
  const valor = mensaje.headers.get(nombre);
  if (!valor) return null;
  if (typeof valor === "string") return valor;
  if (typeof valor === "object" && "text" in valor) return String((valor as { text: string }).text);
  return String(valor);
}

const ASUNTO_REENVIO = /^\s*(fwd?|rv|fw|reenv(iado|\.)?|tr)\s*:/i;
const MARCA_REENVIO = /(-{5,}\s*(forwarded message|mensaje reenviado|original message|mensaje original)\s*-{5,}|^\s*begin forwarded message:)/im;

/** "De: Proveedor <ventas@proveedor.com.py>" dentro del cuerpo de un reenvío manual. */
function remitenteEnCuerpo(texto: string): string | null {
  const marca = MARCA_REENVIO.exec(texto);
  if (!marca) return null;
  const resto = texto.slice(marca.index);
  const linea = /^\s*(?:\*?)(?:de|from)\s*:\s*\*?(.+)$/im.exec(resto);
  return linea ? (PATRON_CORREO.exec(linea[1]!)?.[0]?.toLowerCase() ?? null) : null;
}

/** Imágenes incrustadas en el cuerpo (logos, firmas) no son comprobantes. */
function esImagenDeFirma(adjunto: Attachment): boolean {
  if (!adjunto.contentType.startsWith("image/")) return false;
  return adjunto.related === true || adjunto.size < 8 * 1024;
}

async function recolectarAdjuntos(mensaje: ParsedMail, enCorreoAdjunto: boolean, salida: MensajeAnalizado, profundidad: number) {
  for (const adjunto of mensaje.attachments) {
    const nombre = adjunto.filename ?? "adjunto";
    if (adjunto.contentType === "message/rfc822") {
      if (profundidad >= 3) {
        salida.ignorados.push({ nombre, motivo: "Demasiados correos anidados" });
        continue;
      }
      const interno = await simpleParser(adjunto.content);
      salida.remitenteOriginal ??= primeraDireccion(interno.from);
      salida.esReenvio = true;
      await recolectarAdjuntos(interno, true, salida, profundidad + 1);
      continue;
    }
    if (esImagenDeFirma(adjunto)) {
      salida.ignorados.push({ nombre, motivo: "Imagen incrustada en el cuerpo (logo o firma)" });
      continue;
    }
    const tipo = detectarTipo(adjunto.content);
    if (!tipo) {
      salida.ignorados.push({ nombre, motivo: "Formato no admitido" });
      continue;
    }
    salida.adjuntos.push({ nombre, contenido: adjunto.content, tipo: tipo.tipo, enCorreoAdjunto });
  }
}

export async function analizarMensaje(crudo: Buffer): Promise<MensajeAnalizado> {
  const mensaje = await simpleParser(crudo, { skipImageLinks: true, skipTextToHtml: true });
  const de = primeraDireccion(mensaje.from);
  const salida: MensajeAnalizado = {
    messageId: mensaje.messageId ?? null,
    asunto: mensaje.subject ?? null,
    fecha: mensaje.date ?? null,
    de,
    para: primeraDireccion(mensaje.to),
    remitenteOriginal: null,
    reenviadoPor: null,
    esReenvio: false,
    adjuntos: [],
    ignorados: [],
  };

  // Reenvío automático: Gmail conserva el remitente original y agrega X-Forwarded-For;
  // otros proveedores usan Resent-From.
  const reenvioAutomatico = cabecera(mensaje, "x-forwarded-for") ?? cabecera(mensaje, "resent-from");
  if (reenvioAutomatico) {
    salida.esReenvio = true;
    salida.reenviadoPor = PATRON_CORREO.exec(reenvioAutomatico)?.[0]?.toLowerCase() ?? null;
    salida.remitenteOriginal = de;
  }

  await recolectarAdjuntos(mensaje, false, salida, 0);

  // Reenvío manual: asunto "RV:/Fwd:" o marca de mensaje reenviado en el cuerpo.
  const texto = mensaje.text ?? "";
  if (!reenvioAutomatico && (salida.esReenvio || ASUNTO_REENVIO.test(salida.asunto ?? "") || MARCA_REENVIO.test(texto))) {
    salida.esReenvio = true;
    salida.reenviadoPor = de;
    salida.remitenteOriginal ??= remitenteEnCuerpo(texto);
  }
  if (!salida.esReenvio) salida.remitenteOriginal = de;
  return salida;
}
