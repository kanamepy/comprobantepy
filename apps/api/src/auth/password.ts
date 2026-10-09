/** Hash de contraseñas con scrypt (incluido en Node.js, sin dependencias nativas). */
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

const PARAMETROS: ScryptOptions = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const LONGITUD = 64;

function derivar(password: string, sal: Buffer, opciones: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFKC"), sal, LONGITUD, opciones, (error, clave) =>
      error ? reject(error) : resolve(clave),
    );
  });
}

export const LONGITUD_MINIMA_PASSWORD = 10;

export async function hashPassword(password: string): Promise<string> {
  const sal = randomBytes(16);
  const clave = await derivar(password, sal, PARAMETROS);
  return ["scrypt", PARAMETROS.N, PARAMETROS.r, PARAMETROS.p, sal.toString("base64"), clave.toString("base64")].join("$");
}

export async function verificarPassword(password: string, hash: string): Promise<boolean> {
  const [algoritmo, n, r, p, sal, clave] = hash.split("$");
  if (algoritmo !== "scrypt" || !n || !r || !p || !sal || !clave) return false;
  const esperado = Buffer.from(clave, "base64");
  const calculado = await derivar(password, Buffer.from(sal, "base64"), {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: PARAMETROS.maxmem,
  });
  return calculado.length === esperado.length && timingSafeEqual(calculado, esperado);
}

/** Hash fijo para comparar cuando el usuario no existe y no revelar ese dato por el tiempo de respuesta. */
export const HASH_FICTICIO = await hashPassword(randomBytes(16).toString("hex"));
