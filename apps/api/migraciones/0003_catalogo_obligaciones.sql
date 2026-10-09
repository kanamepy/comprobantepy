-- Catálogo inicial de obligaciones y su indicador en el archivo Marangatu (secciones 14.1 y 14.4).
INSERT INTO obligaciones (codigo, descripcion, indicador_marangatu) VALUES
  ('IVA', 'Impuesto al Valor Agregado', 'IVA'),
  ('IRE_GENERAL', 'IRE – Régimen general', 'IRE'),
  ('IRE_SIMPLE', 'IRE – SIMPLE', 'IRE'),
  ('IRE_RESIMPLE', 'IRE – RESIMPLE', 'IRE'),
  ('IRP_RSP', 'IRP – Rentas de servicios personales', 'IRP_RSP')
ON CONFLICT (codigo) DO NOTHING;
