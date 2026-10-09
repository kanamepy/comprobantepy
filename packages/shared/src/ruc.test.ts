import { describe, expect, it } from "vitest";
import { calcularDV, formatearRuc, separarRuc, validarRuc } from "./ruc.js";

describe("calcularDV (módulo 11 DNIT)", () => {
  it("calcula el DV de un número", () => {
    // 7·2 + 6·3 + 5·4 + 4·5 + 3·6 + 2·7 + 1·8 = 112; 112 mod 11 = 2; 11 − 2 = 9
    expect(calcularDV("1234567")).toBe(9);
  });

  it("devuelve 0 cuando el resto es 0 o 1", () => {
    // 1·2 + 1·3 = 5 → 11 − 5 = 6 ; 5·2 = 10 → 11 − 10 = 1 ; 11·? casos con resto ≤ 1:
    // 6·2 = 12 → resto 1 → 0
    expect(calcularDV("6")).toBe(0);
    // 11 → 1·2 + 1·3 = 5 → 6
    expect(calcularDV("11")).toBe(6);
  });

  it("reinicia el factor en 2 después de la base máxima", () => {
    // 12 dígitos "1": factores 2..11 (suma 65) y luego 2, 3 → 70; 70 mod 11 = 4 → 7
    expect(calcularDV("111111111111")).toBe(7);
  });

  it("reemplaza letras por su código ASCII", () => {
    // "A1" → "651": 1·2 + 5·3 + 6·4 = 41; 41 mod 11 = 8 → 3
    expect(calcularDV("A1")).toBe(3);
    expect(calcularDV("a1")).toBe(3);
  });
});

describe("validarRuc", () => {
  it("acepta un RUC con DV correcto", () => {
    expect(validarRuc("1234567-9")).toMatchObject({ valido: true, numero: "1234567", dv: 9 });
  });

  it("rechaza un DV incorrecto (criterio 16)", () => {
    const resultado = validarRuc("1234567-8");
    expect(resultado.valido).toBe(false);
    expect(resultado.motivo).toContain("se esperaba 9");
  });

  it("rechaza un RUC sin DV", () => {
    expect(validarRuc("1234567").valido).toBe(false);
  });

  it("ignora puntos y espacios", () => {
    expect(separarRuc(" 1.234.567-9 ")).toEqual({ numero: "1234567", dv: 9 });
    expect(formatearRuc("1234567")).toBe("1234567-9");
  });
});
