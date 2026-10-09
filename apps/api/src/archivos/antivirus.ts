/**
 * Análisis antivirus opcional con ClamAV (clamd, protocolo INSTREAM por TCP). Si está
 * configurado y no responde, el archivo NO se acepta (falla cerrado): se reintenta luego.
 */
import { connect } from "node:net";
import { ErrorHttp } from "../auth/sesiones.js";
import { config } from "../config.js";

export interface DestinoAntivirus {
  host: string;
  puerto: number;
  esperaMs: number;
}

let destino: DestinoAntivirus | null = config.clamav;

/** Cambia el servidor de antivirus (o lo desactiva con null). Usado por las pruebas. */
export function fijarAntivirus(nuevo: DestinoAntivirus | null) {
  destino = nuevo;
}

export type ResultadoAnalisis = { limpio: true } | { limpio: false; amenaza: string };

const BLOQUE = 64 * 1024;

export function analizarConClamav(contenido: Buffer, d: DestinoAntivirus): Promise<ResultadoAnalisis> {
  return new Promise((resolver, rechazar) => {
    const socket = connect({ host: d.host, port: d.puerto });
    const partes: Buffer[] = [];
    let terminado = false;
    const fallar = (error: Error) => {
      if (terminado) return;
      terminado = true;
      socket.destroy();
      rechazar(error);
    };
    socket.setTimeout(d.esperaMs, () => fallar(new Error("El antivirus no respondió a tiempo")));
    socket.on("error", fallar);
    socket.on("data", (dato) => partes.push(dato));
    socket.on("end", () => {
      if (terminado) return;
      terminado = true;
      const respuesta = Buffer.concat(partes).toString("utf8").replace(/\0/g, "").trim();
      if (/:\s*OK$/.test(respuesta)) return resolver({ limpio: true });
      const encontrado = /:\s*(.+)\s+FOUND$/.exec(respuesta);
      if (encontrado) return resolver({ limpio: false, amenaza: encontrado[1]! });
      rechazar(new Error(`Respuesta inesperada del antivirus: ${respuesta.slice(0, 200) || "(vacía)"}`));
    });
    socket.on("connect", () => {
      socket.write("zINSTREAM\0");
      for (let i = 0; i < contenido.length; i += BLOQUE) {
        const trozo = contenido.subarray(i, i + BLOQUE);
        const largo = Buffer.alloc(4);
        largo.writeUInt32BE(trozo.length);
        socket.write(largo);
        socket.write(trozo);
      }
      socket.write(Buffer.alloc(4));
    });
  });
}

/** Rechaza el archivo si está infectado o si el antivirus configurado no está disponible. */
export async function exigirArchivoLimpio(contenido: Buffer, nombre: string) {
  if (!destino) return;
  let resultado: ResultadoAnalisis;
  try {
    resultado = await analizarConClamav(contenido, destino);
  } catch (error) {
    throw new ErrorHttp(503, "ANTIVIRUS_NO_DISPONIBLE", `No se pudo analizar ${nombre} con el antivirus: ${(error as Error).message}. Probá de nuevo más tarde.`);
  }
  if (!resultado.limpio) {
    throw new ErrorHttp(422, "ARCHIVO_INFECTADO", `${nombre}: el antivirus detectó «${resultado.amenaza}». El archivo no se guardó.`);
  }
}
