import { TIPOS_COMPROBANTE } from "@comprobantepy/shared";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { exigirSesion } from "../auth/sesiones.js";
import type { BaseDeDatos } from "../db/conexion.js";
import { obligaciones } from "../db/esquema.js";

export async function rutasCatalogos(app: FastifyInstance, { db }: { db: BaseDeDatos }) {
  app.addHook("preHandler", exigirSesion);
  app.get("/", async () => ({
    tiposComprobante: TIPOS_COMPROBANTE,
    obligaciones: await db.select().from(obligaciones).where(eq(obligaciones.estado, "ACTIVO")),
  }));
}
