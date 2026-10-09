CREATE TABLE "auditoria" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "auditoria_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"ocurrido_en" timestamp with time zone DEFAULT now() NOT NULL,
	"usuario_id" integer,
	"perfil" text,
	"contribuyente_id" integer,
	"sesion_id" text,
	"ip" text,
	"dispositivo" text,
	"entidad" text NOT NULL,
	"entidad_id" text,
	"accion" text NOT NULL,
	"valor_anterior" jsonb,
	"valor_nuevo" jsonb,
	"motivo" text,
	"origen" text DEFAULT 'WEB' NOT NULL,
	"correlacion" text
);
--> statement-breakpoint
CREATE TABLE "contribuyentes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "contribuyentes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"nombre" text NOT NULL,
	"tipo_identificacion" text NOT NULL,
	"numero_identificacion" text NOT NULL,
	"dv" smallint,
	"relacion" text,
	"obligacion_registro" text,
	"correo_contacto" text,
	"estado" text DEFAULT 'ACTIVO' NOT NULL,
	"autorizacion_fecha" date NOT NULL,
	"autorizacion_forma" text NOT NULL,
	"autorizacion_alcance" text NOT NULL,
	"baja_motivo" text,
	"baja_en" timestamp with time zone,
	"baja_por" integer,
	"creado_por" integer NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contribuyentes_dv_ruc" CHECK (("contribuyentes"."tipo_identificacion" = 'CI') OR ("contribuyentes"."dv" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "sesiones" (
	"id" text PRIMARY KEY NOT NULL,
	"usuario_id" integer NOT NULL,
	"creada_en" timestamp with time zone DEFAULT now() NOT NULL,
	"expira_en" timestamp with time zone NOT NULL,
	"ip" text,
	"agente" text
);
--> statement-breakpoint
CREATE TABLE "usuario_contribuyente_perfiles" (
	"usuario_id" integer NOT NULL,
	"contribuyente_id" integer NOT NULL,
	"perfil" text NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usuario_contribuyente_perfiles_usuario_id_contribuyente_id_perfil_pk" PRIMARY KEY("usuario_id","contribuyente_id","perfil")
);
--> statement-breakpoint
CREATE TABLE "usuarios" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "usuarios_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"email" text NOT NULL,
	"nombre" text NOT NULL,
	"password_hash" text NOT NULL,
	"es_administrador" boolean DEFAULT false NOT NULL,
	"totp_secreto_cifrado" text,
	"totp_activo" boolean DEFAULT false NOT NULL,
	"bloqueado" boolean DEFAULT false NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auditoria" ADD CONSTRAINT "auditoria_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auditoria" ADD CONSTRAINT "auditoria_contribuyente_id_contribuyentes_id_fk" FOREIGN KEY ("contribuyente_id") REFERENCES "public"."contribuyentes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribuyentes" ADD CONSTRAINT "contribuyentes_baja_por_usuarios_id_fk" FOREIGN KEY ("baja_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribuyentes" ADD CONSTRAINT "contribuyentes_creado_por_usuarios_id_fk" FOREIGN KEY ("creado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sesiones" ADD CONSTRAINT "sesiones_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usuario_contribuyente_perfiles" ADD CONSTRAINT "usuario_contribuyente_perfiles_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usuario_contribuyente_perfiles" ADD CONSTRAINT "usuario_contribuyente_perfiles_contribuyente_id_contribuyentes_id_fk" FOREIGN KEY ("contribuyente_id") REFERENCES "public"."contribuyentes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auditoria_entidad_idx" ON "auditoria" USING btree ("entidad","entidad_id");--> statement-breakpoint
CREATE INDEX "auditoria_contribuyente_idx" ON "auditoria" USING btree ("contribuyente_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contribuyentes_identificacion_unica" ON "contribuyentes" USING btree ("tipo_identificacion","numero_identificacion");--> statement-breakpoint
CREATE INDEX "sesiones_usuario_idx" ON "sesiones" USING btree ("usuario_id");--> statement-breakpoint
CREATE UNIQUE INDEX "usuarios_email_unico" ON "usuarios" USING btree (lower("email"));