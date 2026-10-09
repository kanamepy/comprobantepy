/** Comprobantes de ejemplo para las pruebas. */
import type { CompraExportable, EgresoExportable } from "./marangatu.js";

export const indicadoresIrp = { imputaIva: false, imputaIre: false, imputaIrpRsp: true, noImputa: false };

export function factura(cambios: Partial<CompraExportable> = {}): CompraExportable {
  return {
    tipoRegistro: "COMPRA",
    id: "c1",
    tipoIdentificacionProveedor: 11,
    numeroIdentificacionProveedor: "80012345",
    razonSocialProveedor: "Farmacia Ejemplo S.A.",
    tipoComprobante: 109,
    fechaEmision: "2026-03-05",
    timbrado: 12345678,
    numeroComprobante: "001-001-0000123",
    gravado10: 110_000,
    gravado5: 52_500,
    exento: 10_000,
    total: 172_500,
    condicion: 1,
    monedaExtranjera: false,
    indicadores: { imputaIva: true, imputaIre: false, imputaIrpRsp: true, noImputa: false },
    numeroAsociado: null,
    timbradoAsociado: null,
    ...cambios,
  };
}

export function egreso(cambios: Partial<EgresoExportable> = {}): EgresoExportable {
  return {
    tipoRegistro: "EGRESO",
    id: "e1",
    tipoComprobante: 209,
    fechaEmision: "2026-03-10",
    numeroComprobante: "R-555",
    tipoIdentificacionReceptor: 11,
    numeroIdentificacionReceptor: "80054321",
    razonSocialReceptor: null,
    total: 250_000,
    indicadores: indicadoresIrp,
    numeroCuenta: null,
    entidadFinanciera: null,
    numeroPatronalIps: null,
    especificarTipoDocumento: "Recibo de cuota",
    numeroCompraAsociada: null,
    timbradoCompraAsociada: null,
    ...cambios,
  };
}
