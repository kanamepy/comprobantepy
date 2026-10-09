import { describe, expect, it } from "vitest";
import { calcularElegibilidad, accionesDisponibles } from "./estados.js";
import { estadoAutomatico, evaluarComprobante, esBloqueante, type ComprobanteEvaluable } from "./evaluacion.js";

function comprobante(cambios: Partial<ComprobanteEvaluable> = {}): ComprobanteEvaluable {
  return {
    id: "1",
    contribuyenteId: 1,
    naturaleza: "FISICO",
    tipoComprobante: 109,
    proveedor: { estado: "CONFIRMADO", tipoIdentificacion: 11, numeroIdentificacion: "1234567", dv: 9, razonSocial: "Proveedor" },
    timbrado: 12345678,
    estadoTimbrado: "VALIDO",
    numero: "001-001-0000123",
    fechaEmision: "2026-03-05",
    moneda: "PYG",
    tipoCambio: null,
    condicion: 1,
    gravado10: "110000",
    gravado5: "0",
    exento: "0",
    total: "110000",
    asociadoNumero: null,
    asociadoTimbrado: null,
    asociadoCdc: null,
    tieneNumeroCuenta: false,
    numeroCuentaExportable: null,
    entidadFinanciera: null,
    numeroPatronalIps: null,
    especificarTipoDocumento: null,
    imputacion: { lineas: [{ obligacion: "IRP_RSP", porcentaje: 100 }], porcentajeNoImputado: 0 },
    obligacionesActivas: new Set(["IRP_RSP", "IVA"]),
    posibleDuplicadoPendiente: false,
    ...cambios,
  };
}

const codigos = (c: ComprobanteEvaluable) => evaluarComprobante(c).map((p) => p.codigo);

describe("evaluarComprobante", () => {
  it("un comprobante completo no tiene problemas", () => {
    expect(evaluarComprobante(comprobante())).toEqual([]);
    expect(estadoAutomatico([])).toBe("PENDIENTE_DE_REVISION");
  });

  it("sin contribuyente queda pendiente de asignación", () => {
    const problemas = evaluarComprobante(comprobante({ contribuyenteId: null }));
    expect(estadoAutomatico(problemas)).toBe("PENDIENTE_ASIGNACION_CONTRIBUYENTE");
  });

  it("proveedor pendiente bloquea (criterio 17)", () => {
    const c = comprobante({ proveedor: { ...comprobante().proveedor!, estado: "PENDIENTE_DE_CONFIRMAR" } });
    const problemas = evaluarComprobante(c);
    expect(problemas.some(esBloqueante)).toBe(true);
    expect(estadoAutomatico(problemas)).toBe("PENDIENTE_CONFIRMACION_PROVEEDOR");
  });

  it("RUC con DV incorrecto es error bloqueante (criterio 16)", () => {
    expect(codigos(comprobante({ proveedor: { ...comprobante().proveedor!, dv: 8 } }))).toContain("RUC_DV_INVALIDO");
  });

  it("faltan datos → PENDIENTE_DATOS", () => {
    const problemas = evaluarComprobante(comprobante({ timbrado: null, total: null }));
    expect(problemas.map((p) => p.codigo)).toEqual(expect.arrayContaining(["SIN_TIMBRADO", "SIN_TOTAL"]));
    expect(estadoAutomatico(problemas)).toBe("PENDIENTE_DATOS");
  });

  it("aplica las reglas del archivo Marangatu a los físicos", () => {
    expect(codigos(comprobante({ total: "999" }))).toContain("MARANGATU_TOTAL");
    expect(codigos(comprobante({ condicion: null }))).toContain("MARANGATU_CONDICION");
  });

  it("no aplica las reglas del archivo a los electrónicos", () => {
    expect(codigos(comprobante({ naturaleza: "ELECTRONICO", total: "999" }))).toEqual([]);
  });

  it("naturaleza no determinada bloquea la aprobación (regla 5)", () => {
    expect(codigos(comprobante({ naturaleza: "NO_DETERMINADA" }))).toContain("NATURALEZA_NO_DETERMINADA");
  });

  it("sin imputación falta un dato; obligación inactiva es error", () => {
    const sin = evaluarComprobante(comprobante({ imputacion: { lineas: [], porcentajeNoImputado: 0 } }));
    expect(sin.find((p) => p.codigo === "IMPUTACION")?.severidad).toBe("FALTA_DATO");
    const inactiva = evaluarComprobante(comprobante({ obligacionesActivas: new Set(["IVA"]) }));
    expect(inactiva.find((p) => p.codigo === "IMPUTACION")?.severidad).toBe("ERROR");
  });

  it("timbrado no verificado es solo advertencia; rechazado bloquea (criterio 18)", () => {
    const noVerificado = evaluarComprobante(comprobante({ estadoTimbrado: "NO_VERIFICADO" }));
    expect(noVerificado.map((p) => p.severidad)).toEqual(["ADVERTENCIA"]);
    expect(codigos(comprobante({ estadoTimbrado: "ERROR_DE_CONSULTA" }))).not.toContain("TIMBRADO_RECHAZADO");
    expect(evaluarComprobante(comprobante({ estadoTimbrado: "RECHAZADO" })).some(esBloqueante)).toBe(true);
  });

  it("convierte moneda extranjera con el tipo de cambio", () => {
    const usd = comprobante({ moneda: "USD", tipoCambio: "7300", gravado10: "10", total: "10" });
    expect(evaluarComprobante(usd)).toEqual([]);
    expect(codigos({ ...usd, tipoCambio: null })).toContain("SIN_TIPO_CAMBIO");
  });

  it("nota de crédito sin asociado", () => {
    expect(codigos(comprobante({ tipoComprobante: 110 }))).toContain("SIN_ASOCIADO");
  });

  it("posible duplicado pendiente", () => {
    const problemas = evaluarComprobante(comprobante({ posibleDuplicadoPendiente: true }));
    expect(estadoAutomatico(problemas)).toBe("POSIBLE_DUPLICADO");
  });
});

describe("estados", () => {
  it("el auxiliar no aprueba ni anula", () => {
    expect(accionesDisponibles("CONFIRMADO", ["AUXILIAR"])).toEqual(["OBSERVAR"]);
    expect(accionesDisponibles("CONFIRMADO", ["FINANCIERO"])).toEqual(["APROBAR", "OBSERVAR", "RECHAZAR", "ANULAR"]);
    expect(accionesDisponibles("ANULADO", ["FINANCIERO"])).toEqual([]);
  });

  it("elegibilidad Marangatu (sección 15.3)", () => {
    const base = { naturaleza: "FISICO" as const, tipoComprobante: 109, estadoFlujo: "APROBADO" as const, tieneBloqueantes: false };
    expect(calcularElegibilidad(base).estado).toBe("ELEGIBLE");
    expect(calcularElegibilidad({ ...base, naturaleza: "ELECTRONICO" }).estado).toBe("NO_APLICA_ELECTRONICO");
    expect(calcularElegibilidad({ ...base, naturaleza: "VIRTUAL" }).estado).toBe("NO_APLICA_VIRTUAL");
    expect(calcularElegibilidad({ ...base, estadoFlujo: "CONFIRMADO" }).estado).toBe("NO_ELEGIBLE");
    expect(calcularElegibilidad({ ...base, tipoComprobante: 999 }).estado).toBe("NO_EXPORTABLE");
  });
});
