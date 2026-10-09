import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { config } from "../config.js";
import { poolConContexto } from "./contexto.js";
import * as esquema from "./esquema.js";

export function crearConexion(url = config.databaseUrl) {
  const pool = poolConContexto(new pg.Pool({ connectionString: url }));
  // Si PostgreSQL se reinicia, la conexión inactiva falla: se registra y el pool se reconecta
  // solo en la próxima consulta, en lugar de detener la aplicación.
  pool.on("error", (error) => console.error("[db] conexión perdida con PostgreSQL:", error.message));
  const db = drizzle(pool, { schema: esquema });
  return { pool, db };
}

export type BaseDeDatos = ReturnType<typeof crearConexion>["db"];
export type Transaccion = Parameters<Parameters<BaseDeDatos["transaction"]>[0]>[0];
export type Ejecutor = BaseDeDatos | Transaccion;
