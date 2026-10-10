# Cómo regenerar el Word del instructivo

El archivo `docs/Manual_de_usuario_ComprobantePy.docx` se genera a partir de `docs/MANUAL_USUARIO.md`
con la guía de estilo (lienzo cuadrado 10 × 10", lavanda, azul Francia, verde pastel).

```bash
npm install --no-save docx
node docs/fuentes-manual/generar-word.js docs/MANUAL_USUARIO.md docs/Manual_de_usuario_ComprobantePy.docx docs/fuentes-manual
```

`portada.png`, `agenda.png` y `cierre.png` son los fondos con los círculos decorativos.
