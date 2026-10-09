import { and, eq, gt, lt } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import { createHash, randomBytes } from "node:crypto";
import { config } from "../config.js";
import type { BaseDeDatos } from "../db/conexion.js";
import { sesiones, usuarioContribuyentePerfiles, usuarios } from "../db/esquema.js";

export const NOMBRE_COOKIE = "sesion";

export interface PerfilAsignado {
  contribuyenteId: number;
  perfil: "AUXILIAR" | "FINANCIERO" | "CONSULTA";
}

export interface UsuarioSesion {
  id: number;
  email: string;
  nombre: string;
  esAdministrador: boolean;
  totpActivo: boolean;
  perfiles: PerfilAsignado[];
}

declare module "fastify" {
  interface FastifyRequest {
    usuario: UsuarioSesion | null;
    sesionId: string | null;
  }
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function crearSesion(db: BaseDeDatos, usuarioId: number, request: FastifyRequest, reply: FastifyReply) {
  const token = randomBytes(32).toString("base64url");
  const id = hashToken(token);
  const expiraEn = new Date(Date.now() + config.sesionHoras * 3600 * 1000);
  await db.insert(sesiones).values({
    id,
    usuarioId,
    expiraEn,
    ip: request.ip,
    agente: request.headers["user-agent"]?.slice(0, 300) ?? null,
  });
  // Limpieza oportunista de sesiones vencidas del mismo usuario.
  await db.delete(sesiones).where(and(eq(sesiones.usuarioId, usuarioId), lt(sesiones.expiraEn, new Date())));
  reply.setCookie(NOMBRE_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: config.urlPublica.startsWith("https://"),
    expires: expiraEn,
  });
  return id;
}

export async function cerrarSesion(db: BaseDeDatos, request: FastifyRequest, reply: FastifyReply) {
  if (request.sesionId) await db.delete(sesiones).where(eq(sesiones.id, request.sesionId));
  reply.clearCookie(NOMBRE_COOKIE, { path: "/" });
}

export async function cargarUsuario(db: BaseDeDatos, usuarioId: number): Promise<UsuarioSesion | null> {
  const [usuario] = await db.select().from(usuarios).where(eq(usuarios.id, usuarioId));
  if (!usuario || usuario.bloqueado) return null;
  const perfiles = await db
    .select({
      contribuyenteId: usuarioContribuyentePerfiles.contribuyenteId,
      perfil: usuarioContribuyentePerfiles.perfil,
    })
    .from(usuarioContribuyentePerfiles)
    .where(eq(usuarioContribuyentePerfiles.usuarioId, usuarioId));
  return {
    id: usuario.id,
    email: usuario.email,
    nombre: usuario.nombre,
    esAdministrador: usuario.esAdministrador,
    totpActivo: usuario.totpActivo,
    perfiles,
  };
}

/** Hook onRequest: identifica al usuario a partir de la cookie de sesión. */
export function hookSesion(db: BaseDeDatos) {
  return async (request: FastifyRequest) => {
    request.usuario = null;
    request.sesionId = null;
    const token = request.cookies[NOMBRE_COOKIE];
    if (!token) return;
    const id = hashToken(token);
    const [sesion] = await db
      .select()
      .from(sesiones)
      .where(and(eq(sesiones.id, id), gt(sesiones.expiraEn, new Date())));
    if (!sesion) return;
    request.usuario = await cargarUsuario(db, sesion.usuarioId);
    if (request.usuario) request.sesionId = id;
  };
}

/** Segundo factor obligatorio para Financiero y Administrador TI (sección 21.1). */
export function requiereSegundoFactor(usuario: UsuarioSesion): boolean {
  return usuario.esAdministrador || usuario.perfiles.some((p) => p.perfil === "FINANCIERO");
}

export class ErrorHttp extends Error {
  constructor(
    public readonly estado: number,
    public readonly codigo: string,
    mensaje: string,
    public readonly detalles?: unknown,
  ) {
    super(mensaje);
  }
}

/** preHandler: exige sesión iniciada y, si corresponde, segundo factor configurado. */
export async function exigirSesion(request: FastifyRequest) {
  const usuario = request.usuario;
  if (!usuario) throw new ErrorHttp(401, "NO_AUTENTICADO", "Iniciá sesión para continuar");
  if (requiereSegundoFactor(usuario) && !usuario.totpActivo) {
    throw new ErrorHttp(403, "REQUIERE_CONFIGURAR_2FA", "Configurá el segundo factor de autenticación para continuar");
  }
}

export function exigirAdministrador(request: FastifyRequest) {
  if (!request.usuario?.esAdministrador) {
    throw new ErrorHttp(403, "SIN_PERMISO", "Solo el administrador puede realizar esta acción");
  }
}

export function tienePerfil(usuario: UsuarioSesion, contribuyenteId: number, perfiles: PerfilAsignado["perfil"][]) {
  return usuario.perfiles.some((p) => p.contribuyenteId === contribuyenteId && perfiles.includes(p.perfil));
}
