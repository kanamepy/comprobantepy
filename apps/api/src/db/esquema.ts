/**
 * Esquema de la base de datos (sección 21.4.1).
 * Todo cambio de estructura se hace aquí y luego `npm run db:generate` crea la migración.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const marcasDeTiempo = {
  creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
  actualizadoEn: timestamp("actualizado_en", { withTimezone: true }).notNull().defaultNow(),
};

export const usuarios = pgTable(
  "usuarios",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    email: text("email").notNull(),
    nombre: text("nombre").notNull(),
    passwordHash: text("password_hash").notNull(),
    /** Perfil Administrador TI (sección 5.1): gestiona usuarios y contribuyentes. */
    esAdministrador: boolean("es_administrador").notNull().default(false),
    /** Secreto TOTP cifrado con CLAVE_CIFRADO. */
    totpSecretoCifrado: text("totp_secreto_cifrado"),
    totpActivo: boolean("totp_activo").notNull().default(false),
    bloqueado: boolean("bloqueado").notNull().default(false),
    ...marcasDeTiempo,
  },
  (t) => [uniqueIndex("usuarios_email_unico").on(sql`lower(${t.email})`)],
);

export const sesiones = pgTable(
  "sesiones",
  {
    /** SHA-256 del token de la cookie; el token en sí nunca se guarda. */
    id: text("id").primaryKey(),
    usuarioId: integer("usuario_id")
      .notNull()
      .references(() => usuarios.id),
    creadaEn: timestamp("creada_en", { withTimezone: true }).notNull().defaultNow(),
    expiraEn: timestamp("expira_en", { withTimezone: true }).notNull(),
    ip: text("ip"),
    agente: text("agente"),
  },
  (t) => [index("sesiones_usuario_idx").on(t.usuarioId)],
);

/** Contribuyentes administrados (secciones 2.2 y 2.6). */
export const contribuyentes = pgTable(
  "contribuyentes",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    nombre: text("nombre").notNull(),
    tipoIdentificacion: text("tipo_identificacion", { enum: ["RUC", "CI"] }).notNull(),
    numeroIdentificacion: text("numero_identificacion").notNull(),
    dv: smallint("dv"),
    relacion: text("relacion"),
    obligacionRegistro: text("obligacion_registro", { enum: ["955", "956"] }),
    correoContacto: text("correo_contacto"),
    estado: text("estado", { enum: ["ACTIVO", "BAJA"] })
      .notNull()
      .default("ACTIVO"),
    autorizacionFecha: date("autorizacion_fecha").notNull(),
    autorizacionForma: text("autorizacion_forma").notNull(),
    autorizacionAlcance: text("autorizacion_alcance").notNull(),
    bajaMotivo: text("baja_motivo"),
    bajaEn: timestamp("baja_en", { withTimezone: true }),
    bajaPor: integer("baja_por").references(() => usuarios.id),
    creadoPor: integer("creado_por")
      .notNull()
      .references(() => usuarios.id),
    ...marcasDeTiempo,
  },
  (t) => [
    uniqueIndex("contribuyentes_identificacion_unica").on(t.tipoIdentificacion, t.numeroIdentificacion),
    check("contribuyentes_dv_ruc", sql`(${t.tipoIdentificacion} = 'CI') OR (${t.dv} IS NOT NULL)`),
  ],
);

/** Perfiles de cada usuario por contribuyente (sección 5). */
export const usuarioContribuyentePerfiles = pgTable(
  "usuario_contribuyente_perfiles",
  {
    usuarioId: integer("usuario_id")
      .notNull()
      .references(() => usuarios.id),
    contribuyenteId: integer("contribuyente_id")
      .notNull()
      .references(() => contribuyentes.id),
    perfil: text("perfil", { enum: ["AUXILIAR", "FINANCIERO", "CONSULTA"] }).notNull(),
    creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.usuarioId, t.contribuyenteId, t.perfil] })],
);

/**
 * Log de auditoría inmutable (sección 17). Una migración agrega un trigger que
 * impide UPDATE y DELETE sobre esta tabla para cualquier usuario de la base.
 */
export const auditoria = pgTable(
  "auditoria",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    ocurridoEn: timestamp("ocurrido_en", { withTimezone: true }).notNull().defaultNow(),
    usuarioId: integer("usuario_id").references(() => usuarios.id),
    perfil: text("perfil"),
    contribuyenteId: integer("contribuyente_id").references(() => contribuyentes.id),
    sesionId: text("sesion_id"),
    ip: text("ip"),
    dispositivo: text("dispositivo"),
    entidad: text("entidad").notNull(),
    entidadId: text("entidad_id"),
    accion: text("accion").notNull(),
    valorAnterior: jsonb("valor_anterior"),
    valorNuevo: jsonb("valor_nuevo"),
    motivo: text("motivo"),
    origen: text("origen").notNull().default("WEB"),
    correlacion: text("correlacion"),
  },
  (t) => [
    index("auditoria_entidad_idx").on(t.entidad, t.entidadId),
    index("auditoria_contribuyente_idx").on(t.contribuyenteId),
  ],
);
