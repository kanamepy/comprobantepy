import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { existsSync } from "node:fs";
import { ErrorHttp, hookSesion } from "./auth/sesiones.js";
import { config } from "./config.js";
import type { BaseDeDatos } from "./db/conexion.js";
import { rutasAuth } from "./rutas/auth.js";
import { rutasContribuyentes } from "./rutas/contribuyentes.js";

export interface OpcionesApp {
  db: BaseDeDatos;
  logger?: boolean;
  servirWeb?: boolean;
}

export async function construirApp({ db, logger = true, servirWeb = config.esProduccion }: OpcionesApp) {
  const app = Fastify({
    logger: logger ? { level: config.esProduccion ? "info" : "debug", redact: ["req.headers.cookie"] } : false,
    trustProxy: true,
  });

  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  app.decorateRequest("usuario", null);
  app.decorateRequest("sesionId", null);
  app.addHook("onRequest", hookSesion(db));

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ErrorHttp) {
      return reply.code(error.estado).send({ error: error.message, codigo: error.codigo, detalles: error.detalles });
    }
    const estado = (error as { statusCode?: number }).statusCode;
    if (estado && estado < 500) {
      return reply.code(estado).send({ error: (error as Error).message, codigo: "PETICION_INVALIDA" });
    }
    request.log.error(error);
    return reply.code(500).send({ error: "Error interno del servidor", codigo: "ERROR_INTERNO" });
  });

  app.get("/api/salud", async () => ({ ok: true }));
  await app.register(rutasAuth, { prefix: "/api/auth", db });
  await app.register(rutasContribuyentes, { prefix: "/api/contribuyentes", db });

  if (servirWeb && existsSync(config.carpetaWeb)) {
    await app.register(fastifyStatic, { root: config.carpetaWeb });
    // Aplicación de una sola página: las rutas que no son de la API devuelven index.html.
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) {
        return reply.code(404).send({ error: "Ruta inexistente", codigo: "NO_ENCONTRADO" });
      }
      return reply.sendFile("index.html");
    });
  }

  return app;
}
