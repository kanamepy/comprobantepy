import { describe, expect, it } from "vitest";
import { esCdcValido, parsearCdc } from "./cdc.js";
import { CDC_EJEMPLO, DV_EMISOR, xmlSifenEjemplo } from "./ejemplos.test-utils.js";
import { determinarNaturaleza } from "./naturaleza.js";
import { esXmlSifen, extraerDeXmlSifen } from "./sifen.js";

describe("CDC", () => {
  it("valida el dígito verificador y decodifica sus partes", () => {
    expect(esCdcValido(CDC_EJEMPLO)).toBe(true);
    expect(parsearCdc(CDC_EJEMPLO)).toMatchObject({
      tipoDocumentoElectronico: 1,
      rucEmisor: "80012345",
      dvEmisor: DV_EMISOR,
      numero: "001-001-0000123",
      fechaEmision: "2026-03-05",
    });
  });

  it("rechaza un CDC alterado", () => {
    const ultimo = Number(CDC_EJEMPLO.at(-1));
    const alterado = CDC_EJEMPLO.slice(0, 43) + String((ultimo + 1) % 10);
    expect(esCdcValido(alterado)).toBe(false);
    expect(parsearCdc("123")).toBeNull();
  });

  it("acepta el CDC agrupado con espacios", () => {
    expect(esCdcValido(CDC_EJEMPLO.replace(/(\d{4})/g, "$1 "))).toBe(true);
  });
});

describe("XML SIFEN (criterio 4)", () => {
  it("reconoce el XML y extrae los datos estructurados con confianza total", () => {
    const xml = xmlSifenEjemplo();
    expect(esXmlSifen(xml)).toBe(true);
    const r = extraerDeXmlSifen(xml);
    expect(r.indicios).toEqual({ xmlSifen: true, cdcValido: true, leyendaVirtual: false });
    expect(r.advertencias).toEqual([]);
    const valores = Object.fromEntries(Object.entries(r.campos).map(([k, v]) => [k, v.valor]));
    expect(valores).toMatchObject({
      cdc: CDC_EJEMPLO,
      tipoComprobante: "109",
      timbrado: "12345678",
      numero: "001-001-0000123",
      fechaEmision: "2026-03-05",
      emisorRuc: "80012345",
      emisorDv: String(DV_EMISOR),
      emisorNombre: "Farmacia Ejemplo S.A.",
      moneda: "PYG",
      condicion: "1",
      receptorTipoIdentificacion: "RUC",
      receptorNumero: "1234567",
      receptorDv: "9",
      gravado10: "110000",
      gravado5: "52500",
      exento: "10000",
      iva10: "10000",
      iva5: "2500",
      total: "172500",
      totalGs: "172500",
    });
    expect(Object.values(r.campos).every((c) => c.fuente === "XML" && c.confianza === 1)).toBe(true);
    expect(determinarNaturaleza(r).naturaleza).toBe("ELECTRONICO");
  });

  it("toma el tipo de cambio en moneda extranjera", () => {
    const r = extraerDeXmlSifen(xmlSifenEjemplo({ moneda: "USD" }));
    expect(r.campos.moneda?.valor).toBe("USD");
    expect(r.campos.tipoCambio?.valor).toBe("7300");
    expect(r.campos.totalGs).toBeUndefined();
  });

  it("informa un XML mal formado o que no es SIFEN", () => {
    expect(extraerDeXmlSifen("<a><b></a>").advertencias[0]).toContain("bien formado");
    const otro = extraerDeXmlSifen("<factura><total>1</total></factura>");
    expect(otro.indicios.xmlSifen).toBe(false);
    expect(otro.advertencias[0]).toContain("no contiene");
  });
});
