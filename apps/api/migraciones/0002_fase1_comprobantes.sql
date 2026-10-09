CREATE TABLE "actividades" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "actividades_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"contribuyente_id" integer NOT NULL,
	"descripcion" text NOT NULL,
	"estado" text DEFAULT 'ACTIVO' NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "archivos" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "archivos_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"sha256" text NOT NULL,
	"nombre_original" text NOT NULL,
	"tipo_mime" text NOT NULL,
	"tipo_detectado" text NOT NULL,
	"tamano" integer NOT NULL,
	"ruta" text NOT NULL,
	"canal" text NOT NULL,
	"subido_por" integer,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comprobante_archivos" (
	"comprobante_id" integer NOT NULL,
	"archivo_id" integer NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comprobante_archivos_comprobante_id_archivo_id_pk" PRIMARY KEY("comprobante_id","archivo_id")
);
--> statement-breakpoint
CREATE TABLE "comprobantes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "comprobantes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"contribuyente_id" integer,
	"asignacion_manual" boolean DEFAULT false NOT NULL,
	"proveedor_id" integer,
	"timbrado_id" integer,
	"canal" text NOT NULL,
	"naturaleza" text NOT NULL,
	"naturaleza_motivo" text,
	"tipo_comprobante" smallint,
	"cdc" text,
	"timbrado" integer,
	"numero" text,
	"fecha_emision" date,
	"moneda" text DEFAULT 'PYG' NOT NULL,
	"tipo_cambio" numeric(14, 4),
	"condicion" smallint,
	"receptor_tipo_identificacion" text,
	"receptor_numero" text,
	"receptor_dv" smallint,
	"receptor_nombre" text,
	"gravado10" numeric(20, 2),
	"gravado5" numeric(20, 2),
	"exento" numeric(20, 2),
	"iva10" numeric(20, 2),
	"iva5" numeric(20, 2),
	"total" numeric(20, 2),
	"asociado_numero" text,
	"asociado_timbrado" integer,
	"asociado_cdc" text,
	"numero_cuenta_cifrado" text,
	"numero_cuenta_mascara" text,
	"entidad_financiera" text,
	"numero_patronal_ips" text,
	"especificar_tipo_documento" text,
	"porcentaje_no_imputado" numeric(5, 2) DEFAULT '0' NOT NULL,
	"estado_tecnico" text NOT NULL,
	"estado_flujo" text NOT NULL,
	"motivo_estado" text,
	"problemas" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"campos_origen" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"advertencias_extraccion" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"duplicados_descartados" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"observaciones" text,
	"version" integer DEFAULT 1 NOT NULL,
	"version_anterior_id" integer,
	"anulado_motivo" text,
	"anulado_en" timestamp with time zone,
	"anulado_por" integer,
	"creado_por" integer,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contribuyente_obligaciones" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "contribuyente_obligaciones_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"contribuyente_id" integer NOT NULL,
	"obligacion_codigo" text NOT NULL,
	"vigente_desde" date NOT NULL,
	"vigente_hasta" date,
	"estado" text DEFAULT 'ACTIVO' NOT NULL,
	"anulado_motivo" text,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "imputaciones" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "imputaciones_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"comprobante_id" integer NOT NULL,
	"obligacion_codigo" text NOT NULL,
	"actividad_id" integer,
	"porcentaje" numeric(5, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "obligaciones" (
	"codigo" text PRIMARY KEY NOT NULL,
	"descripcion" text NOT NULL,
	"indicador_marangatu" text,
	"version" integer DEFAULT 1 NOT NULL,
	"estado" text DEFAULT 'ACTIVO' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proveedores" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "proveedores_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tipo_identificacion" smallint NOT NULL,
	"numero_identificacion" text NOT NULL,
	"dv" smallint,
	"razon_social" text NOT NULL,
	"nombre_fantasia" text,
	"estado" text DEFAULT 'PENDIENTE_DE_CONFIRMAR' NOT NULL,
	"emisor_electronico" boolean DEFAULT false NOT NULL,
	"emisor_virtual" boolean DEFAULT false NOT NULL,
	"fuente" text NOT NULL,
	"observacion" text,
	"confirmado_por" integer,
	"confirmado_en" timestamp with time zone,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timbrados" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "timbrados_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"proveedor_id" integer NOT NULL,
	"numero" integer NOT NULL,
	"vigencia_desde" date,
	"vigencia_hasta" date,
	"estado_verificacion" text DEFAULT 'NO_VERIFICADO' NOT NULL,
	"consulta_en" timestamp with time zone,
	"verificado_por" integer,
	"evidencia_archivo_id" integer,
	"observacion" text,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "actividades" ADD CONSTRAINT "actividades_contribuyente_id_contribuyentes_id_fk" FOREIGN KEY ("contribuyente_id") REFERENCES "public"."contribuyentes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archivos" ADD CONSTRAINT "archivos_subido_por_usuarios_id_fk" FOREIGN KEY ("subido_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comprobante_archivos" ADD CONSTRAINT "comprobante_archivos_comprobante_id_comprobantes_id_fk" FOREIGN KEY ("comprobante_id") REFERENCES "public"."comprobantes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comprobante_archivos" ADD CONSTRAINT "comprobante_archivos_archivo_id_archivos_id_fk" FOREIGN KEY ("archivo_id") REFERENCES "public"."archivos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comprobantes" ADD CONSTRAINT "comprobantes_contribuyente_id_contribuyentes_id_fk" FOREIGN KEY ("contribuyente_id") REFERENCES "public"."contribuyentes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comprobantes" ADD CONSTRAINT "comprobantes_proveedor_id_proveedores_id_fk" FOREIGN KEY ("proveedor_id") REFERENCES "public"."proveedores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comprobantes" ADD CONSTRAINT "comprobantes_timbrado_id_timbrados_id_fk" FOREIGN KEY ("timbrado_id") REFERENCES "public"."timbrados"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comprobantes" ADD CONSTRAINT "comprobantes_anulado_por_usuarios_id_fk" FOREIGN KEY ("anulado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comprobantes" ADD CONSTRAINT "comprobantes_creado_por_usuarios_id_fk" FOREIGN KEY ("creado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribuyente_obligaciones" ADD CONSTRAINT "contribuyente_obligaciones_contribuyente_id_contribuyentes_id_fk" FOREIGN KEY ("contribuyente_id") REFERENCES "public"."contribuyentes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribuyente_obligaciones" ADD CONSTRAINT "contribuyente_obligaciones_obligacion_codigo_obligaciones_codigo_fk" FOREIGN KEY ("obligacion_codigo") REFERENCES "public"."obligaciones"("codigo") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imputaciones" ADD CONSTRAINT "imputaciones_comprobante_id_comprobantes_id_fk" FOREIGN KEY ("comprobante_id") REFERENCES "public"."comprobantes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imputaciones" ADD CONSTRAINT "imputaciones_obligacion_codigo_obligaciones_codigo_fk" FOREIGN KEY ("obligacion_codigo") REFERENCES "public"."obligaciones"("codigo") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imputaciones" ADD CONSTRAINT "imputaciones_actividad_id_actividades_id_fk" FOREIGN KEY ("actividad_id") REFERENCES "public"."actividades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proveedores" ADD CONSTRAINT "proveedores_confirmado_por_usuarios_id_fk" FOREIGN KEY ("confirmado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timbrados" ADD CONSTRAINT "timbrados_proveedor_id_proveedores_id_fk" FOREIGN KEY ("proveedor_id") REFERENCES "public"."proveedores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timbrados" ADD CONSTRAINT "timbrados_verificado_por_usuarios_id_fk" FOREIGN KEY ("verificado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timbrados" ADD CONSTRAINT "timbrados_evidencia_archivo_id_archivos_id_fk" FOREIGN KEY ("evidencia_archivo_id") REFERENCES "public"."archivos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "actividades_contribuyente_idx" ON "actividades" USING btree ("contribuyente_id");--> statement-breakpoint
CREATE UNIQUE INDEX "archivos_sha256_unico" ON "archivos" USING btree ("sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "comprobantes_cdc_unico" ON "comprobantes" USING btree ("cdc") WHERE "comprobantes"."cdc" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "comprobantes_clave_negocio_unica" ON "comprobantes" USING btree ("proveedor_id","tipo_comprobante","timbrado","numero") WHERE "comprobantes"."proveedor_id" IS NOT NULL AND "comprobantes"."tipo_comprobante" IS NOT NULL AND "comprobantes"."timbrado" IS NOT NULL AND "comprobantes"."numero" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "comprobantes_contribuyente_idx" ON "comprobantes" USING btree ("contribuyente_id");--> statement-breakpoint
CREATE INDEX "comprobantes_estado_flujo_idx" ON "comprobantes" USING btree ("estado_flujo");--> statement-breakpoint
CREATE INDEX "comprobantes_proveedor_fecha_idx" ON "comprobantes" USING btree ("proveedor_id","fecha_emision");--> statement-breakpoint
CREATE INDEX "contribuyente_obligaciones_contribuyente_idx" ON "contribuyente_obligaciones" USING btree ("contribuyente_id");--> statement-breakpoint
CREATE INDEX "imputaciones_comprobante_idx" ON "imputaciones" USING btree ("comprobante_id");--> statement-breakpoint
CREATE UNIQUE INDEX "proveedores_identificacion_unica" ON "proveedores" USING btree ("tipo_identificacion","numero_identificacion");--> statement-breakpoint
CREATE UNIQUE INDEX "timbrados_proveedor_numero_unico" ON "timbrados" USING btree ("proveedor_id","numero");