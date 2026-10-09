import { describe, expect, it } from "vitest";
import { calcularImpuestoPorPorciones, proyectarIrpRsp } from "./irp.js";

describe("IRP-RSP por porciones (sección 20.5)", () => {
  it("caso de control: G. 200.000.000 → G. 18.000.000 (criterio 29)", () => {
    const { impuesto, detalle } = calcularImpuestoPorPorciones(200_000_000);
    expect(detalle.map((d) => d.impuesto)).toEqual([4_000_000, 9_000_000, 5_000_000]);
    expect(impuesto).toBe(18_000_000);
    // Aplicar el 10 % sobre el total sería un error.
    expect(impuesto).not.toBe(20_000_000);
  });

  it("renta en el primer tramo", () => {
    expect(calcularImpuestoPorPorciones(30_000_000).impuesto).toBe(2_400_000);
  });

  it("renta exactamente en el límite de un tramo", () => {
    expect(calcularImpuestoPorPorciones(150_000_000).impuesto).toBe(13_000_000);
  });

  it("renta negativa se muestra como 0 y no genera impuesto (criterio 30)", () => {
    const proyeccion = proyectarIrpRsp({ ingresosGravados: 10_000_000, egresosDeducibles: 25_000_000 });
    expect(proyeccion.rentaNetaCalculada).toBe(-15_000_000);
    expect(proyeccion.rentaNetaImponible).toBe(0);
    expect(proyeccion.impuestoDeterminado).toBe(0);
    expect(proyeccion.detalle).toEqual([]);
  });

  it("saldo proyectado descuenta saldo anterior, retenciones y percepciones", () => {
    const proyeccion = proyectarIrpRsp({
      ingresosGravados: 300_000_000,
      egresosDeducibles: 100_000_000,
      saldoAFavorAnterior: 1_000_000,
      retenciones: 15_000_000,
      percepciones: 500_000,
      ajustesYMultas: 100_000,
    });
    expect(proyeccion.impuestoDeterminado).toBe(18_000_000);
    expect(proyeccion.saldoProyectado).toBe(18_000_000 + 100_000 - 1_000_000 - 15_000_000 - 500_000);
  });
});
