import { describe, expect, it } from "vitest";
import { egreso, factura, indicadoresIrp } from "./ejemplos.test-utils.js";
import {
  camposCompra,
  camposEgreso,
  validarCompra,
  validarEgreso,
} from "./marangatu.js";

describe("registro de Compras (código 2)", () => {
  it("genera 20 campos en el orden de la sección 18.4 (criterio 22)", () => {
    expect(validarCompra(factura())).toEqual([]);
    expect(camposCompra(factura())).toEqual([
      "2", "11", "80012345", "", "109", "05/03/2026", "12345678", "001-001-0000123",
      "110000", "52500", "10000", "172500", "1", "N", "S", "N", "S", "N", "", "",
    ]);
  });

  it("rechaza total distinto de la suma de importes (criterio 23)", () => {
    const errores = validarCompra(factura({ total: 999 }));
    expect(errores.map((e) => e.campo)).toContain("total");
  });

  it("admite solo total para 101, 104, 105 y 112", () => {
    const ticket = factura({
      tipoComprobante: 112, gravado10: 0, gravado5: 0, exento: 0, total: 50_000, numeroComprobante: null, condicion: null,
    });
    expect(validarCompra(ticket)).toEqual([]);
    expect(validarCompra({ ...ticket, gravado10: 50_000 }).map((e) => e.campo)).toContain("importes");
  });

  it("rechaza fecha anterior a 2021 con condición contado, pero la admite a crédito (criterio 23)", () => {
    expect(validarCompra(factura({ fechaEmision: "2020-12-31" })).map((e) => e.campo)).toContain("fechaEmision");
    expect(validarCompra(factura({ fechaEmision: "2020-12-31", condicion: 2 }))).toEqual([]);
  });

  it("exige comprobante asociado en notas de crédito y débito (criterio 23)", () => {
    const nota = factura({ tipoComprobante: 110 });
    expect(validarCompra(nota).map((e) => e.campo)).toEqual(["numeroAsociado", "timbradoAsociado"]);
    const completa = factura({ tipoComprobante: 110, numeroAsociado: "001-001-0000100", timbradoAsociado: 12345678 });
    expect(validarCompra(completa)).toEqual([]);
    expect(camposCompra(completa).slice(18)).toEqual(["001-001-0000100", "12345678"]);
  });

  it("rechaza un comprobante sin obligación imputada y No imputa sin otra obligación (criterio 23)", () => {
    const sinObligacion = factura({ indicadores: { imputaIva: false, imputaIre: false, imputaIrpRsp: false, noImputa: false } });
    expect(validarCompra(sinObligacion).map((e) => e.campo)).toContain("imputacion");
    const soloNoImputa = factura({ indicadores: { imputaIva: false, imputaIre: false, imputaIrpRsp: false, noImputa: true } });
    expect(validarCompra(soloNoImputa)[0]?.mensaje).toContain("No imputa");
  });

  it("rechaza RUC con DV en el archivo", () => {
    expect(validarCompra(factura({ numeroIdentificacionProveedor: "80012345-6" })).map((e) => e.campo)).toContain(
      "numeroIdentificacionProveedor",
    );
  });

  it("despacho de importación usa timbrado 0", () => {
    const despacho = factura({
      tipoComprobante: 107, timbrado: 0, numeroComprobante: null, tipoIdentificacionProveedor: 17,
      numeroIdentificacionProveedor: "EXT123", razonSocialProveedor: "Proveedor del exterior",
    });
    expect(validarCompra(despacho)).toEqual([]);
    expect(camposCompra(despacho)[3]).toBe("Proveedor del exterior");
    expect(camposCompra(despacho)[6]).toBe("0");
  });

  it("quita tabulaciones y saltos de línea de los textos", () => {
    const campos = camposCompra(factura({
      tipoComprobante: 101, tipoIdentificacionProveedor: 12, gravado10: 0, gravado5: 0, exento: 0,
    }));
    expect(campos.every((c) => !/[\t\n]/.test(c))).toBe(true);
  });
});

describe("registro de Egresos (código 4)", () => {
  it("genera 18 campos en el orden de la sección 18.5 (criterio 22)", () => {
    expect(validarEgreso(egreso())).toEqual([]);
    expect(camposEgreso(egreso())).toEqual([
      "4", "209", "10/03/2026", "R-555", "11", "80054321", "", "250000",
      "N", "N", "S", "N", "", "", "", "Recibo de cuota", "", "",
    ]);
  });

  it("rechaza Imputa al IVA en egresos distintos de 207 (criterio 23)", () => {
    const conIva = egreso({ indicadores: { ...indicadoresIrp, imputaIva: true } });
    expect(validarEgreso(conIva).map((e) => e.campo)).toContain("imputaIva");
  });

  it("admite Imputa al IVA en extractos TC/TD (207) con cuenta y entidad", () => {
    const extracto = egreso({
      tipoComprobante: 207, numeroComprobante: null, tipoIdentificacionReceptor: null, numeroIdentificacionReceptor: null,
      indicadores: { ...indicadoresIrp, imputaIva: true }, razonSocialReceptor: "Pago de tarjeta", numeroCuenta: "1234", entidadFinanciera: "Banco Ejemplo",
      especificarTipoDocumento: null,
    });
    expect(validarEgreso(extracto)).toEqual([]);
    const campos = camposEgreso(extracto);
    expect(campos[8]).toBe("S");
    expect(campos.slice(12, 14)).toEqual(["1234", "Banco Ejemplo"]);
  });

  it("usa mm/aaaa para el extracto de IPS (206) y exige número patronal", () => {
    const ips = egreso({
      tipoComprobante: 206, numeroComprobante: null, tipoIdentificacionReceptor: null, numeroIdentificacionReceptor: null,
      especificarTipoDocumento: null,
    });
    expect(validarEgreso(ips).map((e) => e.campo)).toEqual(["numeroPatronalIps"]);
    const completo = { ...ips, numeroPatronalIps: "99887" };
    expect(validarEgreso(completo)).toEqual([]);
    expect(camposEgreso(completo)[2]).toBe("03/2026");
  });

  it("exige la compra asociada en el tipo 201", () => {
    const pago = egreso({ tipoComprobante: 201, especificarTipoDocumento: null });
    expect(validarEgreso(pago).map((e) => e.campo)).toEqual(["numeroCompraAsociada", "timbradoCompraAsociada"]);
  });
});
