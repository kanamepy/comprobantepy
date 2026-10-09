import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import helmet from "@fastify/helmet";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { existsSync } from "node:fs";
import { almacenamientoLocal, type Almacenamiento } from "./archivos/almacenamiento.js";
import { ErrorHttp, hookSesion } from "./auth/sesiones.js";
import { config } from "./config.js";
import { almacenContexto } from "./db/contexto.js";
import type { BaseDeDatos } from "./db/conexion.js";
import { rutasArchivos } from "./rutas/archivos.js";
import { rutasAuth } from "./rutas/auth.js";
import { rutasCatalogos } from "./rutas/catalogos.js";
import { rutasComprobantes } from "./rutas/comprobantes.js";
import { rutasContribuyentes } from "./rutas/contribuyentes.js";
import { rutasCorreo } from "./rutas/correo.js";
import type { FabricaAdaptador } from "./correo/sondeo.js";
import { rutasIrp } from "./rutas/irp.js";
import { rutasLotes } from "./rutas/lotes.js";
import { rutasProveedores } from "./rutas/proveedores.js";
import { rutasReportes } from "./rutas/reportes.js";
import { rutasUsuarios } from "./rutas/usuarios.js";

export interface OpcionesApp {
  db: BaseDeDatos;
  logger?: boolean;
  servirWeb?: boolean;
  almacenamiento?: Almacenamiento;
  fabricaAdaptadorCorreo?: FabricaAdaptador;
}

export async function construirApp({
  db,
  logger = true,
  servirWeb = config.esProduccion,
  almacenamiento = almacenamientoLocal(),
  fabricaAdaptadorCorreo,
}: OpcionesApp) {
  const app = Fastify({
    logger: logger ? { level: config.esProduccion ? "info" : "debug", redact: ["req.headers.cookie"] } : false,
    trustProxy: true,
  });

  // Cabeceras de seguridad (sección 21.4). Con HTTP en la red de la casa no se fuerza HTTPS.
  const conHttps = config.urlPublica.startsWith("https://");
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:"],
        frameSrc: ["'self'", "blob:"],
        objectSrc: ["'self'"],
        workerSrc: ["'self'"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", "data:"],
        frameAncestors: ["'self'"],
        formAction: ["'self'"],
        baseUri: ["'self'"],
        upgradeInsecureRequests: conHttps ? [] : null,
      },
    },
    hsts: conHttps ? { maxAge: 31536000 } : false,
    crossOriginResourcePolicy: { policy: "same-origin" },
    referrerPolicy: { policy: "same-origin" },
  });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  await app.register(multipart, {
    limits: { fileSize: config.tamanoMaximoArchivoMb * 1024 * 1024, files: 50, fields: 20 },
    throwFileSizeLimit: true,
  });
  app.decorateRequest("usuario", null);
  app.decorateRequest("sesionId", null);
  // Cada petición corre en su propio contexto de datos: la base filtra por contribuyente (RLS).
  app.addHook("onRequest", (_request, _reply, listo) => {
    almacenContexto.run({ sistema: false, contribuyentes: [] }, listo);
  });
  app.addHook("onRequest", hookSesion(db));
  app.addHook("onRequest", async (request) => {
    const contexto = almacenContexto.getStore();
    if (contexto && request.usuario) contexto.contribuyentes = [...new Set(request.usuario.perfiles.map((p) => p.contribuyenteId))];
  });

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
  await app.register(rutasComprobantes, { prefix: "/api/comprobantes", db, almacenamiento });
  await app.register(rutasArchivos, { prefix: "/api/archivos", db, almacenamiento });
  await app.register(rutasProveedores, { prefix: "/api/proveedores", db });
  await app.register(rutasCatalogos, { prefix: "/api/catalogos", db });
  await app.register(rutasLotes, { prefix: "/api/lotes", db, almacenamiento });
  await app.register(rutasReportes, { prefix: "/api/reportes", db });
  await app.register(rutasIrp, { prefix: "/api/irp", db });
  await app.register(rutasUsuarios, { prefix: "/api/usuarios", db });
  await app.register(rutasCorreo, { prefix: "/api/correo", db, almacenamiento, fabricaAdaptador: fabricaAdaptadorCorreo });

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
