import { describe, expect, it } from "vitest";
import { CDC_EJEMPLO } from "./ejemplos.test-utils.js";
import { determinarNaturaleza } from "./naturaleza.js";
import { extraerDeTexto, parsearImporte } from "./texto.js";

const facturaFisica = `
FARMACIA EJEMPLO S.A.
RUC: 1234567-9
Timbrado N°: 12345678   Inicio de vigencia: 01/01/2025
FACTURA   001-001-0000456
Fecha de emisión: 07/03/2026     Condición de venta: Contado
Nombre o Razón Social del cliente: Juan Gómez   RUC: 80000001-?
Señor: Juan Gómez  RUC 3456789-0
Total a pagar: 172.500
Liquidación del IVA (5%) 2.500   (10%) 10.000
`;

describe("parsearImporte", () => {
  it.each([
    ["172.500", "172500"],
    ["1.234.567", "1234567"],
    ["1.234,50", "1234.5"],
    ["Gs. 50.000", "50000"],
    ["12,3.4", undefined],
  ])("%s → %s", (entrada, esperado) => {
    expect(parsearImporte(entrada)).toBe(esperado);
  });
});

describe("extracción desde texto de PDF", () => {
  it("identifica los campos de una factura física, con confianza menor a 1", () => {
    const r = extraerDeTexto(facturaFisica);
    const v = (campo: keyof typeof r.campos) => r.campos[campo]?.valor;
    expect(v("timbrado")).toBe("12345678");
    expect(v("numero")).toBe("001-001-0000456");
    expect(v("fechaEmision")).toBe("2026-03-07");
    expect(v("emisorRuc")).toBe("1234567");
    expect(v("emisorDv")).toBe("9");
    expect(v("total")).toBe("172500");
    expect(v("condicion")).toBe("1");
    expect(v("tipoComprobante")).toBe("109");
    expect(v("emisorNombre")).toBe("FARMACIA EJEMPLO S.A.");
    expect(Object.values(r.campos).every((c) => c.fuente === "PDF_TEXTO" && c.confianza < 1)).toBe(true);
    expect(determinarNaturaleza(r).naturaleza).toBe("NO_DETERMINADA");
  });

  it("un KuDE con CDC impreso se reconoce como electrónico (criterio 5)", () => {
    const kude = `KuDE de Factura Electrónica\nCDC: ${CDC_EJEMPLO.replace(/(\d{4})/g, "$1 ")}\nTotal de la operación: 172.500`;
    const r = extraerDeTexto(kude);
    expect(r.indicios.cdcValido).toBe(true);
    expect(r.campos.numero?.valor).toBe("001-001-0000123");
    expect(r.campos.emisorRuc?.valor).toBe("80012345");
    expect(r.campos.tipoComprobante?.valor).toBe("109");
    expect(determinarNaturaleza(r).naturaleza).toBe("ELECTRONICO");
  });

  it("detecta la leyenda de comprobante virtual", () => {
    const r = extraerDeTexto("COMPROBANTE VIRTUAL\nFactura 001-001-0000001");
    expect(determinarNaturaleza(r).naturaleza).toBe("VIRTUAL");
  });

  it("toma el RUC del receptor después de la palabra cliente o señor", () => {
    const r = extraerDeTexto("Emisor RUC 1234567-9\nCliente: Ana Pérez RUC: 80012345-" + "0");
    expect(r.campos.emisorRuc?.valor).toBe("1234567");
    expect(r.campos.receptorNumero?.valor).toBe("80012345");
  });
});
