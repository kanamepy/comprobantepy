-- Segunda barrera de aislamiento por contribuyente (secciones 2.5 y 21.4.1).
-- La aplicación filtra en la capa de acceso a datos; además PostgreSQL aplica estas políticas
-- con las variables de sesión app.contribuyentes y app.sistema que fija cada conexión.
-- FORCE hace que las políticas valgan también para el dueño de las tablas.
CREATE OR REPLACE FUNCTION app_puede_ver(contribuyente integer) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.sistema', true), 'on') = 'on'
      OR contribuyente = ANY (string_to_array(nullif(current_setting('app.contribuyentes', true), ''), ',')::integer[])
$$;
--> statement-breakpoint
ALTER TABLE comprobantes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE comprobantes FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Los comprobantes pendientes de asignación (sin contribuyente) los ve quien carga.
CREATE POLICY aislamiento ON comprobantes USING (contribuyente_id IS NULL OR app_puede_ver(contribuyente_id));
--> statement-breakpoint
ALTER TABLE imputaciones ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE imputaciones FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY aislamiento ON imputaciones USING (EXISTS (SELECT 1 FROM comprobantes c WHERE c.id = comprobante_id));
--> statement-breakpoint
ALTER TABLE ingresos ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE ingresos FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY aislamiento ON ingresos USING (app_puede_ver(contribuyente_id));
--> statement-breakpoint
ALTER TABLE irp_movimientos ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE irp_movimientos FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY aislamiento ON irp_movimientos USING (app_puede_ver(contribuyente_id));
--> statement-breakpoint
ALTER TABLE irp_cierres ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE irp_cierres FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY aislamiento ON irp_cierres USING (app_puede_ver(contribuyente_id));
--> statement-breakpoint
ALTER TABLE lotes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE lotes FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY aislamiento ON lotes USING (app_puede_ver(contribuyente_id));
--> statement-breakpoint
ALTER TABLE lote_archivos ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE lote_archivos FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY aislamiento ON lote_archivos USING (app_puede_ver(contribuyente_id));
--> statement-breakpoint
ALTER TABLE lote_comprobantes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE lote_comprobantes FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY aislamiento ON lote_comprobantes USING (EXISTS (SELECT 1 FROM lotes l WHERE l.id = lote_id));
--> statement-breakpoint
ALTER TABLE contribuyente_obligaciones ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE contribuyente_obligaciones FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY aislamiento ON contribuyente_obligaciones USING (app_puede_ver(contribuyente_id));
--> statement-breakpoint
ALTER TABLE actividades ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE actividades FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY aislamiento ON actividades USING (app_puede_ver(contribuyente_id));
