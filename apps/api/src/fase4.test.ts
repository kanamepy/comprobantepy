/**
 * Pruebas de la Fase 4: lectura automática de imágenes y PDF escaneados (OCR y QR).
 * El OCR se ejecuta de verdad con tesseract.js; las pruebas de integración requieren TEST_DATABASE_URL.
 */
import { calcularDV, completarCdc } from "@comprobantepy/shared";
import type { FastifyInstance } from "fastify";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { construirApp } from "./app.js";
import { almacenamientoLocal } from "./archivos/almacenamiento.js";
import { evaluarCalidad } from "./archivos/imagen.js";
import { cerrarOcr } from "./archivos/ocr.js";
import { hashPassword } from "./auth/password.js";
import { codigoTotp, generarSecretoTotp } from "./auth/totp.js";
import { cifrar } from "./cifrado.js";
import { crearConexion } from "./db/conexion.js";
import { usuarios } from "./db/esquema.js";
import { migrar } from "./db/migrar.js";
import { imagenComprobante, multipart, pdfConImagen } from "./pruebas.test-utils.js";
import { leerImagen, leerPdfEscaneado } from "./servicios/lectura.js";
import { vaciarCola } from "./servicios/trabajos.js";

const url = process.env.TEST_DATABASE_URL;
const RUC = "80054321";
const DV = calcularDV(RUC);
const FACTURA = [
  "LIBRERIA CENTRAL S.R.L.",
  `RUC: ${RUC}-${DV}`,
  "Timbrado N°: 11112222",
  "FACTURA 001-002-0000777",
  "Fecha de emision: 12/03/2026",
  "Condicion de venta: Contado",
  "Cliente: Ana Perez   RUC: 1234567-9",
  "Total a pagar: 33.000",
];
const RUC_E = "80012345";
const CDC = completarCdc(`01${RUC_E}${calcularDV(RUC_E)}0010010000123` + "1" + "20260305" + "1" + "123456789");
const QR = `https://ekuatia.set.gov.py/consultas/qr?nVersion=150&Id=${CDC}&dFeEmiDE=${Buffer.from("2026-03-05T10:20:30").toString("hex")}&dRucRec=1234567&dTotGralOpe=110000&cItems=1`;
const valores = (campos: Record<string, { valor: string }>) => Object.fromEntries(Object.entries(campos).map(([k, c]) => [k, c.valor]));

afterAll(async () => {
  await cerrarOcr();
});

describe("lectura de imágenes", { timeout: 60_000 }, () => {
  it("lee los datos de la foto de una factura física con OCR (criterio 1)", async () => {
    const r = await leerImagen(await imagenComprobante(FACTURA));
    expect(r.estadoTecnico).toBe("EXTRAIDO");
    expect(valores(r.extraccion.campos)).toMatchObject({
      timbrado: "11112222", numero: "001-002-0000777", fechaEmision: "2026-03-12", emisorRuc: RUC, total: "33000", tipoComprobante: "109",
      receptorNumero: "1234567",
    });
    // Los datos del OCR nunca tienen confianza total: se marcan para revisión.
    expect(Object.values(r.extraccion.campos).every((c) => c.fuente === "OCR" && c.confianza < 1)).toBe(true);
  });

  it("una foto de KuDE con QR se reconoce como electrónica y toma los datos del QR (criterio 5)", async () => {
    const r = await leerImagen(await imagenComprobante(["KuDE de Factura Electronica", "Farmacia Ejemplo S.A."], { qr: QR }));
    expect(r.extraccion.indicios.cdcValido).toBe(true);
    expect(r.estadoTecnico).toBe("VALIDACION_PENDIENTE");
    expect(r.extraccion.campos.cdc).toMatchObject({ valor: CDC, fuente: "QR" });
    expect(valores(r.extraccion.campos)).toMatchObject({ receptorNumero: "1234567", total: "110000", numero: "001-001-0000123" });
  });

  it("detecta fotos borrosas o de baja resolución", async () => {
    const nitida = await imagenComprobante(FACTURA);
    expect(await evaluarCalidad(nitida)).toMatchObject({ borrosa: false, resolucionBaja: false });
    const borrosa = await sharp(nitida).blur(8).png().toBuffer();
    expect((await evaluarCalidad(borrosa)).borrosa).toBe(true);
    const chica = await sharp(nitida).resize(400).png().toBuffer();
    expect((await evaluarCalidad(chica)).resolucionBaja).toBe(true);
    const lectura = await leerImagen(borrosa);
    expect(lectura.extraccion.advertencias.join()).toMatch(/borrosa/);
  });

  it("lee un PDF escaneado con OCR (criterio 3)", async () => {
    const png = await imagenComprobante(FACTURA);
    const { data, info } = await sharp(png).flatten({ background: "#ffffff" }).jpeg({ quality: 92 }).toBuffer({ resolveWithObject: true });
    const r = await leerPdfEscaneado(pdfConImagen(data, info.width, info.height));
    expect(valores(r.extraccion.campos)).toMatchObject({ timbrado: "11112222", numero: "001-002-0000777", total: "33000" });
  });
});

describe.skipIf(!url)("Fase 4 – lectura en segundo plano (integración)", { timeout: 60_000 }, () => {
  const { db, pool } = crearConexion(url);
  let app: FastifyInstance;
  let carpeta: string;
  let cookie = "";
  let ana = 0;
  let madre = 0;
  const almacenamiento = { actual: almacenamientoLocal("/tmp") };

  async function pedir(metodo: "GET" | "POST" | "PATCH", ruta: string, cuerpo?: unknown) {
    const r = await app.inject({ method: metodo, url: `/api${ruta}`, headers: { cookie }, payload: cuerpo as object });
    return { estado: r.statusCode, json: r.json() };
  }
  async function subir(nombre: string, contenido: Buffer, campos: Record<string, string> = {}) {
    const cuerpo = multipart([{ nombre, contenido }], campos);
    const r = await app.inject({ method: "POST", url: "/api/comprobantes/carga", headers: { ...cuerpo.headers, cookie }, payload: cuerpo.payload });
    return r.json().resultados[0] as { resultado: string; comprobanteId: number; avisos: string[] };
  }

  beforeAll(async () => {
    await pool.query("DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;");
    await migrar(url);
    carpeta = await mkdtemp(join(tmpdir(), "cpy-ocr-"));
    almacenamiento.actual = almacenamientoLocal(carpeta);
    const secreto = generarSecretoTotp();
    await db.insert(usuarios).values({
      email: "admin@ejemplo.com", nombre: "Admin", passwordHash: await hashPassword("clave-admin-segura"), esAdministrador: true, totpActivo: true, totpSecretoCifrado: cifrar(secreto),
    });
    app = await construirApp({ db, logger: false, almacenamiento: almacenamiento.actual });
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin@ejemplo.com", password: "clave-admin-segura", codigoTotp: codigoTotp(secreto) } });
    cookie = `sesion=${login.cookies.find((c) => c.name === "sesion")!.value}`;
    const autorizacion = { autorizacionFecha: "2026-01-01", autorizacionForma: "Escrita", autorizacionAlcance: "Todo" };
    ana = (await pedir("POST", "/contribuyentes", { nombre: "Ana", tipoIdentificacion: "RUC", identificacion: "1234567-9", ...autorizacion })).json.id;
    madre = (await pedir("POST", "/contribuyentes", { nombre: "Madre", tipoIdentificacion: "CI", identificacion: "2222222", ...autorizacion })).json.id;
  });

  afterAll(async () => {
    await app?.close();
    await pool.end();
    if (carpeta) await rm(carpeta, { recursive: true, force: true });
  });

  let fotoId = 0;
  it("la foto se registra al instante y la lectura completa los datos en segundo plano", async () => {
    const r = await subir("foto.png", await imagenComprobante(FACTURA), { contribuyenteId: String(madre), canal: "CAMARA" });
    expect(r.resultado).toBe("CREADO");
    fotoId = r.comprobanteId;
    let d = (await pedir("GET", `/comprobantes/${fotoId}`)).json;
    expect(d.comprobante.estadoTecnico).toBe("PROCESANDO");
    expect(d.comprobante.advertenciasExtraccion.join()).toContain("Leyendo");

    expect(await vaciarCola(db, almacenamiento.actual)).toBe(1);
    d = (await pedir("GET", `/comprobantes/${fotoId}`)).json;
    expect(d.comprobante).toMatchObject({ estadoTecnico: "EXTRAIDO", timbrado: 11112222, numero: "001-002-0000777", total: "33000.00" });
    expect(d.comprobante.advertenciasExtraccion.join()).not.toContain("Leyendo");
    expect(d.proveedor).toMatchObject({ numeroIdentificacion: RUC, estado: "PENDIENTE_DE_CONFIRMAR" });
    // Se cargó con la madre activa, pero la factura está emitida a Ana (sección 2.3, regla 6).
    expect(d.contribuyente.id).toBe(ana);
    expect(d.historial.map((h: { accion: string }) => h.accion)).toContain("LECTURA_AUTOMATICA");
  });

  it("volver a leer no pisa las correcciones manuales", async () => {
    await pedir("PATCH", `/comprobantes/${fotoId}`, { total: "33500" });
    expect((await pedir("POST", `/comprobantes/${fotoId}/releer`, {})).json.encolados).toBe(1);
    await vaciarCola(db, almacenamiento.actual);
    const d = (await pedir("GET", `/comprobantes/${fotoId}`)).json;
    expect(d.comprobante.total).toBe("33500.00");
    expect(d.comprobante.camposOrigen.total.fuente).toBe("MANUAL");
  });

  it("la foto del KuDE de un XML ya registrado se une a ese registro (sección 7.4)", async () => {
    const xml = `<?xml version="1.0"?><rDE xmlns="http://ekuatia.set.gov.py/sifen/xsd"><DE Id="${CDC}">
<gTimb><iTiDE>1</iTiDE><dNumTim>12345678</dNumTim><dEst>001</dEst><dPunExp>001</dPunExp><dNumDoc>0000123</dNumDoc></gTimb>
<gDatGralOpe><dFeEmiDE>2026-03-05T10:20:30</dFeEmiDE><gEmis><dRucEm>${RUC_E}</dRucEm><dDVEmi>${calcularDV(RUC_E)}</dDVEmi><dNomEmi>Farmacia</dNomEmi></gEmis>
<gDatRec><iNatRec>1</iNatRec><dRucRec>1234567</dRucRec><dDVRec>9</dDVRec></gDatRec></gDatGralOpe>
<gTotSub><dSub10>110000</dSub10><dTotGralOpe>110000</dTotGralOpe></gTotSub></DE></rDE>`;
    const delXml = await subir("factura.xml", Buffer.from(xml));
    const foto = await subir("kude.png", await imagenComprobante(["KuDE de Factura Electronica", "Farmacia Ejemplo"], { qr: QR }));
    await vaciarCola(db, almacenamiento.actual);
    const dFoto = (await pedir("GET", `/comprobantes/${foto.comprobanteId}`)).json;
    expect(dFoto.comprobante.estadoFlujo).toBe("ANULADO");
    expect(dFoto.comprobante.anuladoMotivo).toContain(`n.° ${delXml.comprobanteId}`);
    const dXml = (await pedir("GET", `/comprobantes/${delXml.comprobanteId}`)).json;
    expect(dXml.archivos.map((a: { tipoDetectado: string }) => a.tipoDetectado).sort()).toEqual(["IMAGEN", "XML"]);
  });
});
