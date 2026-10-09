import type { FastifyRequest } from "fastify";
import type { Ejecutor } from "./db/conexion.js";
import { auditoria } from "./db/esquema.js";

export interface EventoAuditoria {
  entidad: string;
  entidadId?: string | number | null;
  accion: string;
  contribuyenteId?: number | null;
  perfil?: string | null;
  valorAnterior?: unknown;
  valorNuevo?: unknown;
  motivo?: string | null;
  origen?: "WEB" | "SISTEMA" | "CORREO" | "CLI";
}

/** Registra un evento en el log inmutable. Usar dentro de la misma transacción que el cambio. */
export async function registrarAuditoria(db: Ejecutor, evento: EventoAuditoria, request?: FastifyRequest) {
  await db.insert(auditoria).values({
    usuarioId: request?.usuario?.id ?? null,
    sesionId: request?.sesionId ?? null,
    ip: request?.ip ?? null,
    dispositivo: request?.headers["user-agent"]?.slice(0, 300) ?? null,
    correlacion: request?.id ?? null,
    entidad: evento.entidad,
    entidadId: evento.entidadId == null ? null : String(evento.entidadId),
    accion: evento.accion,
    contribuyenteId: evento.contribuyenteId ?? null,
    perfil: evento.perfil ?? null,
    valorAnterior: evento.valorAnterior ?? null,
    valorNuevo: evento.valorNuevo ?? null,
    motivo: evento.motivo ?? null,
    origen: evento.origen ?? "WEB",
  });
}
