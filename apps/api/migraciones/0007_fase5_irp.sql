CREATE TABLE "ingresos" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ingresos_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"contribuyente_id" integer NOT NULL,
	"fecha" date NOT NULL,
	"tipo" text NOT NULL,
	"tratamiento" text NOT NULL,
	"actividad_id" integer,
	"pagador" text,
	"descripcion" text,
	"importe" numeric(20, 0) NOT NULL,
	"estado" text NOT NULL,
	"respaldo_archivo_id" integer,
	"anulado_motivo" text,
	"creado_por" integer,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "irp_cierres" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "irp_cierres_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"contribuyente_id" integer NOT NULL,
	"ejercicio" smallint NOT NULL,
	"mes" smallint,
	"estado" text DEFAULT 'CERRADO' NOT NULL,
	"fotografia" jsonb NOT NULL,
	"cerrado_por" integer NOT NULL,
	"cerrado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"reabierto_por" integer,
	"reabierto_en" timestamp with time zone,
	"motivo_reapertura" text
);
--> statement-breakpoint
CREATE TABLE "irp_movimientos" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "irp_movimientos_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"contribuyente_id" integer NOT NULL,
	"ejercicio" smallint NOT NULL,
	"fecha" date NOT NULL,
	"tipo" text NOT NULL,
	"agente" text,
	"numero_comprobante" text,
	"descripcion" text,
	"importe" numeric(20, 0) NOT NULL,
	"estado" text NOT NULL,
	"respaldo_archivo_id" integer,
	"anulado_motivo" text,
	"creado_por" integer,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "irp_parametros" (
	"ejercicio" smallint PRIMARY KEY NOT NULL,
	"tramos" jsonb NOT NULL,
	"compensaciones_habilitadas" boolean DEFAULT false NOT NULL,
	"fuente" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"actualizado_por" integer,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "comprobantes" ADD COLUMN "irp_tratamiento" text;--> statement-breakpoint
ALTER TABLE "comprobantes" ADD COLUMN "irp_porcentaje_admitido" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "comprobantes" ADD COLUMN "irp_tratamiento_confirmado" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "comprobantes" ADD COLUMN "irp_tratamiento_motivo" text;--> statement-breakpoint
ALTER TABLE "ingresos" ADD CONSTRAINT "ingresos_contribuyente_id_contribuyentes_id_fk" FOREIGN KEY ("contribuyente_id") REFERENCES "public"."contribuyentes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingresos" ADD CONSTRAINT "ingresos_actividad_id_actividades_id_fk" FOREIGN KEY ("actividad_id") REFERENCES "public"."actividades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingresos" ADD CONSTRAINT "ingresos_respaldo_archivo_id_archivos_id_fk" FOREIGN KEY ("respaldo_archivo_id") REFERENCES "public"."archivos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingresos" ADD CONSTRAINT "ingresos_creado_por_usuarios_id_fk" FOREIGN KEY ("creado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "irp_cierres" ADD CONSTRAINT "irp_cierres_contribuyente_id_contribuyentes_id_fk" FOREIGN KEY ("contribuyente_id") REFERENCES "public"."contribuyentes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "irp_cierres" ADD CONSTRAINT "irp_cierres_cerrado_por_usuarios_id_fk" FOREIGN KEY ("cerrado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "irp_cierres" ADD CONSTRAINT "irp_cierres_reabierto_por_usuarios_id_fk" FOREIGN KEY ("reabierto_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "irp_movimientos" ADD CONSTRAINT "irp_movimientos_contribuyente_id_contribuyentes_id_fk" FOREIGN KEY ("contribuyente_id") REFERENCES "public"."contribuyentes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "irp_movimientos" ADD CONSTRAINT "irp_movimientos_respaldo_archivo_id_archivos_id_fk" FOREIGN KEY ("respaldo_archivo_id") REFERENCES "public"."archivos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "irp_movimientos" ADD CONSTRAINT "irp_movimientos_creado_por_usuarios_id_fk" FOREIGN KEY ("creado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "irp_parametros" ADD CONSTRAINT "irp_parametros_actualizado_por_usuarios_id_fk" FOREIGN KEY ("actualizado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ingresos_contribuyente_fecha_idx" ON "ingresos" USING btree ("contribuyente_id","fecha");--> statement-breakpoint
CREATE UNIQUE INDEX "irp_cierres_vigente_unico" ON "irp_cierres" USING btree ("contribuyente_id","ejercicio",coalesce("mes", 0)) WHERE "irp_cierres"."estado" = 'CERRADO';--> statement-breakpoint
CREATE INDEX "irp_movimientos_contribuyente_idx" ON "irp_movimientos" USING btree ("contribuyente_id","ejercicio");