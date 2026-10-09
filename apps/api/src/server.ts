import { construirApp } from "./app.js";
import { config } from "./config.js";
import { crearConexion } from "./db/conexion.js";

const { db, pool } = crearConexion();
const app = await construirApp({ db });

// La segunda barrera (RLS) no aplica a superusuarios ni a roles con BYPASSRLS.
const { rows } = await pool.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
  "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user",
);
if (rows[0]?.rolsuper || rows[0]?.rolbypassrls) {
  app.log.warn(
    "La aplicación se conecta a PostgreSQL con un usuario administrador: la segunda barrera de aislamiento por contribuyente (RLS) no está activa. Usá un usuario sin privilegios de superusuario (ver README).",
  );
}

const cerrar = async () => {
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on("SIGINT", cerrar);
process.on("SIGTERM", cerrar);

await app.listen({ port: config.puerto, host: config.host });
