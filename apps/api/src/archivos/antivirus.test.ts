import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { analizarConClamav } from "./antivirus.js";
import { iniciarClamdSimulado } from "./clamd-simulado.test-utils.js";

describe("antivirus ClamAV (INSTREAM)", () => {
  let simulado: Awaited<ReturnType<typeof iniciarClamdSimulado>>;
  beforeAll(async () => {
    simulado = await iniciarClamdSimulado();
  });
  afterAll(() => new Promise<void>((listo) => simulado.servidor.close(() => listo())));

  it("envía el archivo completo en bloques y reconoce un archivo limpio", async () => {
    const grande = Buffer.alloc(200 * 1024, 7);
    const r = await analizarConClamav(grande, { host: "127.0.0.1", puerto: simulado.puerto, esperaMs: 5000 });
    expect(r).toEqual({ limpio: true });
    expect(simulado.recibidos.at(-1)!.equals(grande)).toBe(true);
  });

  it("informa la amenaza detectada", async () => {
    const r = await analizarConClamav(Buffer.from("hola EICAR-PRUEBA"), { host: "127.0.0.1", puerto: simulado.puerto, esperaMs: 5000 });
    expect(r).toEqual({ limpio: false, amenaza: "Eicar-Test-Signature" });
  });

  it("falla si el antivirus no está disponible", async () => {
    await expect(analizarConClamav(Buffer.from("x"), { host: "127.0.0.1", puerto: 1, esperaMs: 2000 })).rejects.toThrow();
  });
});
