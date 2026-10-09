/**
 * Proceso trabajador (sección 21.5): lee las imágenes y PDF escaneados de la cola y
 * revisa periódicamente los buzones de correo. Se ejecuta aparte de la API.
 */
import { almacenamientoLocal } from "./archivos/almacenamiento.js";
import { cerrarOcr } from "./archivos/ocr.js";
import { config } from "./config.js";
import { googleConfigurado } from "./correo/gmail.js";
import { sondearTodos } from "./correo/sondeo.js";
import { crearConexion } from "./db/conexion.js";
import { crearRespaldo, listarRespaldos, podarRespaldos } from "./respaldo/respaldo.js";
import { procesarSiguienteTrabajo } from "./servicios/trabajos.js";

const { db, pool } = crearConexion();
const almacenamiento = almacenamientoLocal();
let detenido = false;
const esperar = (ms: number) => new Promise((resolver) => setTimeout(resolver, ms));

/** Cola de lectura: se revisa cada 2 segundos. */
async function bucleLectura() {
  while (!detenido) {
    try {
      const hubo = await procesarSiguienteTrabajo(db, almacenamiento);
      if (!hubo) await esperar(2000);
    } catch (error) {
      console.error("[lectura] error:", (error as Error).message);
      await esperar(5000);
    }
  }
}

async function bucleCorreo() {
  if (!googleConfigurado()) {
    console.log("[correo] Gmail no está configurado (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET): no se leen buzones.");
    return;
  }
  console.log(`[correo] se revisan los buzones cada ${config.correoIntervaloMinutos} minutos.`);
  while (!detenido) {
    try {
      for (const r of await sondearTodos(db, almacenamiento)) {
        console.log(`[correo] buzón ${r.buzonId}: ${r.leidos} leídos, ${r.nuevos} nuevos${r.errores.length ? `, errores: ${r.errores.join(" | ")}` : ""}${r.omitido ? ` (${r.omitido})` : ""}`);
      }
    } catch (error) {
      console.error("[correo] error en el ciclo:", (error as Error).message);
    }
    await esperar(config.correoIntervaloMinutos * 60 * 1000);
  }
}

/** Respaldo diario a la hora indicada en RESPALDO_DIARIO_HORA (sección 21.6). */
async function bucleRespaldo() {
  const hora = config.respaldoDiarioHora;
  if (hora === null) return;
  console.log(`[respaldo] respaldo diario a las ${hora}:00, se conservan ${config.respaldosConservar}.`);
  while (!detenido) {
    const ahora = new Date();
    const hoy = `respaldo-${ahora.getFullYear()}${String(ahora.getMonth() + 1).padStart(2, "0")}${String(ahora.getDate()).padStart(2, "0")}`;
    const [ultimo] = await listarRespaldos(config.carpetaRespaldos);
    if (ahora.getHours() >= hora && !ultimo?.includes(hoy)) {
      try {
        const { carpeta, manifiesto } = await crearRespaldo({
          databaseUrl: config.databaseUrl,
          carpetaArchivos: config.carpetaArchivos,
          carpetaRespaldos: config.carpetaRespaldos,
        });
        console.log(`[respaldo] listo: ${carpeta} (${manifiesto.cantidadArchivos} archivos)`);
        await podarRespaldos(config.carpetaRespaldos, config.respaldosConservar);
      } catch (error) {
        console.error("[respaldo] error:", (error as Error).message);
      }
    }
    await esperar(10 * 60 * 1000);
  }
}

const detener = async () => {
  detenido = true;
  await cerrarOcr();
  await pool.end();
  process.exit(0);
};
process.on("SIGINT", detener);
process.on("SIGTERM", detener);

console.log("[trabajador] iniciado.");
void bucleLectura();
void bucleCorreo();
void bucleRespaldo();
