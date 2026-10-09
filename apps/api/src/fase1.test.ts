/**
 * Pruebas de integración de la Fase 1 (criterios de aceptación de la sección 24).
 * Requieren TEST_DATABASE_URL (la base se borra en cada ejecución).
 */
import { calcularDV, completarCdc } from "@comprobantepy/shared";
import type { FastifyInstance } from "fastify";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { construirApp } from "./app.js";
import { almacenamientoLocal } from "./archivos/almacenamiento.js";
import { hashPassword } from "./auth/password.js";
import { codigoTotp, generarSecretoTotp } from "./auth/totp.js";
import { cifrar } from "./cifrado.js";
import { crearConexion } from "./db/conexion.js";
import { usuarios } from "./db/esquema.js";
import { migrar } from "./db/migrar.js";
import { multipart, pdfConTexto } from "./pruebas.test-utils.js";

const url = process.env.TEST_DATABASE_URL;

const RUC_PROVEEDOR = "80012345";
const DV_PROVEEDOR = calcularDV(RUC_PROVEEDOR);

function cdcPara(numeroDoc: string) {
  return completarCdc(`01${RUC_PROVEEDOR}${DV_PROVEEDOR}001001${numeroDoc}1202603051123456789`);
}

function xmlSifen(opciones: { numeroDoc: string; receptorRuc: string; receptorDv: number; total?: number }) {
  const total = opciones.total ?? 110000;
  return `<?xml version="1.0" encoding="UTF-8"?>
<rDE xmlns="http://ekuatia.set.gov.py/sifen/xsd"><dVerFor>150</dVerFor>
<DE Id="${cdcPara(opciones.numeroDoc)}">
<gTimb><iTiDE>1</iTiDE><dDesTiDE>Factura electrónica</dDesTiDE><dNumTim>12345678</dNumTim><dEst>001</dEst><dPunExp>001</dPunExp><dNumDoc>${opciones.numeroDoc}</dNumDoc></gTimb>
<gDatGralOpe><dFeEmiDE>2026-03-05T10:20:30</dFeEmiDE><gOpeCom><cMoneOpe>PYG</cMoneOpe></gOpeCom>
<gEmis><dRucEm>${RUC_PROVEEDOR}</dRucEm><dDVEmi>${DV_PROVEEDOR}</dDVEmi><dNomEmi>Farmacia Ejemplo S.A.</dNomEmi></gEmis>
<gDatRec><iNatRec>1</iNatRec><dRucRec>${opciones.receptorRuc}</dRucRec><dDVRec>${opciones.receptorDv}</dDVRec><dNomRec>Receptor</dNomRec></gDatRec></gDatGralOpe>
<gDtipDE><gCamCond><iCondOpe>1</iCondOpe></gCamCond></gDtipDE>
<gTotSub><dSubExe>0</dSubExe><dSub5>0</dSub5><dSub10>${total}</dSub10><dTotGralOpe>${total}</dTotGralOpe><dIVA10>${Math.round(total / 11)}</dIVA10></gTotSub>
</DE><Signature/></rDE>`;
}

describe.skipIf(!url)("Fase 1 (integración)", () => {
  const { db, pool } = crearConexion(url);
  let app: FastifyInstance;
  let carpeta: string;
  let cookie = "";
  let cookieAuxiliar = "";
  let ana = 0;
  let madre = 0;
  let xmlId = 0;

  async function pedir(metodo: "GET" | "POST" | "PATCH" | "PUT", ruta: string, cuerpo?: unknown, cookieUsada = cookie) {
    const r = await app.inject({ method: metodo, url: `/api${ruta}`, headers: { cookie: cookieUsada }, payload: cuerpo as object });
    return { estado: r.statusCode, json: r.json(), r };
  }

  async function subir(archivos: { nombre: string; contenido: Buffer }[], campos: Record<string, string> = {}, cookieUsada = cookie) {
    const cuerpo = multipart(archivos, campos);
    const r = await app.inject({ method: "POST", url: "/api/comprobantes/carga", headers: { ...cuerpo.headers, cookie: cookieUsada }, payload: cuerpo.payload });
    return r.json().resultados as { resultado: string; comprobanteId: number; avisos: string[]; error?: string }[];
  }

  async function detalle(id: number) {
    return (await pedir("GET", `/comprobantes/${id}`)).json;
  }

  beforeAll(async () => {
    await pool.query("DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;");
    await migrar(url);
    carpeta = await mkdtemp(join(tmpdir(), "cpy-archivos-"));
    const secreto = generarSecretoTotp();
    await db.insert(usuarios).values([
      { email: "admin@ejemplo.com", nombre: "Admin", passwordHash: await hashPassword("clave-admin-segura"), esAdministrador: true, totpActivo: true, totpSecretoCifrado: cifrar(secreto) },
      { email: "aux@ejemplo.com", nombre: "Aux", passwordHash: await hashPassword("clave-aux-segura") },
    ]);
    app = await construirApp({ db, logger: false, almacenamiento: almacenamientoLocal(carpeta) });
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin@ejemplo.com", password: "clave-admin-segura", codigoTotp: codigoTotp(secreto) } });
    cookie = `sesion=${login.cookies.find((c) => c.name === "sesion")!.value}`;

    const autorizacion = { autorizacionFecha: "2026-01-01", autorizacionForma: "Escrita", autorizacionAlcance: "Todo" };
    ana = (await pedir("POST", "/contribuyentes", { nombre: "Ana", tipoIdentificacion: "RUC", identificacion: "1234567-9", ...autorizacion })).json.id;
    madre = (await pedir("POST", "/contribuyentes", { nombre: "Madre", tipoIdentificacion: "CI", identificacion: "2222222", ...autorizacion })).json.id;
    for (const obligacion of ["IRP_RSP", "IVA"]) {
      expect((await pedir("POST", `/contribuyentes/${ana}/obligaciones`, { obligacion, vigenteDesde: "2025-01-01" })).estado).toBe(201);
    }
    await pedir("POST", `/contribuyentes/${madre}/obligaciones`, { obligacion: "IRP_RSP", vigenteDesde: "2025-01-01" });

    // El auxiliar solo tiene acceso a la madre.
    await pool.query("INSERT INTO usuario_contribuyente_perfiles (usuario_id, contribuyente_id, perfil) VALUES (2, $1, 'AUXILIAR')", [madre]);
    const loginAux = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "aux@ejemplo.com", password: "clave-aux-segura" } });
    cookieAuxiliar = `sesion=${loginAux.cookies.find((c) => c.name === "sesion")!.value}`;
  });

  afterAll(async () => {
    await app?.close();
    await pool.end();
    if (carpeta) await rm(carpeta, { recursive: true, force: true });
  });

  it("un XML SIFEN se asigna al receptor aunque el contribuyente activo sea otro (24.1 c4, 24.2)", async () => {
    const [r] = await subir([{ nombre: "factura.xml", contenido: Buffer.from(xmlSifen({ numeroDoc: "0000123", receptorRuc: "1234567", receptorDv: 9 })) }], {
      contribuyenteId: String(madre),
    });
    expect(r!.resultado).toBe("CREADO");
    expect(r!.avisos.join()).toContain("contribuyente que figura como receptor");
    xmlId = r!.comprobanteId;
    const d = await detalle(xmlId);
    expect(d.contribuyente.id).toBe(ana);
    expect(d.comprobante).toMatchObject({ naturaleza: "ELECTRONICO", numero: "001-001-0000123", total: "110000.00", estadoTecnico: "VALIDACION_PENDIENTE" });
    expect(d.comprobante.estadoFlujo).toBe("PENDIENTE_CONFIRMACION_PROVEEDOR");
    expect(d.proveedor).toMatchObject({ numeroIdentificacion: RUC_PROVEEDOR, estado: "PENDIENTE_DE_CONFIRMAR", emisorElectronico: true });
    expect(d.elegibilidad.estado).toBe("NO_APLICA_ELECTRONICO");
    expect(d.comprobante.camposOrigen.total).toMatchObject({ fuente: "XML", confianza: 1 });
  });

  it("reprocesar el mismo archivo no genera registros (24.3 c13)", async () => {
    const [r] = await subir([{ nombre: "otra-vez.xml", contenido: Buffer.from(xmlSifen({ numeroDoc: "0000123", receptorRuc: "1234567", receptorDv: 9 })) }]);
    expect(r).toMatchObject({ resultado: "YA_REGISTRADO", comprobanteId: xmlId });
  });

  it("el KuDE en PDF del mismo comprobante se asocia al registro existente (24.1 c6)", async () => {
    const kude = pdfConTexto(["KuDE de Factura Electronica", `CDC: ${cdcPara("0000123").replace(/(\d{4})/g, "$1 ")}`, "Total: 110.000"]);
    const [r] = await subir([{ nombre: "kude.pdf", contenido: kude }]);
    expect(r).toMatchObject({ resultado: "ASOCIADO", comprobanteId: xmlId });
    const d = await detalle(xmlId);
    expect(d.archivos.map((a: { tipoDetectado: string }) => a.tipoDetectado)).toEqual(["XML", "PDF"]);
    // El XML tiene prioridad: la fuente del total sigue siendo XML.
    expect(d.comprobante.camposOrigen.total.fuente).toBe("XML");
  });

  it("un receptor no administrado queda pendiente y no puede asignarse a otro (24.2)", async () => {
    const [r] = await subir([{ nombre: "ajeno.xml", contenido: Buffer.from(xmlSifen({ numeroDoc: "0000200", receptorRuc: "5555555", receptorDv: calcularDV("5555555"), total: 99000 })) }]);
    const d = await detalle(r!.comprobanteId);
    expect(d.comprobante.estadoFlujo).toBe("PENDIENTE_ASIGNACION_CONTRIBUYENTE");
    const intento = await pedir("PATCH", `/comprobantes/${r!.comprobanteId}`, { contribuyenteId: ana });
    expect(intento.estado).toBe(409);
    expect(intento.json.codigo).toBe("RECEPTOR_NO_ADMINISTRADO");
  });

  it("confirmar el proveedor, imputar, confirmar y aprobar un electrónico", async () => {
    const proveedorId = (await detalle(xmlId)).proveedor.id;
    const confirmado = await pedir("POST", `/proveedores/${proveedorId}/estado`, { estado: "CONFIRMADO" });
    expect(confirmado.json.comprobantesRecalculados).toBeGreaterThan(0);
    expect((await detalle(xmlId)).comprobante.estadoFlujo).toBe("PENDIENTE_DATOS");

    const sinActiva = await pedir("PUT", `/comprobantes/${xmlId}/imputacion`, { lineas: [{ obligacion: "IRE_SIMPLE", porcentaje: 100 }], porcentajeNoImputado: 0 });
    expect(sinActiva.json.problemas.map((p: { mensaje: string }) => p.mensaje).join()).toContain("no está activa");

    const imputado = await pedir("PUT", `/comprobantes/${xmlId}/imputacion`, {
      lineas: [{ obligacion: "IVA", porcentaje: 100 }, { obligacion: "IRP_RSP", porcentaje: 100 }],
      porcentajeNoImputado: 0,
    });
    expect(imputado.json.comprobante.estadoFlujo).toBe("PENDIENTE_DE_REVISION");
    expect((await pedir("POST", `/comprobantes/${xmlId}/acciones`, { accion: "APROBAR" })).estado).toBe(409);
    expect((await pedir("POST", `/comprobantes/${xmlId}/acciones`, { accion: "CONFIRMAR" })).estado).toBe(200);
    expect((await pedir("POST", `/comprobantes/${xmlId}/acciones`, { accion: "APROBAR" })).estado).toBe(200);
    const d = await detalle(xmlId);
    expect(d.comprobante.estadoFlujo).toBe("APROBADO");
    expect(d.historial.map((h: { accion: string }) => h.accion)).toEqual(expect.arrayContaining(["CREAR", "EVIDENCIA_ASOCIADA", "IMPUTAR", "CONFIRMAR", "APROBAR"]));
    // Un aprobado no se edita sin observarlo antes.
    expect((await pedir("PATCH", `/comprobantes/${xmlId}`, { total: "1" })).json.codigo).toBe("NO_EDITABLE");
  });

  let fisicoId = 0;
  it("carga manual de un comprobante físico con validaciones de Marangatu", async () => {
    const alta = await pedir("POST", "/comprobantes", { contribuyenteId: ana, naturaleza: "FISICO" });
    fisicoId = alta.json.comprobanteId;
    expect((await detalle(fisicoId)).comprobante.estadoFlujo).toBe("PENDIENTE_DATOS");

    const dvMalo = await pedir("PATCH", `/comprobantes/${fisicoId}`, { proveedor: { tipoIdentificacion: 11, identificacion: "80012345" } });
    expect(dvMalo.estado).toBe(400);

    await pedir("PATCH", `/comprobantes/${fisicoId}`, {
      proveedor: { tipoIdentificacion: 11, identificacion: `${RUC_PROVEEDOR}-${DV_PROVEEDOR}` },
      tipoComprobante: 109,
      timbrado: 87654321,
      numero: "1-1-55",
      fechaEmision: "2026-03-10",
      condicion: 1,
      gravado10: "55000",
      total: "60000",
    });
    let d = await detalle(fisicoId);
    expect(d.comprobante.numero).toBe("001-001-0000055");
    expect(d.comprobante.camposOrigen.numero.fuente).toBe("MANUAL");
    const codigos = () => d.problemas.map((p: { codigo: string }) => p.codigo);
    expect(codigos()).toContain("MARANGATU_TOTAL");
    expect(codigos()).toContain("TIMBRADO_NO_VERIFICADO");

    await pedir("PATCH", `/comprobantes/${fisicoId}`, { exento: "5000" });
    await pedir("PUT", `/comprobantes/${fisicoId}/imputacion`, { lineas: [{ obligacion: "IRP_RSP", porcentaje: 100 }], porcentajeNoImputado: 0 });
    d = await detalle(fisicoId);
    expect(d.problemas.filter((p: { severidad: string }) => p.severidad !== "ADVERTENCIA")).toEqual([]);
    expect(d.comprobante.estadoFlujo).toBe("PENDIENTE_DE_REVISION");

    // Verificación manual del timbrado: rechazado bloquea, válido habilita (sección 11.4).
    const timbradoId = d.timbrado.id;
    await pedir("POST", `/proveedores/timbrados/${timbradoId}/verificacion`, { resultado: "RECHAZADO", consultaEn: "2026-03-11T10:00:00Z" });
    expect((await detalle(fisicoId)).problemas.map((p: { codigo: string }) => p.codigo)).toContain("TIMBRADO_RECHAZADO");
    await pedir("POST", `/proveedores/timbrados/${timbradoId}/verificacion`, {
      resultado: "VALIDO", vigenciaDesde: "2026-01-01", vigenciaHasta: "2026-12-31", consultaEn: "2026-03-11T10:05:00Z",
    });
    d = await detalle(fisicoId);
    expect(d.timbrado.estado).toBe("VALIDO");
    expect(d.problemas).toEqual([]);
  });

  it("bloquea el duplicado exacto aunque el anterior esté anulado (24.4 c15)", async () => {
    const otro = (await pedir("POST", "/comprobantes", { contribuyenteId: ana, naturaleza: "FISICO" })).json.comprobanteId;
    const intento = await pedir("PATCH", `/comprobantes/${otro}`, {
      proveedor: { tipoIdentificacion: 11, identificacion: `${RUC_PROVEEDOR}-${DV_PROVEEDOR}` },
      tipoComprobante: 109, timbrado: 87654321, numero: "001-001-0000055",
    });
    expect(intento.estado).toBe(409);
    expect(intento.json.codigo).toBe("DUPLICADO_EXACTO");
    expect(intento.json.error).toContain("de Ana");
    await pedir("POST", `/comprobantes/${otro}/acciones`, { accion: "ANULAR", motivo: "Carga de prueba" });
  });

  let parecidoId = 0;
  it("detecta un posible duplicado y permite descartarlo", async () => {
    parecidoId = (await pedir("POST", "/comprobantes", { contribuyenteId: ana, naturaleza: "FISICO" })).json.comprobanteId;
    await pedir("PATCH", `/comprobantes/${parecidoId}`, {
      proveedor: { tipoIdentificacion: 11, identificacion: `${RUC_PROVEEDOR}-${DV_PROVEEDOR}` },
      tipoComprobante: 109, timbrado: 87654321, numero: "001-001-0000056", fechaEmision: "2026-03-10",
      condicion: 1, gravado10: "55000", exento: "5000", total: "60000",
    });
    await pedir("PUT", `/comprobantes/${parecidoId}/imputacion`, { lineas: [{ obligacion: "IRP_RSP", porcentaje: 100 }], porcentajeNoImputado: 0 });
    const d = await detalle(parecidoId);
    expect(d.comprobante.estadoFlujo).toBe("POSIBLE_DUPLICADO");
    expect(d.posiblesDuplicados.map((p: { id: number }) => p.id)).toContain(fisicoId);
    // La marca aparece en ambos comprobantes.
    expect((await detalle(fisicoId)).comprobante.estadoFlujo).toBe("POSIBLE_DUPLICADO");
  });

  it("la confirmación masiva solo confirma los válidos e informa el motivo del resto (24.4 c19)", async () => {
    const mezcla = await pedir("POST", "/comprobantes/masivo/acciones", { ids: [fisicoId, xmlId + 1], contribuyenteId: ana, accion: "CONFIRMAR" });
    expect(mezcla.json.codigo).toBe("MEZCLA_CONTRIBUYENTES");

    const antes = await pedir("POST", "/comprobantes/masivo/acciones", { ids: [fisicoId, parecidoId], contribuyenteId: ana, accion: "CONFIRMAR" });
    expect(antes.json.aplicados).toEqual([]);
    expect(antes.json.excluidos.map((e: { categoria: string }) => e.categoria)).toEqual(["POSIBLE_DUPLICADO", "POSIBLE_DUPLICADO"]);

    const descartar = await pedir("POST", `/comprobantes/${parecidoId}/acciones`, { accion: "DESCARTAR_DUPLICADO", motivo: "Son dos compras distintas" });
    expect(descartar.estado).toBe(200);
    expect((await detalle(parecidoId)).comprobante.estadoFlujo).toBe("PENDIENTE_DE_REVISION");
    expect((await detalle(fisicoId)).comprobante.estadoFlujo).toBe("PENDIENTE_DE_REVISION");

    const incompleto = (await pedir("POST", "/comprobantes", { contribuyenteId: ana, naturaleza: "FISICO" })).json.comprobanteId;
    const r = await pedir("POST", "/comprobantes/masivo/acciones", { ids: [fisicoId, incompleto], contribuyenteId: ana, accion: "CONFIRMAR" });
    expect(r.json.aplicados).toEqual([fisicoId]);
    expect(r.json.excluidos).toEqual([expect.objectContaining({ id: incompleto, categoria: "BLOQUEADO" })]);
    expect(r.json.excluidos[0].motivo).toContain("Falta el proveedor");
  });

  it("la anulación exige motivo (24.4 c20) y un aprobado físico es elegible", async () => {
    expect((await pedir("POST", `/comprobantes/${parecidoId}/acciones`, { accion: "ANULAR" })).estado).toBe(409);
    await pedir("POST", `/comprobantes/${fisicoId}/acciones`, { accion: "APROBAR" });
    const d = await detalle(fisicoId);
    expect(d.elegibilidad.estado).toBe("ELEGIBLE");
  });

  it("clasificación masiva: completar solo los vacíos", async () => {
    const vacio = (await pedir("POST", "/comprobantes", { contribuyenteId: ana, naturaleza: "VIRTUAL" })).json.comprobanteId;
    const r = await pedir("POST", "/comprobantes/masivo/clasificar", {
      ids: [vacio, parecidoId], contribuyenteId: ana, modo: "COMPLETAR_VACIOS",
      lineas: [{ obligacion: "IVA", porcentaje: 100 }], porcentajeNoImputado: 0,
    });
    expect(r.json.aplicados).toEqual([vacio]);
    expect(r.json.excluidos[0]).toMatchObject({ id: parecidoId, motivo: "Ya tenía imputación" });
  });

  it("los archivos se sirven aislados y solo a quien tiene acceso", async () => {
    const archivoId = (await detalle(xmlId)).archivos[0].id;
    const r = await app.inject({ method: "GET", url: `/api/archivos/${archivoId}`, headers: { cookie } });
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-security-policy"]).toContain("sandbox");
    expect(r.body).toContain("<rDE");
    const ajeno = await app.inject({ method: "GET", url: `/api/archivos/${archivoId}`, headers: { cookie: cookieAuxiliar } });
    expect(ajeno.statusCode).toBe(404);
  });

  it("el auxiliar solo ve los comprobantes de su contribuyente y los pendientes", async () => {
    const lista = (await pedir("GET", "/comprobantes", undefined, cookieAuxiliar)).json.comprobantes as { contribuyenteId: number | null }[];
    expect(lista.every((c) => c.contribuyenteId === madre || c.contribuyenteId === null)).toBe(true);
    expect((await pedir("GET", `/comprobantes/${xmlId}`, undefined, cookieAuxiliar)).estado).toBe(404);
  });

  it("rechaza archivos de tipo no admitido", async () => {
    const [r] = await subir([{ nombre: "virus.exe", contenido: Buffer.from("MZ\x90\x00binario") }]);
    expect(r!.resultado).toBe("ERROR");
    expect(r!.error).toContain("formato no admitido");
  });

  it("un PDF digital de factura física se lee sin OCR (24.1 c2)", async () => {
    const pdf = pdfConTexto([
      "Farmacia Ejemplo S.A.",
      `RUC: ${RUC_PROVEEDOR}-${DV_PROVEEDOR}`,
      "Timbrado N: 11112222",
      "FACTURA 001-002-0000777",
      "Fecha de emision: 12/03/2026  Condicion: Contado",
      "Cliente: Ana   RUC: 1234567-9",
      "Total a pagar: 33.000",
    ]);
    const [r] = await subir([{ nombre: "factura.pdf", contenido: pdf }], { naturaleza: "FISICO" });
    expect(r!.resultado).toBe("CREADO");
    const d = await detalle(r!.comprobanteId);
    expect(d.contribuyente.id).toBe(ana);
    expect(d.comprobante).toMatchObject({
      naturaleza: "FISICO", timbrado: 11112222, numero: "001-002-0000777", fechaEmision: "2026-03-12", total: "33000.00", estadoTecnico: "EXTRAIDO",
    });
    expect(d.comprobante.camposOrigen.total.fuente).toBe("PDF_TEXTO");
    // Sugiere la imputación usada antes con el mismo proveedor.
    expect(d.imputacion.lineas.length).toBeGreaterThan(0);
  });
});
