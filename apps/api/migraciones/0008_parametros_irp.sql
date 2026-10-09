-- Parámetros iniciales del IRP-RSP según el instructivo del Formulario N.° 515, versión 1.
-- Se pueden ajustar por ejercicio desde la aplicación (perfil Financiero).
INSERT INTO irp_parametros (ejercicio, tramos, fuente)
SELECT anio,
       '[{"hasta": 50000000, "tasaPuntosBasicos": 800}, {"hasta": 150000000, "tasaPuntosBasicos": 900}, {"hasta": null, "tasaPuntosBasicos": 1000}]'::jsonb,
       'Instructivo del Formulario N.° 515, versión 1'
FROM generate_series(2021, 2030) AS anio
ON CONFLICT (ejercicio) DO NOTHING;
