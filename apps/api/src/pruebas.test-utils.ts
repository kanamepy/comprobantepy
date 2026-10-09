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
