import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { config } from "../config.js";
import * as esquema from "./esquema.js";

export function crearConexion(url = config.databaseUrl) {
  const pool = new pg.Pool({ connectionString: url });
  const db = drizzle(pool, { schema: esquema });
  return { pool, db };
}

export type BaseDeDatos = ReturnType<typeof crearConexion>["db"];
export type Transaccion = Parameters<Parameters<BaseDeDatos["transaction"]>[0]>[0];
export type Ejecutor = BaseDeDatos | Transaccion;
