import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath, pathToFileURL } from "node:url";
import { crearConexion } from "./conexion.js";

export async function migrar(url?: string) {
  const { db, pool } = crearConexion(url);
  try {
    await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../migraciones", import.meta.url)) });
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  migrar()
    .then(() => console.log("Migraciones aplicadas."))
    .catch((error) => {
      console.error("Error al aplicar migraciones:", error);
      process.exit(1);
    });
}
