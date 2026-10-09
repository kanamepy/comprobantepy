/** Servidor clamd mínimo para pruebas: detecta la marca «EICAR-PRUEBA» en lo enviado. */
import { createServer, type AddressInfo, type Server } from "node:net";

export async function iniciarClamdSimulado(): Promise<{ servidor: Server; puerto: number; recibidos: Buffer[] }> {
  const recibidos: Buffer[] = [];
  const servidor = createServer((socket) => {
    let pendiente = Buffer.alloc(0);
    let contenido = Buffer.alloc(0);
    let comandoLeido = false;
    socket.on("data", (dato) => {
      pendiente = Buffer.concat([pendiente, dato]);
      if (!comandoLeido) {
        const fin = pendiente.indexOf(0);
        if (fin < 0) return;
        if (pendiente.subarray(0, fin).toString() !== "zINSTREAM") return socket.end("UNKNOWN COMMAND\0");
        pendiente = pendiente.subarray(fin + 1);
        comandoLeido = true;
      }
      while (pendiente.length >= 4) {
        const largo = pendiente.readUInt32BE(0);
        if (largo === 0) {
          recibidos.push(contenido);
          const infectado = contenido.includes("EICAR-PRUEBA");
          socket.end(infectado ? "stream: Eicar-Test-Signature FOUND\0" : "stream: OK\0");
          return;
        }
        if (pendiente.length < 4 + largo) return;
        contenido = Buffer.concat([contenido, pendiente.subarray(4, 4 + largo)]);
        pendiente = pendiente.subarray(4 + largo);
      }
    });
  });
  await new Promise<void>((listo) => servidor.listen(0, "127.0.0.1", listo));
  return { servidor, puerto: (servidor.address() as AddressInfo).port, recibidos };
}
