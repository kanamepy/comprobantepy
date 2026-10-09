import { describe, expect, it } from "vitest";
import { traducirImputacion } from "./imputacion.js";

const activas = new Set(["IVA", "IRP_RSP"]);

describe("traducirImputacion (sección 14.4)", () => {
  it("traduce el ejemplo de la sección 14.3: IVA 100 % e IRP-RSP 70/30", () => {
    const { indicadores, errores } = traducirImputacion(
      {
        lineas: [
          { obligacion: "IVA", actividad: "Servicios profesionales", porcentaje: 100 },
          { obligacion: "IRP_RSP", actividad: "Servicios profesionales", porcentaje: 70 },
          { obligacion: "IRP_RSP", actividad: "Consultoría", porcentaje: 30 },
        ],
        porcentajeNoImputado: 0,
      },
      activas,
    );
    expect(errores).toEqual([]);
    expect(indicadores).toEqual({ imputaIva: true, imputaIre: false, imputaIrpRsp: true, noImputa: false });
  });

  it("marca No imputa cuando queda una parte sin imputar", () => {
    const { indicadores, errores } = traducirImputacion(
      { lineas: [{ obligacion: "IRP_RSP", porcentaje: 60 }], porcentajeNoImputado: 40 },
      activas,
    );
    expect(errores).toEqual([]);
    expect(indicadores.noImputa).toBe(true);
    expect(indicadores.imputaIrpRsp).toBe(true);
  });

  it("rechaza una distribución que no totaliza la parte imputable", () => {
    const { errores } = traducirImputacion(
      { lineas: [{ obligacion: "IRP_RSP", porcentaje: 70 }], porcentajeNoImputado: 0 },
      activas,
    );
    expect(errores[0]).toContain("suma 70 %");
  });

  it("rechaza una obligación inactiva para el informante", () => {
    const { errores } = traducirImputacion(
      { lineas: [{ obligacion: "IRE_SIMPLE", porcentaje: 100 }], porcentajeNoImputado: 0 },
      activas,
    );
    expect(errores.some((e) => e.includes("no está activa"))).toBe(true);
  });

  it("rechaza un comprobante sin ninguna obligación", () => {
    const { errores } = traducirImputacion({ lineas: [], porcentajeNoImputado: 100 }, activas);
    expect(errores).toContain("El comprobante no tiene ninguna obligación imputada");
  });
});
