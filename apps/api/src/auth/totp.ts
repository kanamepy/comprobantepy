/** Segundo factor TOTP (RFC 6238), compatible con Google Authenticator, Authy, etc. */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const ALFABETO_BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Codificar(datos: Buffer): string {
  let bits = 0;
  let valor = 0;
  let salida = "";
  for (const byte of datos) {
    valor = (valor << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      salida += ALFABETO_BASE32[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) salida += ALFABETO_BASE32[(valor << (5 - bits)) & 31];
  return salida;
}

export function base32Decodificar(texto: string): Buffer {
  const limpio = texto.replace(/[\s=]/g, "").toUpperCase();
  let bits = 0;
  let valor = 0;
  const bytes: number[] = [];
  for (const caracter of limpio) {
    const indice = ALFABETO_BASE32.indexOf(caracter);
    if (indice === -1) throw new Error("Secreto base32 inválido");
    valor = (valor << 5) | indice;
    bits += 5;
    if (bits >= 8) {
      bytes.push((valor >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generarSecretoTotp(): string {
  return base32Codificar(randomBytes(20));
}

export function codigoHotp(secreto: Buffer, contador: number, digitos = 6): string {
  const mensaje = Buffer.alloc(8);
  mensaje.writeBigUInt64BE(BigInt(contador));
  const hmac = createHmac("sha1", secreto).update(mensaje).digest();
  const desplazamiento = hmac[hmac.length - 1]! & 0x0f;
  const binario = hmac.readUInt32BE(desplazamiento) & 0x7fffffff;
  return String(binario % 10 ** digitos).padStart(digitos, "0");
}

export function codigoTotp(secretoBase32: string, ahoraMs = Date.now(), digitos = 6, paso = 30): string {
  return codigoHotp(base32Decodificar(secretoBase32), Math.floor(ahoraMs / 1000 / paso), digitos);
}

/** Verifica un código admitiendo un paso de desfase hacia atrás o adelante. */
export function verificarTotp(secretoBase32: string, codigo: string, ahoraMs = Date.now()): boolean {
  if (!/^\d{6}$/.test(codigo)) return false;
  const secreto = base32Decodificar(secretoBase32);
  const contador = Math.floor(ahoraMs / 1000 / 30);
  for (const desfase of [-1, 0, 1]) {
    const esperado = Buffer.from(codigoHotp(secreto, contador + desfase));
    if (timingSafeEqual(esperado, Buffer.from(codigo))) return true;
  }
  return false;
}

export function uriOtpauth(secretoBase32: string, cuenta: string, emisor = "ComprobantePy"): string {
  const etiqueta = encodeURIComponent(`${emisor}:${cuenta}`);
  return `otpauth://totp/${etiqueta}?secret=${secretoBase32}&issuer=${encodeURIComponent(emisor)}&algorithm=SHA1&digits=6&period=30`;
}
