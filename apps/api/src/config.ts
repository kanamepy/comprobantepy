import { config as cargarEnv } from "dotenv";
import { fileURLToPath } from "node:url";

// El archivo .env vive en la raíz del repositorio.
cargarEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });

const entorno = process.env.NODE_ENV ?? "development";

function requerida(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor) {
    throw new Error(`Falta la variable de entorno ${nombre}. Revisá el archivo .env (ver .env.example).`);
  }
  return valor;
}

function claveCifrado(): Buffer {
  const valor = process.env.CLAVE_CIFRADO;
  if (!valor) {
    if (entorno === "production") requerida("CLAVE_CIFRADO");
    console.warn("[config] CLAVE_CIFRADO no definida: se usa una clave fija SOLO PARA DESARROLLO.");
    return Buffer.alloc(32, 7);
  }
  const clave = Buffer.from(valor, "base64");
  if (clave.length !== 32) throw new Error("CLAVE_CIFRADO debe ser de 32 bytes codificados en base64");
  return clave;
}

export const config = {
  entorno,
  esProduccion: entorno === "production",
  puerto: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? "0.0.0.0",
  databaseUrl: requerida("DATABASE_URL"),
  sesionHoras: Number(process.env.SESION_HORAS ?? 12),
  claveCifrado: claveCifrado(),
  /** Carpeta donde se guardan los archivos originales, cifrados. */
  carpetaArchivos: process.env.CARPETA_ARCHIVOS ?? fileURLToPath(new URL("../../../datos/archivos", import.meta.url)),
  tamanoMaximoArchivoMb: Number(process.env.TAMANO_MAXIMO_ARCHIVO_MB ?? 20),
  /** Carpeta con el frontend compilado; en producción la API lo sirve. */
  carpetaWeb: fileURLToPath(new URL("../../web/dist", import.meta.url)),
};
