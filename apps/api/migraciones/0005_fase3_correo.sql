CREATE TABLE "alertas" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "alertas_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tipo" text NOT NULL,
	"mensaje" text NOT NULL,
	"buzon_id" integer,
	"creada_en" timestamp with time zone DEFAULT now() NOT NULL,
	"resuelta_en" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "buzones" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "buzones_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"direccion" text NOT NULL,
	"rol" text NOT NULL,
	"mecanismo" text NOT NULL,
	"titular" text NOT NULL,
	"contribuyente_sugerido_id" integer,
	"filtro" text,
	"credencial_cifrada" text,
	"estado" text DEFAULT 'PENDIENTE_CONEXION' NOT NULL,
	"ultimo_sondeo_en" timestamp with time zone,
	"sondeo_en_curso" timestamp with time zone,
	"ultimo_error" text,
	"autorizacion_fecha" date,
	"autorizacion_forma" text,
	"baja_motivo" text,
	"creado_por" integer NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mensaje_archivos" (
	"mensaje_id" integer NOT NULL,
	"archivo_id" integer NOT NULL,
	CONSTRAINT "mensaje_archivos_mensaje_id_archivo_id_pk" PRIMARY KEY("mensaje_id","archivo_id")
);
--> statement-breakpoint
CREATE TABLE "mensajes_correo" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "mensajes_correo_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"buzon_id" integer,
	"id_proveedor" text NOT NULL,
	"message_id" text,
	"remitente_original" text,
	"reenviado_por" text,
	"destinatario" text,
	"asunto" text,
	"fecha" timestamp with time zone,
	"canal" text NOT NULL,
	"estado" text NOT NULL,
	"detalle" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"resuelto_por" integer,
	"resuelto_en" timestamp with time zone,
	"ruta_original" text,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alertas" ADD CONSTRAINT "alertas_buzon_id_buzones_id_fk" FOREIGN KEY ("buzon_id") REFERENCES "public"."buzones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buzones" ADD CONSTRAINT "buzones_contribuyente_sugerido_id_contribuyentes_id_fk" FOREIGN KEY ("contribuyente_sugerido_id") REFERENCES "public"."contribuyentes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buzones" ADD CONSTRAINT "buzones_creado_por_usuarios_id_fk" FOREIGN KEY ("creado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mensaje_archivos" ADD CONSTRAINT "mensaje_archivos_mensaje_id_mensajes_correo_id_fk" FOREIGN KEY ("mensaje_id") REFERENCES "public"."mensajes_correo"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mensaje_archivos" ADD CONSTRAINT "mensaje_archivos_archivo_id_archivos_id_fk" FOREIGN KEY ("archivo_id") REFERENCES "public"."archivos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mensajes_correo" ADD CONSTRAINT "mensajes_correo_buzon_id_buzones_id_fk" FOREIGN KEY ("buzon_id") REFERENCES "public"."buzones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mensajes_correo" ADD CONSTRAINT "mensajes_correo_resuelto_por_usuarios_id_fk" FOREIGN KEY ("resuelto_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alertas_abiertas_idx" ON "alertas" USING btree ("tipo") WHERE "alertas"."resuelta_en" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "buzones_direccion_unica" ON "buzones" USING btree (lower("direccion")) WHERE "buzones"."estado" <> 'BAJA';--> statement-breakpoint
CREATE UNIQUE INDEX "mensajes_correo_unico" ON "mensajes_correo" USING btree (coalesce("buzon_id", 0),"id_proveedor");--> statement-breakpoint
CREATE INDEX "mensajes_correo_estado_idx" ON "mensajes_correo" USING btree ("estado");--> statement-breakpoint
CREATE INDEX "mensajes_correo_message_id_idx" ON "mensajes_correo" USING btree ("message_id");