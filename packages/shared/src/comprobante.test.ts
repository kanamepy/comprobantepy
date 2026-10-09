import { describe, expect, it } from "vitest";
import { fechaIsoADdMmAaaa, fechaIsoAMmAaaa, normalizarNumeroComprobante, parsearFechaIso } from "./comprobante.js";

describe("normalizarNumeroComprobante", () => {
  it.each([
    ["1-1-123", "001-001-0000123"],
    ["001 001 0000123", "001-001-0000123"],
    ["0010010000123", "001-001-0000123"],
    ["001001000012", null],
    ["001-001-0000123", "001-001-0000123"],
    ["1-1-12345678", null],
    ["abc", null],
  ])("%s → %s", (entrada, esperado) => {
    expect(normalizarNumeroComprobante(entrada)).toBe(esperado);
  });
});

describe("fechas", () => {
  it("formatea para el archivo", () => {
    expect(fechaIsoADdMmAaaa("2026-03-05")).toBe("05/03/2026");
    expect(fechaIsoAMmAaaa("2026-03-05")).toBe("03/2026");
  });

  it("rechaza fechas inexistentes", () => {
    expect(parsearFechaIso("2026-02-30")).toBeNull();
    expect(parsearFechaIso("05/03/2026")).toBeNull();
  });
});
