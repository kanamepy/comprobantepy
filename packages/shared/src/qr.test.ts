import { describe, expect, it } from "vitest";
import { CDC_EJEMPLO } from "./ejemplos.test-utils.js";
import { determinarNaturaleza } from "./naturaleza.js";
import { esQrSifen, extraerDeQr } from "./qr.js";
import { extraerDeTexto } from "./texto.js";

const hex = (s: string) => Buffer.from(s).toString("hex");
const qr = `https://ekuatia.set.gov.py/consultas/qr?nVersion=150&Id=${CDC_EJEMPLO}&dFeEmiDE=${hex("2026-03-05T10:20:30")}&dRucRec=1234567&dTotGralOpe=172500&dTotIVA=12500&cItems=2&DigestValue=abc&IdCSC=0001&cHashQR=xyz`;

describe("QR SIFEN", () => {
  it("extrae CDC, emisor, número, fecha, receptor y total", () => {
    expect(esQrSifen(qr)).toBe(true);
    const r = extraerDeQr(qr);
    const v = Object.fromEntries(Object.entries(r.campos).map(([k, c]) => [k, c.valor]));
    expect(v).toMatchObject({
      cdc: CDC_EJEMPLO, emisorRuc: "80012345", numero: "001-001-0000123", tipoComprobante: "109",
      fechaEmision: "2026-03-05", receptorTipoIdentificacion: "RUC", receptorNumero: "1234567", total: "172500",
    });
    expect(Object.values(r.campos).every((c) => c.fuente === "QR")).toBe(true);
    expect(determinarNaturaleza(r).naturaleza).toBe("ELECTRONICO");
  });

  it("rechaza un QR que no es de SIFEN", () => {
    const r = extraerDeQr("https://ejemplo.com/?Id=123");
    expect(r.indicios.cdcValido).toBe(false);
    expect(r.advertencias[0]).toContain("no corresponde");
  });
});

describe("texto leído por OCR", () => {
  it("tolera variantes de “N°” en el timbrado", () => {
    for (const variante of ["Timbrado N*: 11112222", "TIMBRADO Nº 11112222", "Timbrado Nro. 11112222", "Timbrado: 11112222"]) {
      expect(extraerDeTexto(variante, "OCR").campos.timbrado?.valor).toBe("11112222");
    }
  });
});
