/**
 * Almacenamiento de archivos originales (sección 21.1): cifrados y nunca públicos.
 * Esta versión guarda en disco local; un adaptador S3/R2 se agrega para producción
 * sin cambiar el resto del código.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { config } from "../config.js";

export interface Almacenamiento {
  guardar(contenido: Buffer, sha256: string): Promise<string>;
  leer(ruta: string): Promise<Buffer>;
}

const VERSION = Buffer.from("CPY1");

function cifrarBuffer(datos: Buffer, clave: Buffer): Buffer {
  const iv = randomBytes(12);
  const cifrador = createCipheriv("aes-256-gcm", clave, iv);
  const cifrado = Buffer.concat([cifrador.update(datos), cifrador.final()]);
  return Buffer.concat([VERSION, iv, cifrador.getAuthTag(), cifrado]);
}

function descifrarBuffer(datos: Buffer, clave: Buffer): Buffer {
  if (!datos.subarray(0, 4).equals(VERSION)) throw new Error("Archivo almacenado con un formato desconocido");
  const iv = datos.subarray(4, 16);
  const etiqueta = datos.subarray(16, 32);
  const descifrador = createDecipheriv("aes-256-gcm", clave, iv);
  descifrador.setAuthTag(etiqueta);
  return Buffer.concat([descifrador.update(datos.subarray(32)), descifrador.final()]);
}

export function almacenamientoLocal(carpeta = config.carpetaArchivos, clave = config.claveCifrado): Almacenamiento {
  return {
    async guardar(contenido, sha256) {
      // Se reparte en subcarpetas por los primeros caracteres de la huella.
      const ruta = join(sha256.slice(0, 2), sha256.slice(2, 4), `${sha256}.bin`);
      const destino = join(carpeta, ruta);
      await mkdir(dirname(destino), { recursive: true });
      await writeFile(destino, cifrarBuffer(contenido, clave));
      return ruta;
    },
    async leer(ruta) {
      return descifrarBuffer(await readFile(join(carpeta, ruta)), clave);
    },
  };
}

export function sha256(contenido: Buffer): string {
  return createHash("sha256").update(contenido).digest("hex");
}
