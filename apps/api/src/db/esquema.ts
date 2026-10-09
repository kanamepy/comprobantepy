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
  numeric,
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

/** Catálogo de obligaciones tributarias, compartido y versionado (sección 14.1). */
export const obligaciones = pgTable("obligaciones", {
  codigo: text("codigo").primaryKey(),
  descripcion: text("descripcion").notNull(),
  /** Indicador S/N del archivo Marangatu al que se traduce (sección 14.4). */
  indicadorMarangatu: text("indicador_marangatu", { enum: ["IVA", "IRE", "IRP_RSP"] }),
  version: integer("version").notNull().default(1),
  estado: text("estado", { enum: ["ACTIVO", "INACTIVO"] })
    .notNull()
    .default("ACTIVO"),
});

/** Obligaciones activas de cada contribuyente, con vigencia (sección 2.2). */
export const contribuyenteObligaciones = pgTable(
  "contribuyente_obligaciones",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    contribuyenteId: integer("contribuyente_id")
      .notNull()
      .references(() => contribuyentes.id),
    obligacionCodigo: text("obligacion_codigo")
      .notNull()
      .references(() => obligaciones.codigo),
    vigenteDesde: date("vigente_desde").notNull(),
    vigenteHasta: date("vigente_hasta"),
    estado: text("estado", { enum: ["ACTIVO", "ANULADO"] })
      .notNull()
      .default("ACTIVO"),
    anuladoMotivo: text("anulado_motivo"),
    ...marcasDeTiempo,
  },
  (t) => [index("contribuyente_obligaciones_contribuyente_idx").on(t.contribuyenteId)],
);

/** Actividades económicas de cada contribuyente. */
export const actividades = pgTable(
  "actividades",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    contribuyenteId: integer("contribuyente_id")
      .notNull()
      .references(() => contribuyentes.id),
    descripcion: text("descripcion").notNull(),
    estado: text("estado", { enum: ["ACTIVO", "INACTIVO"] })
      .notNull()
      .default("ACTIVO"),
    ...marcasDeTiempo,
  },
  (t) => [index("actividades_contribuyente_idx").on(t.contribuyenteId)],
);

/** Maestro de proveedores, compartido entre contribuyentes (secciones 2.5 y 11). */
export const proveedores = pgTable(
  "proveedores",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    /** Código de tipo de identificación del archivo Marangatu: 11 RUC, 12 cédula, 17 exterior… */
    tipoIdentificacion: smallint("tipo_identificacion").notNull(),
    numeroIdentificacion: text("numero_identificacion").notNull(),
    dv: smallint("dv"),
    razonSocial: text("razon_social").notNull(),
    nombreFantasia: text("nombre_fantasia"),
    estado: text("estado", { enum: ["PENDIENTE_DE_CONFIRMAR", "CONFIRMADO", "OBSERVADO", "RECHAZADO"] })
      .notNull()
      .default("PENDIENTE_DE_CONFIRMAR"),
    emisorElectronico: boolean("emisor_electronico").notNull().default(false),
    emisorVirtual: boolean("emisor_virtual").notNull().default(false),
    fuente: text("fuente").notNull(),
    observacion: text("observacion"),
    confirmadoPor: integer("confirmado_por").references(() => usuarios.id),
    confirmadoEn: timestamp("confirmado_en", { withTimezone: true }),
    ...marcasDeTiempo,
  },
  (t) => [uniqueIndex("proveedores_identificacion_unica").on(t.tipoIdentificacion, t.numeroIdentificacion)],
);

/** Archivos originales (evidencias). El contenido vive cifrado en el almacenamiento; aquí solo la referencia. */
export const archivos = pgTable(
  "archivos",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    sha256: text("sha256").notNull(),
    nombreOriginal: text("nombre_original").notNull(),
    tipoMime: text("tipo_mime").notNull(),
    tipoDetectado: text("tipo_detectado", { enum: ["PDF", "XML", "IMAGEN"] }).notNull(),
    tamano: integer("tamano").notNull(),
    ruta: text("ruta").notNull(),
    canal: text("canal", { enum: ["CARGA", "CAMARA", "CORREO", "EVIDENCIA"] }).notNull(),
    subidoPor: integer("subido_por").references(() => usuarios.id),
    creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("archivos_sha256_unico").on(t.sha256)],
);

/** Timbrados por proveedor, con la verificación manual documentada y reutilizable (sección 11.4). */
export const timbrados = pgTable(
  "timbrados",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    proveedorId: integer("proveedor_id")
      .notNull()
      .references(() => proveedores.id),
    numero: integer("numero").notNull(),
    vigenciaDesde: date("vigencia_desde"),
    vigenciaHasta: date("vigencia_hasta"),
    estadoVerificacion: text("estado_verificacion", { enum: ["NO_VERIFICADO", "VALIDO", "RECHAZADO", "ERROR_DE_CONSULTA"] })
      .notNull()
      .default("NO_VERIFICADO"),
    consultaEn: timestamp("consulta_en", { withTimezone: true }),
    verificadoPor: integer("verificado_por").references(() => usuarios.id),
    evidenciaArchivoId: integer("evidencia_archivo_id").references(() => archivos.id),
    observacion: text("observacion"),
    ...marcasDeTiempo,
  },
  (t) => [uniqueIndex("timbrados_proveedor_numero_unico").on(t.proveedorId, t.numero)],
);

const importe = (nombre: string) => numeric(nombre, { precision: 20, scale: 2 });

/** Registro único por comprobante, con sus tres dimensiones de estado (sección 15). */
export const comprobantes = pgTable(
  "comprobantes",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    contribuyenteId: integer("contribuyente_id").references(() => contribuyentes.id),
    /** true cuando el documento no identifica al receptor y el usuario eligió el contribuyente (sección 2.3). */
    asignacionManual: boolean("asignacion_manual").notNull().default(false),
    proveedorId: integer("proveedor_id").references(() => proveedores.id),
    timbradoId: integer("timbrado_id").references(() => timbrados.id),
    canal: text("canal", { enum: ["CARGA", "CAMARA", "CORREO", "MANUAL"] }).notNull(),
    naturaleza: text("naturaleza", { enum: ["FISICO", "ELECTRONICO", "VIRTUAL", "NO_DETERMINADA"] }).notNull(),
    naturalezaMotivo: text("naturaleza_motivo"),
    tipoComprobante: smallint("tipo_comprobante"),
    cdc: text("cdc"),
    timbrado: integer("timbrado"),
    numero: text("numero"),
    fechaEmision: date("fecha_emision"),
    moneda: text("moneda").notNull().default("PYG"),
    tipoCambio: numeric("tipo_cambio", { precision: 14, scale: 4 }),
    condicion: smallint("condicion"),
    receptorTipoIdentificacion: text("receptor_tipo_identificacion", { enum: ["RUC", "CI", "OTRO"] }),
    receptorNumero: text("receptor_numero"),
    receptorDv: smallint("receptor_dv"),
    receptorNombre: text("receptor_nombre"),
    gravado10: importe("gravado10"),
    gravado5: importe("gravado5"),
    exento: importe("exento"),
    iva10: importe("iva10"),
    iva5: importe("iva5"),
    total: importe("total"),
    asociadoNumero: text("asociado_numero"),
    asociadoTimbrado: integer("asociado_timbrado"),
    asociadoCdc: text("asociado_cdc"),
    /** Número de cuenta o tarjeta cifrado (sección 18.5); en pantalla solo se muestra la máscara. */
    numeroCuentaCifrado: text("numero_cuenta_cifrado"),
    numeroCuentaMascara: text("numero_cuenta_mascara"),
    entidadFinanciera: text("entidad_financiera"),
    numeroPatronalIps: text("numero_patronal_ips"),
    especificarTipoDocumento: text("especificar_tipo_documento"),
    /** Estado dentro de los lotes de exportación (sección 15.3); null si nunca se incluyó. */
    estadoMarangatu: text("estado_marangatu", { enum: ["INCLUIDO_EN_LOTE", "ENVIADO", "ACEPTADO_DNIT", "RECHAZADO_DNIT"] }),
    porcentajeNoImputado: numeric("porcentaje_no_imputado", { precision: 5, scale: 2 }).notNull().default("0"),
    estadoTecnico: text("estado_tecnico").notNull(),
    estadoFlujo: text("estado_flujo").notNull(),
    motivoEstado: text("motivo_estado"),
    /** Última evaluación (sección 10): datos faltantes, errores y advertencias. */
    problemas: jsonb("problemas").notNull().default([]),
    /** Valor detectado, fuente, confianza y correcciones por campo (sección 9). */
    camposOrigen: jsonb("campos_origen").notNull().default({}),
    advertenciasExtraccion: jsonb("advertencias_extraccion").notNull().default([]),
    /** Comprobantes revisados y descartados como duplicados de este. */
    duplicadosDescartados: jsonb("duplicados_descartados").notNull().default([]),
    observaciones: text("observaciones"),
    version: integer("version").notNull().default(1),
    versionAnteriorId: integer("version_anterior_id"),
    anuladoMotivo: text("anulado_motivo"),
    anuladoEn: timestamp("anulado_en", { withTimezone: true }),
    anuladoPor: integer("anulado_por").references(() => usuarios.id),
    creadoPor: integer("creado_por").references(() => usuarios.id),
    ...marcasDeTiempo,
  },
  (t) => [
    // Duplicados exactos (sección 12): los anulados siguen participando del control.
    uniqueIndex("comprobantes_cdc_unico").on(t.cdc).where(sql`${t.cdc} IS NOT NULL`),
    uniqueIndex("comprobantes_clave_negocio_unica")
      .on(t.proveedorId, t.tipoComprobante, t.timbrado, t.numero)
      .where(sql`${t.proveedorId} IS NOT NULL AND ${t.tipoComprobante} IS NOT NULL AND ${t.timbrado} IS NOT NULL AND ${t.numero} IS NOT NULL`),
    index("comprobantes_contribuyente_idx").on(t.contribuyenteId),
    index("comprobantes_estado_flujo_idx").on(t.estadoFlujo),
    index("comprobantes_proveedor_fecha_idx").on(t.proveedorId, t.fechaEmision),
  ],
);

export const comprobanteArchivos = pgTable(
  "comprobante_archivos",
  {
    comprobanteId: integer("comprobante_id")
      .notNull()
      .references(() => comprobantes.id),
    archivoId: integer("archivo_id")
      .notNull()
      .references(() => archivos.id),
    creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.comprobanteId, t.archivoId] })],
);

/** Imputación múltiple (sección 14): un comprobante, varias obligaciones y actividades. */
export const imputaciones = pgTable(
  "imputaciones",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    comprobanteId: integer("comprobante_id")
      .notNull()
      .references(() => comprobantes.id),
    obligacionCodigo: text("obligacion_codigo")
      .notNull()
      .references(() => obligaciones.codigo),
    actividadId: integer("actividad_id").references(() => actividades.id),
    porcentaje: numeric("porcentaje", { precision: 5, scale: 2 }).notNull(),
  },
  (t) => [index("imputaciones_comprobante_idx").on(t.comprobanteId)],
);

/** Lote de exportación a Marangatu: un contribuyente, un período (sección 18.6). */
export const lotes = pgTable(
  "lotes",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    contribuyenteId: integer("contribuyente_id")
      .notNull()
      .references(() => contribuyentes.id),
    obligacion: text("obligacion", { enum: ["955", "956"] }).notNull(),
    anio: smallint("anio").notNull(),
    /** Solo para el registro mensual (955). */
    mes: smallint("mes"),
    formato: text("formato", { enum: ["TXT", "CSV"] }).notNull(),
    estado: text("estado", { enum: ["GENERADO", "ENVIADO", "CERRADO", "ANULADO"] })
      .notNull()
      .default("GENERADO"),
    versionMatriz: text("version_matriz").notNull(),
    versionMapeo: text("version_mapeo").notNull(),
    conciliacion: jsonb("conciliacion").notNull(),
    /** Comprobantes elegibles del período que no se incluyeron, con su motivo. */
    excluidos: jsonb("excluidos").notNull().default([]),
    generadoPor: integer("generado_por")
      .notNull()
      .references(() => usuarios.id),
    generadoEn: timestamp("generado_en", { withTimezone: true }).notNull().defaultNow(),
    enviadoEn: date("enviado_en"),
    enviadoPor: integer("enviado_por").references(() => usuarios.id),
    cerradoEn: timestamp("cerrado_en", { withTimezone: true }),
    anuladoMotivo: text("anulado_motivo"),
    /** Motivo del reproceso cuando incluye comprobantes ya exportados antes (sección 18.1). */
    motivoReproceso: text("motivo_reproceso"),
  },
  (t) => [index("lotes_contribuyente_idx").on(t.contribuyenteId)],
);

/** Archivos ZIP generados. Nunca se regeneran: una corrección produce un lote nuevo. */
export const loteArchivos = pgTable(
  "lote_archivos",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    loteId: integer("lote_id")
      .notNull()
      .references(() => lotes.id),
    contribuyenteId: integer("contribuyente_id")
      .notNull()
      .references(() => contribuyentes.id),
    anio: smallint("anio").notNull(),
    mes: smallint("mes"),
    identificador: text("identificador").notNull(),
    nombreBase: text("nombre_base").notNull(),
    nombreArchivo: text("nombre_archivo").notNull(),
    nombreZip: text("nombre_zip").notNull(),
    sha256Zip: text("sha256_zip").notNull(),
    tamano: integer("tamano").notNull(),
    filas: integer("filas").notNull(),
    ruta: text("ruta").notNull(),
  },
  (t) => [
    // El identificador XXXXX no se reutiliza para el mismo informante y período (sección 18.3).
    uniqueIndex("lote_archivos_identificador_unico").on(t.contribuyenteId, t.anio, sql`coalesce(${t.mes}, 0)`, t.identificador),
  ],
);

export const loteComprobantes = pgTable(
  "lote_comprobantes",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    loteId: integer("lote_id")
      .notNull()
      .references(() => lotes.id),
    loteArchivoId: integer("lote_archivo_id")
      .notNull()
      .references(() => loteArchivos.id),
    comprobanteId: integer("comprobante_id")
      .notNull()
      .references(() => comprobantes.id),
    fila: integer("fila").notNull(),
    estado: text("estado", { enum: ["INCLUIDO", "ENVIADO", "ACEPTADO_DNIT", "RECHAZADO_DNIT", "RETIRADO"] })
      .notNull()
      .default("INCLUIDO"),
    /** true mientras el lote cuenta para el comprobante; un comprobante solo puede estar en un lote activo. */
    activo: boolean("activo").notNull().default(true),
    errorDnit: text("error_dnit"),
    /** Campos exactamente como se exportaron. */
    campos: jsonb("campos").notNull(),
  },
  (t) => [
    uniqueIndex("lote_comprobantes_un_lote_activo").on(t.comprobanteId).where(sql`${t.activo}`),
    index("lote_comprobantes_lote_idx").on(t.loteId),
  ],
);
