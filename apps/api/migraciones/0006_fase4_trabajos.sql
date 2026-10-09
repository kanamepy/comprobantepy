CREATE TABLE "trabajos" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "trabajos_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tipo" text NOT NULL,
	"comprobante_id" integer NOT NULL,
	"archivo_id" integer NOT NULL,
	"estado" text DEFAULT 'PENDIENTE' NOT NULL,
	"intentos" integer DEFAULT 0 NOT NULL,
	"error" text,
	"disponible_en" timestamp with time zone DEFAULT now() NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trabajos" ADD CONSTRAINT "trabajos_comprobante_id_comprobantes_id_fk" FOREIGN KEY ("comprobante_id") REFERENCES "public"."comprobantes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trabajos" ADD CONSTRAINT "trabajos_archivo_id_archivos_id_fk" FOREIGN KEY ("archivo_id") REFERENCES "public"."archivos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trabajos_pendientes_idx" ON "trabajos" USING btree ("disponible_en") WHERE "trabajos"."estado" = 'PENDIENTE';