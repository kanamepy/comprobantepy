/** Utilidades para las pruebas de integración. */

/** PDF mínimo válido con una línea de texto por renglón (Helvetica), para probar la lectura de texto digital. */
export function pdfConTexto(lineas: string[]): Buffer {
  const escapar = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const flujo = ["BT", "/F1 10 Tf", "14 TL", "40 800 Td", ...lineas.map((l) => `(${escapar(l)}) Tj T*`), "ET"].join("\n");
  const objetos = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    `<< /Length ${Buffer.byteLength(flujo, "latin1")} >>\nstream\n${flujo}\nendstream`,
  ];
  let salida = "%PDF-1.4\n";
  const posiciones: number[] = [];
  objetos.forEach((objeto, i) => {
    posiciones.push(Buffer.byteLength(salida, "latin1"));
    salida += `${i + 1} 0 obj\n${objeto}\nendobj\n`;
  });
  const inicioXref = Buffer.byteLength(salida, "latin1");
  salida += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  for (const p of posiciones) salida += `${String(p).padStart(10, "0")} 00000 n \n`;
  salida += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${inicioXref}\n%%EOF\n`;
  return Buffer.from(salida, "latin1");
}

/** Cuerpo multipart/form-data para app.inject. */
export function multipart(archivos: { nombre: string; contenido: Buffer; tipo?: string }[], campos: Record<string, string> = {}) {
  const limite = "----limitePrueba" + Math.random().toString(16).slice(2);
  const partes: Buffer[] = [];
  for (const [nombre, valor] of Object.entries(campos)) {
    partes.push(Buffer.from(`--${limite}\r\nContent-Disposition: form-data; name="${nombre}"\r\n\r\n${valor}\r\n`));
  }
  for (const archivo of archivos) {
    partes.push(
      Buffer.from(
        `--${limite}\r\nContent-Disposition: form-data; name="archivos"; filename="${archivo.nombre}"\r\nContent-Type: ${archivo.tipo ?? "application/octet-stream"}\r\n\r\n`,
      ),
      archivo.contenido,
      Buffer.from("\r\n"),
    );
  }
  partes.push(Buffer.from(`--${limite}--\r\n`));
  return { payload: Buffer.concat(partes), headers: { "content-type": `multipart/form-data; boundary=${limite}` } };
}

export interface AdjuntoMime {
  nombre: string;
  tipo: string;
  contenido: Buffer;
  /** Imagen incrustada en el cuerpo (Content-ID). */
  incrustada?: boolean;
}

/** Arma un correo MIME (RFC 822) para las pruebas. */
export function correoMime(opciones: {
  de: string;
  para: string;
  asunto: string;
  texto?: string;
  cabeceras?: Record<string, string>;
  adjuntos?: AdjuntoMime[];
  correoAdjunto?: Buffer;
  messageId?: string;
}): Buffer {
  const limite = "limite" + Math.random().toString(16).slice(2);
  const lineas = [
    `From: ${opciones.de}`,
    `To: ${opciones.para}`,
    `Subject: ${opciones.asunto}`,
    `Date: Thu, 05 Mar 2026 10:00:00 -0300`,
    `Message-ID: <${opciones.messageId ?? Math.random().toString(16).slice(2)}@prueba>`,
    ...Object.entries(opciones.cabeceras ?? {}).map(([k, v]) => `${k}: ${v}`),
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${limite}"`,
    "",
    `--${limite}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    opciones.texto ?? "Adjunto el comprobante.",
  ];
  for (const a of opciones.adjuntos ?? []) {
    lineas.push(
      `--${limite}`,
      `Content-Type: ${a.tipo}; name="${a.nombre}"`,
      a.incrustada ? `Content-Disposition: inline; filename="${a.nombre}"` : `Content-Disposition: attachment; filename="${a.nombre}"`,
      ...(a.incrustada ? [`Content-ID: <${a.nombre}>`] : []),
      "Content-Transfer-Encoding: base64",
      "",
      a.contenido.toString("base64").replace(/.{76}/g, "$&\r\n"),
    );
  }
  if (opciones.correoAdjunto) {
    lineas.push(`--${limite}`, 'Content-Type: message/rfc822; name="original.eml"', 'Content-Disposition: attachment; filename="original.eml"', "", opciones.correoAdjunto.toString("utf8"));
  }
  lineas.push(`--${limite}--`, "");
  return Buffer.from(lineas.join("\r\n"));
}

/** Imagen PNG de un comprobante con las líneas de texto indicadas (y opcionalmente un QR). */
export async function imagenComprobante(lineas: string[], opciones: { qr?: string; ancho?: number; alto?: number } = {}): Promise<Buffer> {
  const { createCanvas, loadImage } = await import("@napi-rs/canvas");
  const ancho = opciones.ancho ?? 1400;
  const alto = opciones.alto ?? 1000;
  const lienzo = createCanvas(ancho, alto);
  const g = lienzo.getContext("2d");
  g.fillStyle = "white";
  g.fillRect(0, 0, ancho, alto);
  g.fillStyle = "black";
  g.font = `${Math.round(ancho / 36)}px sans-serif`;
  lineas.forEach((l, i) => g.fillText(l, ancho * 0.05, alto * 0.1 + i * (ancho / 22)));
  if (opciones.qr) {
    const QRCode = (await import("qrcode")).default;
    const imagenQr = await loadImage(await QRCode.toBuffer(opciones.qr, { width: Math.round(ancho * 0.28), margin: 2 }));
    g.drawImage(imagenQr, ancho * 0.68, alto * 0.55);
  }
  return lienzo.toBuffer("image/png");
}

/** PDF escaneado: una página que solo contiene una imagen JPEG (sin texto digital). */
export function pdfConImagen(jpeg: Buffer, ancho: number, alto: number): Buffer {
  const partes: Buffer[] = [];
  const posiciones: number[] = [];
  let largo = 0;
  const agregar = (b: Buffer | string) => {
    const buf = typeof b === "string" ? Buffer.from(b, "latin1") : b;
    partes.push(buf);
    largo += buf.length;
  };
  const objeto = (n: number, cuerpo: (Buffer | string)[]) => {
    posiciones[n] = largo;
    agregar(`${n} 0 obj\n`);
    cuerpo.forEach(agregar);
    agregar("\nendobj\n");
  };
  const contenido = `q ${595} 0 0 ${Math.round((595 * alto) / ancho)} 0 ${842 - Math.round((595 * alto) / ancho)} cm /Im1 Do Q`;
  agregar("%PDF-1.4\n");
  objeto(1, ["<< /Type /Catalog /Pages 2 0 R >>"]);
  objeto(2, ["<< /Type /Pages /Kids [3 0 R] /Count 1 >>"]);
  objeto(3, ["<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>"]);
  objeto(4, [`<< /Type /XObject /Subtype /Image /Width ${ancho} /Height ${alto} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`, jpeg, "\nendstream"]);
  objeto(5, [`<< /Length ${contenido.length} >>\nstream\n${contenido}\nendstream`]);
  const inicioXref = largo;
  agregar(`xref\n0 6\n0000000000 65535 f \n${posiciones.slice(1).map((p) => `${String(p).padStart(10, "0")} 00000 n \n`).join("")}`);
  agregar(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${inicioXref}\n%%EOF\n`);
  return Buffer.concat(partes);
}
