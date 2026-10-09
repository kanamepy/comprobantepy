import { describe, expect, it } from "vitest";
import { descifrar, cifrar } from "../cifrado.js";
import { hashPassword, verificarPassword } from "./password.js";
import { base32Codificar, base32Decodificar, codigoTotp, verificarTotp } from "./totp.js";

describe("TOTP (vectores del RFC 6238, SHA-1)", () => {
  const secreto = base32Codificar(Buffer.from("12345678901234567890"));

  it.each([
    [59, "287082"],
    [1111111109, "081804"],
    [1234567890, "005924"],
    [2000000000, "279037"],
  ])("t=%i → %s", (segundos, esperado) => {
    expect(codigoTotp(secreto, segundos * 1000)).toBe(esperado);
  });

  it("acepta un paso de desfase y rechaza códigos viejos", () => {
    const ahora = 1111111109 * 1000;
    expect(verificarTotp(secreto, codigoTotp(secreto, ahora - 30_000), ahora)).toBe(true);
    expect(verificarTotp(secreto, codigoTotp(secreto, ahora - 90_000), ahora)).toBe(false);
    expect(verificarTotp(secreto, "abc123", ahora)).toBe(false);
  });

  it("base32 ida y vuelta", () => {
    const datos = Buffer.from("hola mundo!");
    expect(base32Decodificar(base32Codificar(datos))).toEqual(datos);
  });
});

describe("contraseñas", () => {
  it("verifica la contraseña correcta y rechaza otra", async () => {
    const hash = await hashPassword("una-contraseña-larga");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(await verificarPassword("una-contraseña-larga", hash)).toBe(true);
    expect(await verificarPassword("otra-contraseña", hash)).toBe(false);
    expect(await verificarPassword("x", "basura")).toBe(false);
  });
});

describe("cifrado", () => {
  it("cifra y descifra; detecta alteraciones", () => {
    const valor = cifrar("JBSWY3DPEHPK3PXP");
    expect(valor).not.toContain("JBSWY3DPEHPK3PXP");
    expect(descifrar(valor)).toBe("JBSWY3DPEHPK3PXP");
    const partes = valor.split(":");
    partes[3] = Buffer.from("otro").toString("base64");
    expect(() => descifrar(partes.join(":"))).toThrow();
  });
});
