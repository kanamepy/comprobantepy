/** Comprobantes de ejemplo para las pruebas. */
import { completarCdc } from "./cdc.js";
import type { CompraExportable, EgresoExportable } from "./marangatu.js";
import { calcularDV } from "./ruc.js";

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


export const RUC_EMISOR = "80012345";
export const DV_EMISOR = calcularDV(RUC_EMISOR);

/** CDC válido de una factura electrónica 001-001-0000123 del 05/03/2026. */
export const CDC_EJEMPLO = completarCdc(`01${RUC_EMISOR}${DV_EMISOR}0010010000123` + `1` + `20260305` + `1` + `123456789`);

/** XML SIFEN mínimo con la estructura del Manual Técnico v150. */
export function xmlSifenEjemplo(cambios: { receptorRuc?: string; receptorDv?: number; moneda?: string } = {}): string {
  const receptorRuc = cambios.receptorRuc ?? "1234567";
  const receptorDv = cambios.receptorDv ?? 9;
  const moneda = cambios.moneda ?? "PYG";
  return `<?xml version="1.0" encoding="UTF-8"?>
<rDE xmlns="http://ekuatia.set.gov.py/sifen/xsd" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dVerFor>150</dVerFor>
  <DE Id="${CDC_EJEMPLO}">
    <dDVId>${CDC_EJEMPLO.slice(-1)}</dDVId>
    <dFecFirma>2026-03-05T10:21:00</dFecFirma>
    <dSisFact>1</dSisFact>
    <gOpeDE><iTipEmi>1</iTipEmi><dDesTipEmi>Normal</dDesTipEmi><dCodSeg>123456789</dCodSeg></gOpeDE>
    <gTimb>
      <iTiDE>1</iTiDE><dDesTiDE>Factura electrónica</dDesTiDE>
      <dNumTim>12345678</dNumTim><dEst>001</dEst><dPunExp>001</dPunExp><dNumDoc>0000123</dNumDoc>
      <dFeIniT>2025-01-01</dFeIniT>
    </gTimb>
    <gDatGralOpe>
      <dFeEmiDE>2026-03-05T10:20:30</dFeEmiDE>
      <gOpeCom><iTipTra>1</iTipTra><iTImp>1</iTImp><cMoneOpe>${moneda}</cMoneOpe>${moneda === "PYG" ? "" : "<dCondTiCam>1</dCondTiCam><dTiCam>7300</dTiCam>"}</gOpeCom>
      <gEmis>
        <dRucEm>${RUC_EMISOR}</dRucEm><dDVEmi>${DV_EMISOR}</dDVEmi><iTipCont>2</iTipCont>
        <dNomEmi>Farmacia Ejemplo S.A.</dNomEmi><dNomFanEmi>Farmacia Ejemplo</dNomFanEmi>
      </gEmis>
      <gDatRec>
        <iNatRec>1</iNatRec><iTiOpe>2</iTiOpe><cPaisRec>PRY</cPaisRec><iTiContRec>1</iTiContRec>
        <dRucRec>${receptorRuc}</dRucRec><dDVRec>${receptorDv}</dDVRec><dNomRec>Ana Pérez</dNomRec>
      </gDatRec>
    </gDatGralOpe>
    <gDtipDE>
      <gCamFE><iIndPres>1</iIndPres></gCamFE>
      <gCamCond><iCondOpe>1</iCondOpe><dDCondOpe>Contado</dDCondOpe></gCamCond>
    </gDtipDE>
    <gTotSub>
      <dSubExe>10000</dSubExe><dSubExo>0</dSubExo><dSub5>52500</dSub5><dSub10>110000</dSub10>
      <dTotOpe>172500</dTotOpe><dTotGralOpe>172500</dTotGralOpe>
      <dIVA5>2500</dIVA5><dIVA10>10000</dIVA10><dTotIVA>12500</dTotIVA>
    </gTotSub>
  </DE>
  <Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignedInfo/></Signature>
  <gCamFuFD><dCarQR>https://ekuatia.set.gov.py/consultas/qr?nVersion=150&amp;Id=${CDC_EJEMPLO}</dCarQR></gCamFuFD>
</rDE>`;
}
