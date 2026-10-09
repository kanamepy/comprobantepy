DROP INDEX "comprobantes_cdc_unico";--> statement-breakpoint
DROP INDEX "comprobantes_clave_negocio_unica";--> statement-breakpoint
ALTER TABLE "comprobantes" ADD COLUMN "reemplazado_por_id" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "comprobantes_cdc_unico" ON "comprobantes" USING btree ("cdc") WHERE "comprobantes"."cdc" IS NOT NULL AND "comprobantes"."reemplazado_por_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "comprobantes_clave_negocio_unica" ON "comprobantes" USING btree ("proveedor_id","tipo_comprobante","timbrado","numero") WHERE "comprobantes"."proveedor_id" IS NOT NULL AND "comprobantes"."tipo_comprobante" IS NOT NULL AND "comprobantes"."timbrado" IS NOT NULL AND "comprobantes"."numero" IS NOT NULL AND "comprobantes"."reemplazado_por_id" IS NULL;