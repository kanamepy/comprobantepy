CREATE TABLE "lote_archivos" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "lote_archivos_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"lote_id" integer NOT NULL,
	"contribuyente_id" integer NOT NULL,
	"anio" smallint NOT NULL,
	"mes" smallint,
	"identificador" text NOT NULL,
	"nombre_base" text NOT NULL,
	"nombre_archivo" text NOT NULL,
	"nombre_zip" text NOT NULL,
	"sha256_zip" text NOT NULL,
	"tamano" integer NOT NULL,
	"filas" integer NOT NULL,
	"ruta" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lote_comprobantes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "lote_comprobantes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"lote_id" integer NOT NULL,
	"lote_archivo_id" integer NOT NULL,
	"comprobante_id" integer NOT NULL,
	"fila" integer NOT NULL,
	"estado" text DEFAULT 'INCLUIDO' NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"error_dnit" text,
	"campos" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lotes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "lotes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"contribuyente_id" integer NOT NULL,
	"obligacion" text NOT NULL,
	"anio" smallint NOT NULL,
	"mes" smallint,
	"formato" text NOT NULL,
	"estado" text DEFAULT 'GENERADO' NOT NULL,
	"version_matriz" text NOT NULL,
	"version_mapeo" text NOT NULL,
	"conciliacion" jsonb NOT NULL,
	"excluidos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"generado_por" integer NOT NULL,
	"generado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"enviado_en" date,
	"enviado_por" integer,
	"cerrado_en" timestamp with time zone,
	"anulado_motivo" text,
	"motivo_reproceso" text
);
--> statement-breakpoint
ALTER TABLE "comprobantes" ADD COLUMN "estado_marangatu" text;--> statement-breakpoint
ALTER TABLE "lote_archivos" ADD CONSTRAINT "lote_archivos_lote_id_lotes_id_fk" FOREIGN KEY ("lote_id") REFERENCES "public"."lotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lote_archivos" ADD CONSTRAINT "lote_archivos_contribuyente_id_contribuyentes_id_fk" FOREIGN KEY ("contribuyente_id") REFERENCES "public"."contribuyentes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lote_comprobantes" ADD CONSTRAINT "lote_comprobantes_lote_id_lotes_id_fk" FOREIGN KEY ("lote_id") REFERENCES "public"."lotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lote_comprobantes" ADD CONSTRAINT "lote_comprobantes_lote_archivo_id_lote_archivos_id_fk" FOREIGN KEY ("lote_archivo_id") REFERENCES "public"."lote_archivos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lote_comprobantes" ADD CONSTRAINT "lote_comprobantes_comprobante_id_comprobantes_id_fk" FOREIGN KEY ("comprobante_id") REFERENCES "public"."comprobantes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lotes" ADD CONSTRAINT "lotes_contribuyente_id_contribuyentes_id_fk" FOREIGN KEY ("contribuyente_id") REFERENCES "public"."contribuyentes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lotes" ADD CONSTRAINT "lotes_generado_por_usuarios_id_fk" FOREIGN KEY ("generado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lotes" ADD CONSTRAINT "lotes_enviado_por_usuarios_id_fk" FOREIGN KEY ("enviado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lote_archivos_identificador_unico" ON "lote_archivos" USING btree ("contribuyente_id","anio",coalesce("mes", 0),"identificador");--> statement-breakpoint
CREATE UNIQUE INDEX "lote_comprobantes_un_lote_activo" ON "lote_comprobantes" USING btree ("comprobante_id") WHERE "lote_comprobantes"."activo";--> statement-breakpoint
CREATE INDEX "lote_comprobantes_lote_idx" ON "lote_comprobantes" USING btree ("lote_id");--> statement-breakpoint
CREATE INDEX "lotes_contribuyente_idx" ON "lotes" USING btree ("contribuyente_id");