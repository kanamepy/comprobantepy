-- Log de auditoría inmutable (sección 17): solo inserción, sin UPDATE, DELETE ni TRUNCATE.
CREATE OR REPLACE FUNCTION auditoria_inmutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'La tabla auditoria es de solo inserción';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER auditoria_sin_update_delete
  BEFORE UPDATE OR DELETE ON auditoria
  FOR EACH ROW EXECUTE FUNCTION auditoria_inmutable();
--> statement-breakpoint
CREATE TRIGGER auditoria_sin_truncate
  BEFORE TRUNCATE ON auditoria
  FOR EACH STATEMENT EXECUTE FUNCTION auditoria_inmutable();
