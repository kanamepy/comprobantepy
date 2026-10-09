/**
 * Pruebas de la Fase 3: recepción por correo (criterios 7 a 14 de la sección 24.3).
 * Gmail se reemplaza por un adaptador en memoria. Requieren TEST_DATABASE_URL.
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
import { analizarMensaje } from "./correo/analisis.js";
import { ErrorAutenticacionCorreo, type AdaptadorCorreo } from "./correo/gmail.js";
import { crearConexion } from "./db/conexion.js";
import { usuarios } from "./db/esquema.js";
import { migrar } from "./db/migrar.js";
import { correoMime, multipart, pdfConTexto } from "./pruebas.test-utils.js";

const url = process.env.TEST_DATABASE_URL;
const RUC = "80012345";
const DV = calcularDV(RUC);

function xml(numeroDoc: string, receptor = "1234567", receptorDv = 9) {
  const cdc = completarCdc(`01${RUC}${DV}001001${numeroDoc}1202603051123456789`);
  return {
    cdc,
    contenido: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<rDE xmlns="http://ekuatia.set.gov.py/sifen/xsd"><DE Id="${cdc}">
<gTimb><iTiDE>1</iTiDE><dNumTim>12345678</dNumTim><dEst>001</dEst><dPunExp>001</dPunExp><dNumDoc>${numeroDoc}</dNumDoc></gTimb>
<gDatGralOpe><dFeEmiDE>2026-03-05T10:20:30</dFeEmiDE><gOpeCom><cMoneOpe>PYG</cMoneOpe></gOpeCom>
<gEmis><dRucEm>${RUC}</dRucEm><dDVEmi>${DV}</dDVEmi><dNomEmi>Farmacia Ejemplo S.A.</dNomEmi></gEmis>
<gDatRec><iNatRec>1</iNatRec><dRucRec>${receptor}</dRucRec><dDVRec>${receptorDv}</dDVRec></gDatRec></gDatGralOpe>
<gTotSub><dSub10>110000</dSub10><dTotGralOpe>110000</dTotGralOpe></gTotSub></DE><Signature/></rDE>`),
  };
}

/** Gmail en memoria: guarda los mensajes y registra las etiquetas aplicadas. */
class BuzonSimulado implements AdaptadorCorreo {
  mensajes = new Map<string, Buffer>();
  etiquetas = new Map<string, string>();
  fallarAutenticacion = false;
  async listarPendientes() {
    if (this.fallarAutenticacion) throw new ErrorAutenticacionCorreo("invalid_grant");
    return [...this.mensajes.keys()].filter((id) => !this.etiquetas.has(id));
  }
  async obtenerCrudo(id: string) {
    return this.mensajes.get(id)!;
  }
  async marcar(id: string, estado: string) {
    this.etiquetas.set(id, estado);
  }
}

describe("análisis de mensajes", () => {
  it("reconoce un reenvío automático de Gmail (X-Forwarded-For)", async () => {
    const r = await analizarMensaje(
      correoMime({ de: "ventas@farmacia.com.py", para: "central@gmail.com", asunto: "Factura", cabeceras: { "X-Forwarded-For": "esposo@gmail.com central@gmail.com" } }),
    );
    expect(r).toMatchObject({ esReenvio: true, reenviadoPor: "esposo@gmail.com", remitenteOriginal: "ventas@farmacia.com.py" });
  });

  it("reconoce un reenvío manual y toma el remitente original del cuerpo", async () => {
    const r = await analizarMensaje(
      correoMime({
        de: "Madre <madre@hotmail.com>",
        para: "central@gmail.com",
        asunto: "RV: Su factura",
        texto: "Te la paso\n\n---------- Forwarded message ---------\nDe: Ventas <ventas@libreria.com.py>\nDate: 1 mar 2026",
      }),
    );
    expect(r).toMatchObject({ esReenvio: true, reenviadoPor: "madre@hotmail.com", remitenteOriginal: "ventas@libreria.com.py" });
  });

  it("toma los adjuntos de un correo adjunto (.eml) e ignora logos", async () => {
    const interno = correoMime({ de: "ventas@libreria.com.py", para: "madre@hotmail.com", asunto: "Factura", adjuntos: [{ nombre: "factura.pdf", tipo: "application/pdf", contenido: pdfConTexto(["Factura"]) }] });
    const r = await analizarMensaje(
      correoMime({
        de: "madre@hotmail.com",
        para: "central@gmail.com",
        asunto: "Te reenvío",
        correoAdjunto: interno,
        adjuntos: [{ nombre: "logo.png", tipo: "image/png", contenido: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200)]), incrustada: true }],
      }),
    );
    expect(r.adjuntos.map((a) => [a.nombre, a.enCorreoAdjunto])).toEqual([["factura.pdf", true]]);
    expect(r.ignorados[0]).toMatchObject({ nombre: "logo.png" });
    expect(r).toMatchObject({ esReenvio: true, reenviadoPor: "madre@hotmail.com", remitenteOriginal: "ventas@libreria.com.py" });
  });
});

describe.skipIf(!url)("Fase 3 – correo (integración)", () => {
  const { db, pool } = crearConexion(url);
  const gmail = new BuzonSimulado();
  let app: FastifyInstance;
  let carpeta: string;
  let cookie = "";
  let ana = 0;
  let madre = 0;
  let central = 0;

  async function pedir(metodo: "GET" | "POST" | "PATCH", ruta: string, cuerpo?: unknown) {
    const r = await app.inject({ method: metodo, url: `/api${ruta}`, headers: { cookie }, payload: cuerpo as object });
    return { estado: r.statusCode, json: r.json() };
  }
  const sondear = () => pedir("POST", `/correo/buzones/${central}/sondear`);
  async function mensajes() {
    return (await pedir("GET", "/correo/mensajes")).json as { id: number; estado: string; idProveedor: string; reenviadoPor: string | null; detalle: { comprobanteId: number | null; resultado: string }[] }[];
  }
  const mensaje = async (idProveedor: string) => (await mensajes()).find((m) => m.idProveedor === idProveedor)!;

  beforeAll(async () => {
    await pool.query("DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;");
    await migrar(url);
    carpeta = await mkdtemp(join(tmpdir(), "cpy-correo-"));
    const secreto = generarSecretoTotp();
    await db.insert(usuarios).values({
      email: "admin@ejemplo.com", nombre: "Admin", passwordHash: await hashPassword("clave-admin-segura"), esAdministrador: true, totpActivo: true, totpSecretoCifrado: cifrar(secreto),
    });
    app = await construirApp({ db, logger: false, almacenamiento: almacenamientoLocal(carpeta), fabricaAdaptadorCorreo: () => gmail });
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin@ejemplo.com", password: "clave-admin-segura", codigoTotp: codigoTotp(secreto) } });
    cookie = `sesion=${login.cookies.find((c) => c.name === "sesion")!.value}`;
    const autorizacion = { autorizacionFecha: "2026-01-01", autorizacionForma: "Escrita", autorizacionAlcance: "Todo" };
    ana = (await pedir("POST", "/contribuyentes", { nombre: "Ana", tipoIdentificacion: "RUC", identificacion: "1234567-9", ...autorizacion })).json.id;
    madre = (await pedir("POST", "/contribuyentes", { nombre: "Madre", tipoIdentificacion: "CI", identificacion: "2222222", ...autorizacion })).json.id;

    central = (await pedir("POST", "/correo/buzones", {
      direccion: "vgomez.factura@gmail.com", rol: "CENTRAL", mecanismo: "GMAIL_API", titular: "Ana", autorizacionFecha: "2026-01-01", autorizacionForma: "Propia",
    })).json.id;
    // En producción el token llega por la autorización de Google; aquí se simula.
    await pool.query("UPDATE buzones SET credencial_cifrada = $1, estado = 'ACTIVO' WHERE id = $2", [cifrar("token-simulado"), central]);
    const origen = await pedir("POST", "/correo/buzones", {
      direccion: "esposo@gmail.com", rol: "ORIGEN", mecanismo: "REENVIO", titular: "Esposo", contribuyenteSugeridoId: madre, autorizacionFecha: "2026-01-01", autorizacionForma: "Escrita",
    });
    expect(origen.json.estado).toBe("ACTIVO");
  });

  afterAll(async () => {
    await app?.close();
    await pool.end();
    if (carpeta) await rm(carpeta, { recursive: true, force: true });
  });

  it("un correo con XML y PDF del mismo comprobante crea un solo registro (criterios 6 y 7)", async () => {
    const { cdc, contenido } = xml("0000123");
    gmail.mensajes.set("m1", correoMime({
      de: "ventas@farmacia.com.py", para: "vgomez.factura@gmail.com", asunto: "Factura electrónica",
      adjuntos: [
        { nombre: "factura.xml", tipo: "text/xml", contenido },
        { nombre: "kude.pdf", tipo: "application/pdf", contenido: pdfConTexto(["KuDE", `CDC: ${cdc}`]) },
      ],
    }));
    const r = await sondear();
    expect(r.json).toMatchObject({ leidos: 1, nuevos: 1, errores: [] });
    const m = await mensaje("m1");
    expect(m.estado).toBe("PROCESADO");
    expect(gmail.etiquetas.get("m1")).toBe("PROCESADO");
    const ids = [...new Set(m.detalle.map((d) => d.comprobanteId))];
    expect(ids).toHaveLength(1);
    const d = (await pedir("GET", `/comprobantes/${ids[0]}`)).json;
    expect(d.archivos).toHaveLength(2);
    expect(d.correos[0]).toMatchObject({ remitenteOriginal: "ventas@farmacia.com.py" });
    expect(d.historial.some((h: { accion: string }) => h.accion === "CREAR")).toBe(true);
  });

  it("un reenvío automático de otro titular se asigna por el receptor (criterio 8)", async () => {
    gmail.mensajes.set("m2", correoMime({
      de: "ventas@farmacia.com.py", para: "esposo@gmail.com", asunto: "Factura",
      cabeceras: { "X-Forwarded-For": "esposo@gmail.com vgomez.factura@gmail.com" },
      adjuntos: [{ nombre: "f2.xml", tipo: "text/xml", contenido: xml("0000124").contenido }],
    }));
    await sondear();
    const m = await mensaje("m2");
    expect(m).toMatchObject({ estado: "PROCESADO", reenviadoPor: "esposo@gmail.com" });
    // El buzón sugiere a la madre, pero la factura está emitida a Ana.
    expect((await pedir("GET", `/comprobantes/${m.detalle[0]!.comprobanteId}`)).json.contribuyente.id).toBe(ana);
  });

  it("el mismo comprobante en dos correos queda una vez, con ambos correos como evidencia (criterio 9)", async () => {
    gmail.mensajes.set("m3", correoMime({
      de: "ventas@farmacia.com.py", para: "vgomez.factura@gmail.com", asunto: "Copia",
      adjuntos: [{ nombre: "f2-copia.xml", tipo: "text/xml", contenido: xml("0000124").contenido }],
    }));
    await sondear();
    const m3 = await mensaje("m3");
    const m2 = await mensaje("m2");
    expect(m3.estado).toBe("DUPLICADO");
    expect(m3.detalle[0]!.comprobanteId).toBe(m2.detalle[0]!.comprobanteId);
    const d = (await pedir("GET", `/comprobantes/${m2.detalle[0]!.comprobanteId}`)).json;
    expect(d.correos).toHaveLength(2);
  });

  it("un reenvío desde una dirección no registrada queda en revisión (criterio 10)", async () => {
    gmail.mensajes.set("m4", correoMime({
      de: "desconocido@yahoo.com", para: "vgomez.factura@gmail.com", asunto: "Fwd: factura",
      texto: "---------- Forwarded message ---------\nFrom: ventas@farmacia.com.py",
      adjuntos: [{ nombre: "f5.xml", tipo: "text/xml", contenido: xml("0000125").contenido }],
    }));
    await sondear();
    const m = await mensaje("m4");
    expect(m.estado).toBe("REMITENTE_NO_HABILITADO");
    const comprobantes = (await pedir("GET", "/comprobantes")).json.comprobantes;
    expect(comprobantes).toHaveLength(2);

    const aceptado = await pedir("POST", `/correo/mensajes/${m.id}/aceptar`, { habilitarRemitente: true, titular: "Hermana" });
    expect(aceptado.json.estado).toBe("PROCESADO");
    const estado = (await pedir("GET", "/correo/estado")).json;
    expect(estado.buzones.map((b: { direccion: string }) => b.direccion)).toContain("desconocido@yahoo.com");
  });

  it("un correo sin adjuntos válidos queda en incidencias y no crea comprobantes (criterio 12)", async () => {
    gmail.mensajes.set("m5", correoMime({
      de: "ventas@farmacia.com.py", para: "vgomez.factura@gmail.com", asunto: "Hola",
      adjuntos: [{ nombre: "presupuesto.docx", tipo: "application/vnd.openxmlformats", contenido: Buffer.from("PK\u0003\u0004 contenido de word") }],
    }));
    const antes = (await pedir("GET", "/comprobantes")).json.comprobantes.length;
    await sondear();
    const m = await mensaje("m5");
    expect(m.estado).toBe("SIN_ADJUNTOS");
    expect(m.detalle[0]).toMatchObject({ resultado: "IGNORADO" });
    expect((await pedir("GET", "/comprobantes")).json.comprobantes).toHaveLength(antes);
  });

  it("reprocesar no genera registros adicionales (criterio 13)", async () => {
    gmail.etiquetas.clear();
    const r = await sondear();
    expect(r.json).toMatchObject({ leidos: 5, nuevos: 0 });
    expect(await mensajes()).toHaveLength(5);
  });

  it("si el permiso de Gmail deja de valer, el buzón queda en error y se genera una alerta (criterio 14)", async () => {
    gmail.fallarAutenticacion = true;
    await sondear();
    let estado = (await pedir("GET", "/correo/estado")).json;
    expect(estado.buzones.find((b: { id: number }) => b.id === central).estado).toBe("ERROR_AUTENTICACION");
    expect(estado.alertas).toEqual([expect.objectContaining({ tipo: "TOKEN_CORREO" })]);
    await sondear();
    expect((await pedir("GET", "/correo/estado")).json.alertas).toHaveLength(1);

    gmail.fallarAutenticacion = false;
    await sondear();
    estado = (await pedir("GET", "/correo/estado")).json;
    expect(estado.buzones.find((b: { id: number }) => b.id === central).estado).toBe("ACTIVO");
    expect(estado.alertas).toEqual([]);
  });

  it("carga manual de un correo guardado (.eml) con el comprobante adjunto", async () => {
    const eml = correoMime({
      de: "ventas@libreria.com.py", para: "madre@hotmail.com", asunto: "Factura",
      adjuntos: [{ nombre: "f6.xml", tipo: "text/xml", contenido: xml("0000126").contenido }],
    });
    const cuerpo = multipart([{ nombre: "factura.eml", contenido: eml, tipo: "message/rfc822" }]);
    const subir = () => app.inject({ method: "POST", url: "/api/correo/eml", headers: { ...cuerpo.headers, cookie }, payload: cuerpo.payload });
    const r = (await subir()).json();
    expect(r.resultados[0]).toMatchObject({ nuevo: true, mensaje: { estado: "PROCESADO", canal: "EML_MANUAL" } });
    expect((await subir()).json().resultados[0].nuevo).toBe(false);
  });

  it("valida los buzones: central único y filtro obligatorio en buzones personales", async () => {
    const otro = await pedir("POST", "/correo/buzones", { direccion: "otro@gmail.com", rol: "CENTRAL", mecanismo: "GMAIL_API", titular: "Otra persona", autorizacionFecha: "2026-01-01", autorizacionForma: "x" + "y" });
    expect(otro.json.codigo).toBe("CENTRAL_EXISTENTE");
    const sinFiltro = await pedir("POST", "/correo/buzones", { direccion: "madre@gmail.com", rol: "ORIGEN", mecanismo: "GMAIL_API", titular: "Madre", autorizacionFecha: "2026-01-01", autorizacionForma: "Escrita" });
    expect(sinFiltro.json.detalles.filtro).toContain("label:Comprobantes");
  });
});
