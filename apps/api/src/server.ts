import { construirApp } from "./app.js";
import { config } from "./config.js";
import { crearConexion } from "./db/conexion.js";

const { db, pool } = crearConexion();
const app = await construirApp({ db });

const cerrar = async () => {
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on("SIGINT", cerrar);
process.on("SIGTERM", cerrar);

await app.listen({ port: config.puerto, host: config.host });
