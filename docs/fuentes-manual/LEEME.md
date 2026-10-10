# Cómo regenerar el Word del instructivo

El archivo `docs/Manual_de_usuario_ComprobantePy.docx` se genera a partir de `docs/MANUAL_USUARIO.md`
con la guía de estilo (lienzo cuadrado 10 × 10", lavanda, azul Francia, verde pastel).

```bash
npm install --no-save docx
node docs/fuentes-manual/generar-word.cjs docs/MANUAL_USUARIO.md docs/Manual_de_usuario_ComprobantePy.docx docs/fuentes-manual
```

`portada.png`, `agenda.png` y `cierre.png` son los fondos con los círculos decorativos.

El documento de implementación y verificación usa el mismo generador con su configuración:

```bash
node docs/fuentes-manual/generar-word.cjs docs/PASO_A_PASO.md docs/Implementacion_y_verificacion_ComprobantePy.docx docs/fuentes-manual docs/fuentes-manual/verificacion.json
```

Y la guía de publicación:

```bash
node docs/fuentes-manual/generar-word.cjs docs/PUBLICAR_EN_INTERNET.md docs/Publicar_en_internet_ComprobantePy.docx docs/fuentes-manual docs/fuentes-manual/publicar.json
```
