// Instructivo de usuario en Word, con el formato de la guía de estilo (lienzo cuadrado, paleta lavanda/azul Francia/verde).
const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, ShadingType,
  BorderStyle, AlignmentType, LevelFormat, ImageRun, Footer, Header, PageNumber, PageBreak, TableLayoutType,
  LineRuleType, HorizontalPositionRelativeFrom, VerticalPositionRelativeFrom, VerticalAlign, PositionalTab,
  PositionalTabAlignment, PositionalTabRelativeTo, PositionalTabLeader, HeightRule,
} = require("docx");

const [, , entrada, salida, recursos, archivoConfig] = process.argv;
const carpetaMd = path.dirname(entrada);

// Paleta
const LAVANDA = "B9A7E2", LAVANDA_CLARO = "E6DFF5", AZUL = "0055A4", VERDE = "B8ED9C", CARBON = "242332";
const GRIS_CLARO = "F4F4F6", BLANCO = "FFFFFF", GRIS_TEXTO = "6B6980", GRIS_BORDE = "C9C7D6";
const TITULOS = "Arial Narrow", TEXTO = "Arial";

// Lienzo: 10 × 10 pulgadas, márgenes laterales 0,6", pie a 9,45" del borde superior.
const PULGADA = 1440;
const LADO = 10 * PULGADA;
const MARGEN_LATERAL = 0.6 * PULGADA;
const ANCHO = LADO - 2 * MARGEN_LATERAL; // 8,8"
const pt = (n) => Math.round(n * 2); // tamaño en medios puntos

// Textos propios de cada documento: se pueden reemplazar con un archivo de configuración (JSON).
const CONFIG_INSTRUCTIVO = {
  titulo: "ComprobantePy – Instructivo de usuario",
  portada: ["Instructivo de ", "usuario"],
  subtitulo: "Qué hace el sistema y cómo se usa cada módulo",
  etiqueta: "Instructivo de usuario",
  agenda: ["Contenido del ", "instructivo"],
  cierre: ["Listo para ", "empezar"],
  cierreTexto: "Instalación, comandos y solución de problemas: archivo GUIA.md del proyecto.",
  cierreNota: "Ante cualquier error, anotá qué estabas haciendo y el mensaje completo.",
  cifras: { seccion: "Qué es ComprobantePy", items: [["10", "módulos"], ["4", "perfiles"], ["8", "pasos por comprobante"]] },
};
const CONFIG = archivoConfig ? { ...CONFIG_INSTRUCTIVO, cifras: null, ...JSON.parse(fs.readFileSync(archivoConfig, "utf8")) } : CONFIG_INSTRUCTIVO;

// Partes de cada título: la segunda va en azul Francia.
const PARTES_TITULO = {
  "Qué es ComprobantePy": ["Qué es ", "ComprobantePy"],
  "Ingreso al sistema": ["Ingreso al ", "sistema"],
  "Recorrido de un comprobante": ["Recorrido de un ", "comprobante"],
  "Los módulos, uno por uno": ["Los módulos, ", "uno por uno"],
  "Estados, naturalezas y perfiles": ["Estados, naturalezas y ", "perfiles"],
  "Tareas frecuentes": ["Tareas ", "frecuentes"],
  "Preguntas frecuentes": ["Preguntas ", "frecuentes"],
  "Buenas prácticas y seguridad": ["Buenas prácticas y ", "seguridad"],
  ...(CONFIG.partesTitulo ?? {}),
};
// Idea principal de cada sección (recuadro de mensaje), alternando verde, azul y carbón.
const MENSAJES = {
  "Qué es ComprobantePy": "Un solo lugar para recibir, controlar y declarar los comprobantes de toda la familia.",
  "Ingreso al sistema": "Contraseña más código del celular: nadie entra con tu usuario aunque conozca tu clave.",
  "Recorrido de un comprobante": "El sistema lee y valida solo; las personas revisan, confirman y aprueban.",
  "Los módulos, uno por uno": "Elegí el contribuyente arriba antes de trabajar: todo se filtra por esa persona.",
  "Estados, naturalezas y perfiles": "Solo los comprobantes físicos aprobados se exportan a Marangatu.",
  "Tareas frecuentes": "Revisá siempre lo marcado en amarillo antes de confirmar.",
  "Preguntas frecuentes": "Nada se borra: se anula con motivo y queda en el historial.",
  "Buenas prácticas y seguridad": "Respaldo semanal fuera de la PC y la clave de cifrado guardada aparte.",
  ...(CONFIG.mensajes ?? {}),
};
const ESTILOS_MENSAJE = [
  { fondo: VERDE, texto: CARBON },
  { fondo: AZUL, texto: BLANCO },
  { fondo: CARBON, texto: BLANCO },
];

const sinBordes = { top: { style: BorderStyle.NONE, size: 0, color: "auto" }, bottom: { style: BorderStyle.NONE, size: 0, color: "auto" },
  left: { style: BorderStyle.NONE, size: 0, color: "auto" }, right: { style: BorderStyle.NONE, size: 0, color: "auto" } };
const bordeTabla = { style: BorderStyle.SINGLE, size: 4, color: GRIS_BORDE }; // 0,5 pt

function runs(texto, base = {}) {
  const partes = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let ultimo = 0, m;
  while ((m = re.exec(texto))) {
    if (m.index > ultimo) partes.push(new TextRun({ text: texto.slice(ultimo, m.index), ...base }));
    const t = m[0];
    if (t.startsWith("**")) partes.push(new TextRun({ text: t.slice(2, -2), ...base, bold: true }));
    else partes.push(new TextRun({ text: t.slice(1, -1), ...base, font: "Consolas", shading: { type: ShadingType.CLEAR, fill: GRIS_CLARO, color: "auto" } }));
    ultimo = m.index + t.length;
  }
  if (ultimo < texto.length) partes.push(new TextRun({ text: texto.slice(ultimo), ...base }));
  return partes;
}

function fondoDePagina(archivo) {
  return new ImageRun({
    type: "png",
    data: fs.readFileSync(path.join(recursos, archivo)),
    transformation: { width: 960, height: 960 },
    floating: {
      horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, offset: 0 },
      verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, offset: 0 },
      behindDocument: true,
      allowOverlap: true,
    },
    altText: { title: "Fondo decorativo", description: "Fondo decorativo con círculos", name: archivo },
  });
}

function tituloDiapositiva(texto, tamano = 38) {
  const [a, b] = PARTES_TITULO[texto] ?? [texto.replace(/\S+$/, ""), texto.match(/\S+$/)[0]];
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    pageBreakBefore: true,
    spacing: { before: 0, after: 280 },
    children: [
      new TextRun({ text: a, font: TITULOS, size: pt(tamano), bold: true, color: CARBON }),
      new TextRun({ text: b, font: TITULOS, size: pt(tamano), bold: true, color: AZUL }),
    ],
  });
}

function tabla(filas) {
  const n = filas[0].length;
  const largos = filas[0].map((_, c) => Math.max(...filas.map((f) => (f[c] ?? "").replace(/\*\*|`/g, "").length), 8));
  const total = largos.reduce((a, b) => a + b, 0);
  // Columnas de casillas (☐) angostas; el resto, según el largo del texto.
  const esCasilla = filas[0].map((_, c) => filas.slice(1).every((f) => (f[c] ?? "") === "\u2610") && filas.length > 1);
  // Columnas para completar a mano (vacías): ancho fijo para escribir.
  const esVacia = filas[0].map((_, c) => filas.length > 1 && filas.slice(1).every((f) => !(f[c] ?? "").trim()));
  let anchos = largos.map((l, c) => esCasilla[c] ? 1050 : Math.max(c === 0 ? 1500 : 1800, esVacia[c] ? 2600 : 0, Math.round((ANCHO * l) / total)));
  const suma = anchos.reduce((a, b) => a + b, 0);
  const fijo = anchos.reduce((s, a, c) => s + (esCasilla[c] || esVacia[c] ? a : 0), 0);
  const variable = suma - fijo;
  anchos = anchos.map((a, c) => esCasilla[c] || esVacia[c] ? a : Math.floor((a * (ANCHO - fijo)) / variable));
  anchos[n - 1] += ANCHO - anchos.reduce((a, b) => a + b, 0);
  const celda = (texto, c, fila) => {
    const encabezado = fila === 0;
    const base = encabezado
      ? { font: TEXTO, size: pt(13), bold: true, color: BLANCO }
      : c === 0 ? { font: TEXTO, size: pt(12.5), bold: true, color: AZUL } : { font: TEXTO, size: pt(12.5), color: CARBON };
    return new TableCell({
      width: { size: anchos[c], type: WidthType.DXA },
      shading: encabezado ? { type: ShadingType.CLEAR, fill: AZUL, color: "auto" }
        : { type: ShadingType.CLEAR, fill: fila % 2 === 0 ? GRIS_CLARO : BLANCO, color: "auto" },
      margins: { top: 100, bottom: 100, left: 140, right: 140 },
      borders: { top: bordeTabla, bottom: bordeTabla, left: bordeTabla, right: bordeTabla },
      verticalAlign: VerticalAlign.CENTER,
      children: [new Paragraph({ alignment: texto === "\u2610" ? AlignmentType.CENTER : AlignmentType.LEFT, spacing: { before: 0, after: 0 },
        children: runs(texto, texto === "\u2610" ? { ...base, size: pt(16), color: AZUL } : base) })],
    });
  };
  return new Table({
    width: { size: ANCHO, type: WidthType.DXA },
    columnWidths: anchos,
    layout: TableLayoutType.FIXED,
    rows: filas.map((f, r) => new TableRow({ tableHeader: r === 0, cantSplit: true, children: filas[0].map((_, c) => celda(f[c] ?? "", c, r)) })),
  });
}

function recuadroMensaje(texto, k) {
  const e = ESTILOS_MENSAJE[k % ESTILOS_MENSAJE.length];
  return new Table({
    width: { size: ANCHO, type: WidthType.DXA },
    columnWidths: [ANCHO],
    rows: [new TableRow({ cantSplit: true, children: [new TableCell({
      width: { size: ANCHO, type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, fill: e.fondo, color: "auto" },
      borders: sinBordes,
      margins: { top: 220, bottom: 220, left: 300, right: 300 },
      children: [new Paragraph({ spacing: { before: 0, after: 0 }, children: [new TextRun({ text: texto, font: TEXTO, size: pt(15), bold: true, color: e.texto })] })],
    })] })],
  });
}

// Tarjetas de cifras clave (lavanda pastel, número grande en azul Francia).
function cifrasClave(items) {
  const anchoTarjeta = Math.floor((ANCHO - 2 * 240) / 3);
  const columnas = [anchoTarjeta, 240, anchoTarjeta, 240, ANCHO - 2 * anchoTarjeta - 480];
  const tarjeta = (numero, rotulo, ancho) => new TableCell({
    width: { size: ancho, type: WidthType.DXA },
    shading: { type: ShadingType.CLEAR, fill: LAVANDA, color: "auto" },
    borders: sinBordes,
    margins: { top: 200, bottom: 200, left: 220, right: 220 },
    children: [
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 0 }, children: [new TextRun({ text: numero, font: TITULOS, size: pt(52), bold: true, color: AZUL })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 0 }, children: [new TextRun({ text: rotulo, font: TEXTO, size: pt(14), color: CARBON })] }),
    ],
  });
  const separador = (ancho) => new TableCell({ width: { size: ancho, type: WidthType.DXA }, borders: sinBordes, children: [new Paragraph({ children: [] })] });
  return new Table({
    width: { size: ANCHO, type: WidthType.DXA },
    columnWidths: columnas,
    layout: TableLayoutType.FIXED,
    borders: { insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "auto" }, insideVertical: { style: BorderStyle.NONE, size: 0, color: "auto" } },
    rows: [new TableRow({ cantSplit: true, children: [
      tarjeta(items[0][0], items[0][1], columnas[0]), separador(240),
      tarjeta(items[1][0], items[1][1], columnas[2]), separador(240),
      tarjeta(items[2][0], items[2][1], columnas[4]),
    ] })],
  });
}

// Comandos para copiar: fondo carbón, letra monoespaciada en blanco.
function recuadroCodigo(lineas) {
  return new Table({
    width: { size: ANCHO, type: WidthType.DXA },
    columnWidths: [ANCHO],
    rows: [new TableRow({ cantSplit: true, children: [new TableCell({
      width: { size: ANCHO, type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, fill: CARBON, color: "auto" },
      borders: sinBordes,
      margins: { top: 160, bottom: 160, left: 260, right: 260 },
      children: lineas.map((l) => new Paragraph({ spacing: { before: 0, after: 40 },
        children: [new TextRun({ text: l || " ", font: "Consolas", size: pt(12), color: BLANCO })] })),
    })] })],
  });
}

// Casilla para marcar el paso: OK / con error y espacio para observaciones.
function casillaVerificacion(texto) {
  const a = Math.round(ANCHO * 0.42), b = ANCHO - a;
  const celda = (ancho, hijos, fondo) => new TableCell({
    width: { size: ancho, type: WidthType.DXA },
    shading: { type: ShadingType.CLEAR, fill: fondo, color: "auto" },
    borders: sinBordes,
    margins: { top: 120, bottom: 120, left: 220, right: 220 },
    verticalAlign: VerticalAlign.CENTER,
    children: hijos,
  });
  return new Table({
    width: { size: ANCHO, type: WidthType.DXA },
    columnWidths: [a, b],
    layout: TableLayoutType.FIXED,
    rows: [new TableRow({ cantSplit: true, children: [
      celda(a, [new Paragraph({ spacing: { before: 0, after: 0 }, children: [
        new TextRun({ text: "\u2610 OK    \u2610 Con error", font: TEXTO, size: pt(13), bold: true, color: CARBON }),
      ] }), new Paragraph({ spacing: { before: 40, after: 0 }, children: runs(texto, { font: TEXTO, size: pt(11), color: GRIS_TEXTO }) })], LAVANDA_CLARO),
      celda(b, [new Paragraph({ spacing: { before: 0, after: 0 }, children: [
        new TextRun({ text: "Observaciones:", font: TEXTO, size: pt(11), color: GRIS_TEXTO }),
      ] }), new Paragraph({ spacing: { before: 200, after: 0 }, border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: GRIS_BORDE, space: 2 } }, children: [] })], GRIS_CLARO),
    ] })],
  });
}

// Nota importante: panel lavanda claro con texto carbón en negrita.
function notaDestacada(texto) {
  return new Table({
    width: { size: ANCHO, type: WidthType.DXA },
    columnWidths: [ANCHO],
    rows: [new TableRow({ cantSplit: true, children: [new TableCell({
      width: { size: ANCHO, type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, fill: LAVANDA_CLARO, color: "auto" },
      borders: { ...sinBordes, left: { style: BorderStyle.SINGLE, size: 36, color: AZUL } },
      margins: { top: 160, bottom: 160, left: 260, right: 260 },
      children: [new Paragraph({ spacing: { before: 0, after: 0 }, children: runs(texto, { font: TEXTO, size: pt(13), bold: true, color: CARBON }) })],
    })] })],
  });
}

const espacio = (despues = 200) => new Paragraph({ spacing: { before: 0, after: despues }, children: [] });

// --- Contenido a partir del Markdown ---
const md = fs.readFileSync(entrada, "utf8").split("\n");
const secciones = md.filter((l) => l.startsWith("## ")).map((l) => l.slice(3).trim());
const bloques = [];
let refLista = 0, i = 0, numeroSeccion = -1, seccionActual = null;

function cerrarSeccion() {
  if (seccionActual === null) return;
  if (CONFIG.cifras && seccionActual === CONFIG.cifras.seccion) {
    bloques.push(espacio(160));
    bloques.push(cifrasClave(CONFIG.cifras.items));
  }
  if (MENSAJES[seccionActual]) {
    bloques.push(espacio(240));
    bloques.push(recuadroMensaje(MENSAJES[seccionActual], numeroSeccion));
  }
}

const cuerpo = { font: TEXTO, size: pt(13), color: CARBON };
while (i < md.length) {
  const linea = md[i];
  if (!linea.trim() || linea.startsWith("# ") || /^Versión del/.test(linea)) { i++; continue; }
  if (linea.startsWith("## ")) {
    cerrarSeccion();
    seccionActual = linea.slice(3).trim();
    numeroSeccion++;
    bloques.push(tituloDiapositiva(seccionActual));
    i++; continue;
  }
  if (linea.startsWith("### ")) {
    bloques.push(new Paragraph({ heading: HeadingLevel.HEADING_2, keepNext: true, spacing: { before: 280, after: 120 },
      children: [new TextRun({ text: linea.slice(4).trim(), font: TITULOS, size: pt(22), bold: true, color: AZUL })] }));
    i++; continue;
  }
  if (linea.startsWith("```")) {
    const lineas = [];
    i++;
    while (i < md.length && !md[i].startsWith("```")) lineas.push(md[i++]);
    i++;
    bloques.push(recuadroCodigo(lineas));
    bloques.push(espacio(120));
    continue;
  }
  if (/^- \[ \] /.test(linea)) {
    bloques.push(casillaVerificacion(linea.slice(6)));
    bloques.push(espacio(80));
    i++; continue;
  }
  if (linea.startsWith("> ")) {
    bloques.push(notaDestacada(linea.slice(2)));
    bloques.push(espacio(120));
    i++; continue;
  }
  const img = /^!\[([^\]]*)\]\(([^)]+)\)/.exec(linea);
  if (img) {
    const ancho = Math.round(8.8 * 96), alto = Math.round((ancho * 600) / 1344);
    bloques.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 160, after: 80 },
      children: [new ImageRun({ type: "png", data: fs.readFileSync(path.join(carpetaMd, img[2])), transformation: { width: ancho, height: alto },
        altText: { title: img[1], description: img[1], name: "diagrama" } })] }));
    bloques.push(new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text: `Fuente: ${img[1]}.`, font: TEXTO, size: pt(11), color: GRIS_TEXTO })] }));
    i++; continue;
  }
  if (linea.startsWith("|")) {
    const filas = [];
    while (i < md.length && md[i].startsWith("|")) {
      const celdas = md[i].trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      if (!celdas.every((c) => /^-+$/.test(c))) filas.push(celdas);
      i++;
    }
    bloques.push(tabla(filas));
    bloques.push(espacio(160));
    continue;
  }
  if (/^- /.test(linea)) {
    while (i < md.length && /^- /.test(md[i])) {
      bloques.push(new Paragraph({ numbering: { reference: "viñetas", level: 0 }, spacing: { after: 100 }, children: runs(md[i].slice(2), cuerpo) }));
      i++;
    }
    continue;
  }
  if (/^\d+\. /.test(linea)) {
    const ref = `numeros-${refLista++}`;
    while (i < md.length && /^\d+\. /.test(md[i])) {
      bloques.push(new Paragraph({ numbering: { reference: ref, level: 0 }, spacing: { after: 100 }, children: runs(md[i].replace(/^\d+\. /, ""), cuerpo) }));
      i++;
    }
    continue;
  }
  // La línea final que remite a GUIA.md va como nota al pie del contenido.
  if (/GUIA\.md/.test(linea)) {
    bloques.push(new Paragraph({ spacing: { before: 120, after: 0 }, children: runs(linea, { font: TEXTO, size: pt(11), color: GRIS_TEXTO }) }));
    i++; continue;
  }
  bloques.push(new Paragraph({ spacing: { after: 160 }, children: runs(linea, cuerpo) }));
  i++;
}
cerrarSeccion();

// --- Portada ---
const portada = [
  new Paragraph({ spacing: { before: 0, after: 0 }, children: [fondoDePagina("portada.png")] }),
  new Paragraph({ spacing: { before: 2600, after: 360 }, children: [new TextRun({ text: "COMPROBANTEPY", font: TEXTO, size: pt(14), bold: true, color: AZUL, characterSpacing: 40 })] }),
  new Paragraph({ spacing: { before: 0, after: 120, line: 240, lineRule: LineRuleType.AUTO }, children: [
    new TextRun({ text: CONFIG.portada[0], font: TITULOS, size: pt(54), bold: true, color: CARBON }),
    new TextRun({ text: CONFIG.portada[1], font: TITULOS, size: pt(54), bold: true, color: AZUL }),
  ] }),
  new Paragraph({ spacing: { before: 120, after: 480 }, children: [new TextRun({ text: CONFIG.subtitulo, font: TEXTO, size: pt(17), color: CARBON })] }),
  new Paragraph({ spacing: { before: 0, after: 0 }, children: [new TextRun({ text: "  Recepción, validación y exportación de comprobantes a Marangatu (DNIT)  ", font: TEXTO, size: pt(12), bold: true, color: CARBON, shading: { type: ShadingType.CLEAR, fill: VERDE, color: "auto" } })] }),
  new Paragraph({ spacing: { before: 2400, after: 0 }, children: [new TextRun({ text: "Versión del 10/10/2026", font: TEXTO, size: pt(12), color: CARBON })] }),
];

// --- Agenda ---
const agenda = [
  new Paragraph({ children: [new PageBreak()] }),
  new Paragraph({ spacing: { before: 0, after: 0 }, children: [fondoDePagina("agenda.png")] }),
  new Paragraph({ spacing: { before: 0, after: 360 }, children: [
    new TextRun({ text: CONFIG.agenda[0], font: TITULOS, size: pt(46), bold: true, color: CARBON }),
    new TextRun({ text: CONFIG.agenda[1], font: TITULOS, size: pt(46), bold: true, color: AZUL }),
  ] }),
  ...secciones.map((s, k) => new Paragraph({ spacing: { before: 0, after: 200 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: GRIS_BORDE, space: 6 } },
    children: [
      new TextRun({ text: String(k + 1).padStart(2, "0"), font: TITULOS, size: pt(26), bold: true, color: AZUL }),
      new TextRun({ text: "    " + s, font: TEXTO, size: pt(16), color: CARBON }),
    ] })),
];

// --- Cierre ---
const cierre = [
  new Paragraph({ children: [new PageBreak()] }),
  new Paragraph({ spacing: { before: 0, after: 0 }, children: [fondoDePagina("cierre.png")] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 3400, after: 240 }, children: [
    new TextRun({ text: CONFIG.cierre[0], font: TITULOS, size: pt(54), bold: true, color: CARBON }),
    new TextRun({ text: CONFIG.cierre[1], font: TITULOS, size: pt(54), bold: true, color: AZUL }),
  ] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 360 }, children: [new TextRun({ text: CONFIG.cierreTexto, font: TEXTO, size: pt(15), color: CARBON })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `  ${CONFIG.cierreNota}  `, font: TEXTO, size: pt(13), bold: true, color: CARBON, shading: { type: ShadingType.CLEAR, fill: VERDE, color: "auto" } })] }),
];

const numeraciones = [
  { reference: "viñetas", levels: [{ level: 0, format: LevelFormat.BULLET, text: "●", alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: 460, hanging: 300 } }, run: { color: AZUL, size: pt(10) } } }] },
  ...Array.from({ length: refLista }, (_, k) => ({ reference: `numeros-${k}`, levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.",
    alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 520, hanging: 400 } }, run: { color: AZUL, bold: true, font: TITULOS, size: pt(15) } } }] })),
];

const pie = new Footer({ children: [new Paragraph({ children: [
  new TextRun({ text: CONFIG.titulo.replace(" – ", " · "), font: TEXTO, size: pt(10), color: GRIS_TEXTO }),
  new TextRun({ children: [new PositionalTab({ alignment: PositionalTabAlignment.RIGHT, relativeTo: PositionalTabRelativeTo.MARGIN, leader: PositionalTabLeader.NONE })] }),
  new TextRun({ children: [PageNumber.CURRENT], font: TEXTO, size: pt(10), color: GRIS_TEXTO }),
] })] });

// Etiqueta en píldora verde, arriba a la derecha.
const encabezado = new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [
  new TextRun({ text: `  ${CONFIG.etiqueta}  `, font: TEXTO, size: pt(10), bold: true, color: CARBON, shading: { type: ShadingType.CLEAR, fill: VERDE, color: "auto" } }),
] })] });

const doc = new Document({
  creator: "ComprobantePy",
  title: CONFIG.titulo,
  styles: {
    default: { document: { run: { font: TEXTO, size: pt(13), color: CARBON }, paragraph: { spacing: { line: 276, lineRule: LineRuleType.AUTO } } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { font: TITULOS, size: pt(38), bold: true, color: CARBON }, paragraph: { outlineLevel: 0, keepNext: true } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { font: TITULOS, size: pt(22), bold: true, color: AZUL }, paragraph: { outlineLevel: 1, keepNext: true } },
    ],
  },
  numbering: { config: numeraciones },
  sections: [{
    properties: {
      titlePage: true,
      page: {
        size: { width: LADO, height: LADO },
        margin: { top: Math.round(0.85 * PULGADA), bottom: Math.round(0.95 * PULGADA), left: MARGEN_LATERAL, right: MARGEN_LATERAL,
          header: Math.round(0.2 * PULGADA), footer: Math.round(0.55 * PULGADA - 0.14 * PULGADA) },
      },
    },
    headers: { default: encabezado, first: new Header({ children: [new Paragraph({ children: [] })] }) },
    footers: { default: pie, first: new Footer({ children: [new Paragraph({ children: [] })] }) },
    children: [...portada, ...agenda, ...bloques, ...cierre],
  }],
});

Packer.toBuffer(doc).then((b) => { fs.writeFileSync(salida, b); console.log("ok", salida, b.length); });
