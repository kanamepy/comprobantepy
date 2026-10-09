/** Cifrado de datos sensibles antes de guardarlos (sección 21.4.1): AES-256-GCM. */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { config } from "./config.js";

export function cifrar(texto: string, clave: Buffer = config.claveCifrado): string {
  const iv = randomBytes(12);
  const cifrador = createCipheriv("aes-256-gcm", clave, iv);
  const datos = Buffer.concat([cifrador.update(texto, "utf8"), cifrador.final()]);
  return ["v1", iv.toString("base64"), cifrador.getAuthTag().toString("base64"), datos.toString("base64")].join(":");
}

export function descifrar(valor: string, clave: Buffer = config.claveCifrado): string {
  const [version, iv, etiqueta, datos] = valor.split(":");
  if (version !== "v1" || !iv || !etiqueta || !datos) throw new Error("Formato de dato cifrado no reconocido");
  const descifrador = createDecipheriv("aes-256-gcm", clave, Buffer.from(iv, "base64"));
  descifrador.setAuthTag(Buffer.from(etiqueta, "base64"));
  return Buffer.concat([descifrador.update(Buffer.from(datos, "base64")), descifrador.final()]).toString("utf8");
}
