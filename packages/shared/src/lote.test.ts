import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { generarLote, nombreBaseArchivo, siguienteIdentificador } from "./lote.js";
import { egreso, factura } from "./ejemplos.test-utils.js";

const opciones = {
  rucInformante: "1234567",
  obligacion: "955" as const,
  periodo: { anio: 2026, mes: 3 },
  identificadoresUsados: new Set<string>(),
};

describe("nombre del archivo (sección 18.3)", () => {
  it("registro mensual 955", () => {
    expect(nombreBaseArchivo("1234567", "955", { anio: 2026, mes: 3 }, "V0001")).toBe("1234567_REG_032026_V0001");
  });

  it("registro anual 956", () => {
    expect(nombreBaseArchivo("1234567", "956", { anio: 2026 }, "V0001")).toBe("1234567_REG_2026_V0001");
  });

  it("rechaza RUC con DV e identificadores largos", () => {
    expect(() => nombreBaseArchivo("1234567-9", "956", { anio: 2026 }, "V0001")).toThrow();
    expect(() => nombreBaseArchivo("1234567", "956", { anio: 2026 }, "V00001")).toThrow();
  });

  it("no reutiliza identificadores (criterio 25)", () => {
    expect(siguienteIdentificador("V", new Set(["V0001", "V0002"]))).toBe("V0003");
  });
});

describe("generarLote", () => {
  it("genera TXT con tabulaciones dentro de un ZIP con el mismo nombre base", async () => {
    const resultado = await generarLote([factura(), egreso()], opciones);
    if (!resultado.ok) throw new Error(JSON.stringify(resultado.errores));
    const [archivo] = resultado.archivos;
    expect(archivo?.nombreZip).toBe("1234567_REG_032026_V0001.zip");
    expect(archivo?.nombreArchivo).toBe("1234567_REG_032026_V0001.txt");
    const lineas = archivo!.contenido.split("\n").slice(0, -1);
    expect(lineas.map((l) => l.split("\t").length)).toEqual([20, 18]);

    const zip = await JSZip.loadAsync(archivo!.zip);
    expect(Object.keys(zip.files)).toEqual(["1234567_REG_032026_V0001.txt"]);
    expect(await zip.file("1234567_REG_032026_V0001.txt")!.async("string")).toBe(archivo!.contenido);
    expect(archivo!.sha256Zip).toMatch(/^[0-9a-f]{64}$/);
  });

  it("divide en dos archivos un lote de 5.001 comprobantes (criterio 24)", async () => {
    const registros = Array.from({ length: 5001 }, (_, i) =>
      factura({ id: `c${i}`, numeroComprobante: `001-001-${String(i + 1).padStart(7, "0")}` }),
    );
    const resultado = await generarLote(registros, { ...opciones, identificadoresUsados: new Set(["V0001"]) });
    if (!resultado.ok) throw new Error("no debía fallar");
    expect(resultado.archivos.map((a) => a.nombreBase)).toEqual([
      "1234567_REG_032026_V0002",
      "1234567_REG_032026_V0003",
    ]);
    expect(resultado.archivos.map((a) => a.idsRegistros.length)).toEqual([5000, 1]);
  });

  it("no genera nada si algún registro tiene errores", async () => {
    const resultado = await generarLote([factura(), factura({ id: "malo", total: 1 })], opciones);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.errores.every((e) => e.id === "malo")).toBe(true);
  });

  it("la conciliación coincide con el archivo (criterio 26)", async () => {
    const resultado = await generarLote([factura(), factura({ id: "c2", numeroComprobante: "001-001-0000124" }), egreso()], opciones);
    expect(resultado.conciliacion.cantidadPorTipoRegistro).toEqual({ compras: 2, egresos: 1 });
    expect(resultado.conciliacion.cantidadPorTipoComprobante).toEqual({ 109: 2, 209: 1 });
    expect(resultado.conciliacion.sumas.comprasTotal).toBe(345_000);
    expect(resultado.conciliacion.sumas.egresosTotal).toBe(250_000);
  });

  it("en CSV quita el delimitador de los textos", async () => {
    const resultado = await generarLote(
      [factura({ tipoComprobante: 101, tipoIdentificacionProveedor: 12, gravado10: 0, gravado5: 0, exento: 0 }),
       egreso({ tipoIdentificacionReceptor: 17, razonSocialReceptor: "Uno; Dos", tipoComprobante: 209 })],
      { ...opciones, formato: "CSV", delimitadorCsv: ";" },
    );
    if (!resultado.ok) throw new Error(JSON.stringify(resultado.errores));
    const lineas = resultado.archivos[0]!.contenido.split("\n").slice(0, -1);
    expect(lineas[1]!.split(";")).toHaveLength(18);
    expect(lineas[1]).toContain("Uno  Dos");
  });
});
