/**
 * Proceso trabajador: lee periódicamente los buzones conectados (sección 21.5).
 * Se ejecuta aparte de la API: `npm run worker`.
 */
import { almacenamientoLocal } from "./archivos/almacenamiento.js";
import { config } from "./config.js";
import { googleConfigurado } from "./correo/gmail.js";
import { sondearTodos } from "./correo/sondeo.js";
import { crearConexion } from "./db/conexion.js";

const { db, pool } = crearConexion();
const almacenamiento = almacenamientoLocal();
let detenido = false;

async function ciclo() {
  if (!googleConfigurado()) {
    console.log("[correo] Gmail no está configurado (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET): no hay buzones para leer.");
    return;
  }
  try {
    for (const r of await sondearTodos(db, almacenamiento)) {
      console.log(`[correo] buzón ${r.buzonId}: ${r.leidos} leídos, ${r.nuevos} nuevos${r.errores.length ? `, errores: ${r.errores.join(" | ")}` : ""}${r.omitido ? ` (${r.omitido})` : ""}`);
    }
  } catch (error) {
    console.error("[correo] error en el ciclo:", (error as Error).message);
  }
}

async function bucle() {
  console.log(`[correo] trabajador iniciado: revisa los buzones cada ${config.correoIntervaloMinutos} minutos.`);
  while (!detenido) {
    await ciclo();
    await new Promise((resolver) => setTimeout(resolver, config.correoIntervaloMinutos * 60 * 1000));
  }
}

const detener = async () => {
  detenido = true;
  await pool.end();
  process.exit(0);
};
process.on("SIGINT", detener);
process.on("SIGTERM", detener);

void bucle();
