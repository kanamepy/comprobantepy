/**
 * Segunda barrera de aislamiento por contribuyente (secciones 2.5 y 21.4.1): cada conexión
 * que se toma del pool lleva en variables de sesión de PostgreSQL los contribuyentes que
 * puede ver la petición en curso. Las políticas de seguridad por fila (RLS) filtran con eso.
 *
 * Fuera de una petición (trabajador, migraciones, scripts) el contexto es "sistema".
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { sql } from "drizzle-orm";
import type pg from "pg";
import type { Ejecutor } from "./conexion.js";

export interface ContextoDatos {
  /** true: sin restricción (procesos del sistema). */
  sistema: boolean;
  contribuyentes: number[];
}

export const almacenContexto = new AsyncLocalStorage<ContextoDatos>();

export function contextoActual(): ContextoDatos {
  return almacenContexto.getStore() ?? { sistema: true, contribuyentes: [] };
}

async function aplicarContexto(cliente: pg.PoolClient) {
  const contexto = contextoActual();
  await cliente.query("SELECT set_config('app.sistema', $1, false), set_config('app.contribuyentes', $2, false)", [
    contexto.sistema ? "on" : "off",
    contexto.contribuyentes.join(","),
  ]);
}

/** Envuelve el pool para que cada conexión tomada aplique el contexto de la petición en curso. */
export function poolConContexto(pool: pg.Pool) {
  const conectarOriginal = pool.connect.bind(pool) as () => Promise<pg.PoolClient>;
  const conectar = async () => {
    const cliente = await conectarOriginal();
    try {
      await aplicarContexto(cliente);
    } catch (error) {
      cliente.release(error as Error);
      throw error;
    }
    return cliente;
  };
  (pool as unknown as { connect: typeof conectar }).connect = conectar;
  (pool as unknown as { query: (...args: unknown[]) => Promise<unknown> }).query = async (...args: unknown[]) => {
    const cliente = await conectar();
    try {
      return await (cliente.query as (...a: unknown[]) => Promise<unknown>)(...args);
    } finally {
      cliente.release();
    }
  };
  return pool;
}

/** Ejecuta la función como proceso del sistema (sin restricción por contribuyente). */
export function comoSistema<T>(fn: () => PromiseLike<T>): Promise<T> {
  // Se espera dentro del contexto: las consultas de drizzle recién se ejecutan con await.
  return almacenContexto.run({ sistema: true, contribuyentes: [] }, async () => await fn());
}

/**
 * Dentro de una transacción ya abierta, levanta la restricción solo mientras corre `fn`.
 * Se usa para controles que deben ver todos los contribuyentes, como los duplicados
 * (un mismo comprobante no puede registrarse para dos personas, sección 12).
 */
export async function conPrivilegios<T>(db: Ejecutor, fn: () => PromiseLike<T>): Promise<T> {
  if (contextoActual().sistema) return await fn();
  if (!("rollback" in db)) return comoSistema(fn);
  await db.execute(sql`SELECT set_config('app.sistema', 'on', true)`);
  try {
    return await fn();
  } finally {
    await db.execute(sql`SELECT set_config('app.sistema', 'off', true)`);
  }
}
