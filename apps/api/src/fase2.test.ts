/**
 * Pruebas de integración de la Fase 2: lotes Marangatu, resultado DNIT y reporte consolidado.
 * Requieren TEST_DATABASE_URL (la base se borra en cada ejecución).
 */
import { calcularDV } from "@comprobantepy/shared";
import type { FastifyInstance } from "fastify";
import JSZip from "jszip";
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

const url = process.env.TEST_DATABASE_URL;
const RUC = "80054321";
const PROVEEDOR = `${RUC}-${calcularDV(RUC)}`;

describe.skipIf(!url)("Fase 2 (integración)", () => {
  const { db, pool } = crearConexion(url);
  let app: FastifyInstance;
  let carpeta: string;
  let cookie = "";
  let ana = 0;
  let madre = 0;
  const fisicos: number[] = [];
  let pendiente = 0;
  let electronico = 0;
  let loteId = 0;

  async function pedir(metodo: "GET" | "POST" | "PATCH" | "PUT", ruta: string, cuerpo?: unknown) {
    const r = await app.inject({ method: metodo, url: `/api${ruta}`, headers: { cookie }, payload: cuerpo as object });
    return { estado: r.statusCode, json: r.headers["content-type"]?.includes("json") ? r.json() : null, r };
  }

  /** Crea un comprobante y lo deja con los datos indicados; devuelve su id. */
  async function crear(naturaleza: string, datos: Record<string, unknown>, aprobar: boolean) {
    const id = (await pedir("POST", "/comprobantes", { contribuyenteId: ana, naturaleza })).json.comprobanteId as number;
    const r = await pedir("PATCH", `/comprobantes/${id}`, { proveedor: { tipoIdentificacion: 11, identificacion: PROVEEDOR, razonSocial: "Librería Central" }, ...datos });
    expect(r.estado).toBe(200);
    await pedir("PUT", `/comprobantes/${id}/imputacion`, {
      lineas: [{ obligacion: "IVA", porcentaje: 100 }, { obligacion: "IRP_RSP", porcentaje: 100 }],
      porcentajeNoImputado: 0,
    });
    if (aprobar) {
      expect((await pedir("POST", `/comprobantes/${id}/acciones`, { accion: "CONFIRMAR" })).estado).toBe(200);
      expect((await pedir("POST", `/comprobantes/${id}/acciones`, { accion: "APROBAR" })).estado).toBe(200);
    }
    return id;
  }

  const factura = (numero: string, total: number, fecha = "2026-03-10") => ({
    tipoComprobante: 109, timbrado: 11112222, numero, fechaEmision: fecha, condicion: 1, gravado10: String(total), total: String(total), iva10: String(Math.round(total / 11)),
  });

  beforeAll(async () => {
    await pool.query("DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;");
    await migrar(url);
    carpeta = await mkdtemp(join(tmpdir(), "cpy-lotes-"));
    const secreto = generarSecretoTotp();
    await db.insert(usuarios).values({
      email: "admin@ejemplo.com", nombre: "Admin", passwordHash: await hashPassword("clave-admin-segura"), esAdministrador: true, totpActivo: true, totpSecretoCifrado: cifrar(secreto),
    });
    app = await construirApp({ db, logger: false, almacenamiento: almacenamientoLocal(carpeta) });
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin@ejemplo.com", password: "clave-admin-segura", codigoTotp: codigoTotp(secreto) } });
    cookie = `sesion=${login.cookies.find((c) => c.name === "sesion")!.value}`;

    const autorizacion = { autorizacionFecha: "2026-01-01", autorizacionForma: "Escrita", autorizacionAlcance: "Todo" };
    ana = (await pedir("POST", "/contribuyentes", { nombre: "Ana", tipoIdentificacion: "RUC", identificacion: "1234567-9", obligacionRegistro: "955", ...autorizacion })).json.id;
    madre = (await pedir("POST", "/contribuyentes", { nombre: "Madre", tipoIdentificacion: "RUC", identificacion: "2222222-" + calcularDV("2222222"), ...autorizacion })).json.id;
    for (const obligacion of ["IRP_RSP", "IVA"]) await pedir("POST", `/contribuyentes/${ana}/obligaciones`, { obligacion, vigenteDesde: "2025-01-01" });

    // Primer comprobante: crea el proveedor; se confirma y se verifica el timbrado.
    const primero = (await pedir("POST", "/comprobantes", { contribuyenteId: ana, naturaleza: "FISICO" })).json.comprobanteId;
    await pedir("PATCH", `/comprobantes/${primero}`, { proveedor: { tipoIdentificacion: 11, identificacion: PROVEEDOR, razonSocial: "Librería Central" }, ...factura("001-001-0000001", 110000) });
    const detalle = (await pedir("GET", `/comprobantes/${primero}`)).json;
    await pedir("POST", `/proveedores/${detalle.proveedor.id}/estado`, { estado: "CONFIRMADO" });
    await pedir("POST", `/proveedores/timbrados/${detalle.timbrado.id}/verificacion`, { resultado: "VALIDO", vigenciaDesde: "2026-01-01", vigenciaHasta: "2026-12-31", consultaEn: "2026-03-11T10:00:00Z" });
    await pedir("PUT", `/comprobantes/${primero}/imputacion`, { lineas: [{ obligacion: "IVA", porcentaje: 100 }, { obligacion: "IRP_RSP", porcentaje: 100 }], porcentajeNoImputado: 0 });
    await pedir("POST", `/comprobantes/${primero}/acciones`, { accion: "CONFIRMAR" });
    await pedir("POST", `/comprobantes/${primero}/acciones`, { accion: "APROBAR" });
    fisicos.push(primero);
    fisicos.push(await crear("FISICO", factura("001-001-0000002", 55000, "2026-03-20"), true));
    pendiente = await crear("FISICO", factura("001-001-0000003", 22000, "2026-03-25"), false);
    electronico = await crear("ELECTRONICO", factura("001-001-0000004", 33000, "2026-03-15"), true);
  });

  afterAll(async () => {
    await app?.close();
    await pool.end();
    if (carpeta) await rm(carpeta, { recursive: true, force: true });
  });

  it("prepara el lote con conciliación previa y motivos de exclusión (18.6)", async () => {
    const r = await pedir("GET", `/lotes/preparar?contribuyenteId=${ana}&anio=2026&mes=3`);
    expect(r.estado).toBe(200);
    expect(r.json.elegibles.map((e: { id: number }) => e.id)).toEqual(fisicos);
    expect(r.json.noElegibles).toEqual([expect.objectContaining({ id: pendiente, elegibilidad: expect.objectContaining({ estado: "NO_ELEGIBLE" }) })]);
    // El electrónico nunca aparece como candidato (criterio 21).
    expect(JSON.stringify(r.json)).not.toContain(`"id":${electronico},`);
    expect(r.json.conciliacion.cantidadPorTipoRegistro).toEqual({ compras: 2, egresos: 0 });
    expect(r.json.conciliacion.sumas.comprasTotal).toBe(165000);
  });

  it("exige la obligación de registro del contribuyente (D-06)", async () => {
    const r = await pedir("GET", `/lotes/preparar?contribuyenteId=${madre}&anio=2026&mes=3`);
    expect(r.estado).toBe(409);
    expect(r.json.codigo).toBe("SIN_OBLIGACION_REGISTRO");
  });

  it("rechaza generar con comprobantes no elegibles", async () => {
    const r = await pedir("POST", "/lotes", { contribuyenteId: ana, anio: 2026, mes: 3, ids: [...fisicos, electronico] });
    expect(r.estado).toBe(422);
    expect(r.json.detalles).toEqual([expect.objectContaining({ id: String(electronico) })]);
  });

  it("genera el archivo con nombre, 20 campos, ZIP y huella (criterios 22, 25 y 26)", async () => {
    const r = await pedir("POST", "/lotes", { contribuyenteId: ana, anio: 2026, mes: 3, ids: fisicos });
    expect(r.estado).toBe(201);
    loteId = r.json.id;
    const detalle = (await pedir("GET", `/lotes/${loteId}`)).json;
    expect(detalle.lote).toMatchObject({ obligacion: "955", estado: "GENERADO", versionMatriz: expect.stringContaining("2021") });
    const [archivo] = detalle.archivos;
    expect(archivo.nombreZip).toBe("1234567_REG_032026_V0001.zip");

    const zip = await pedir("GET", `/lotes/${loteId}/archivos/${archivo.id}`);
    expect(zip.r.headers["content-type"]).toBe("application/zip");
    const contenido = await JSZip.loadAsync(zip.r.rawPayload);
    const texto = await contenido.file("1234567_REG_032026_V0001.txt")!.async("string");
    const lineas = texto.split("\n").slice(0, -1);
    expect(lineas).toHaveLength(2);
    expect(lineas[0]!.split("\t")).toEqual([
      "2", "11", RUC, "", "109", "10/03/2026", "11112222", "001-001-0000001", "110000", "0", "0", "110000", "1", "N", "S", "N", "S", "N", "", "",
    ]);
    expect(detalle.lote.conciliacion.sumas.comprasTotal).toBe(165000);

    const c = (await pedir("GET", `/comprobantes/${fisicos[0]}`)).json;
    expect(c.elegibilidad.estado).toBe("INCLUIDO_EN_LOTE");
  });

  it("un comprobante solo está en un lote activo y no se observa mientras tanto", async () => {
    expect((await pedir("POST", "/lotes", { contribuyenteId: ana, anio: 2026, mes: 3, ids: [fisicos[0]] })).estado).toBe(422);
    const observar = await pedir("POST", `/comprobantes/${fisicos[0]}/acciones`, { accion: "OBSERVAR", motivo: "Prueba" });
    expect(observar.estado).toBe(409);
    expect(observar.json.error).toContain("anulá primero el lote");
  });

  it("anular el lote libera los comprobantes y el identificador no se reutiliza", async () => {
    expect((await pedir("POST", `/lotes/${loteId}/anular`, { motivo: "Faltaba un comprobante" })).estado).toBe(200);
    expect((await pedir("GET", `/comprobantes/${fisicos[0]}`)).json.elegibilidad.estado).toBe("ELEGIBLE");
    const r = await pedir("POST", "/lotes", { contribuyenteId: ana, anio: 2026, mes: 3, ids: fisicos });
    loteId = r.json.id;
    expect((await pedir("GET", `/lotes/${loteId}`)).json.archivos[0].nombreZip).toBe("1234567_REG_032026_V0002.zip");
  });

  it("registra el envío y el resultado de la DNIT (18.7)", async () => {
    expect((await pedir("POST", `/lotes/${loteId}/resultado`, { rechazados: [], cerrar: true })).estado).toBe(409);
    expect((await pedir("POST", `/lotes/${loteId}/anular`, { motivo: "x" + "yz" })).estado).toBe(200);
    // Se anuló por error de la prueba anterior: se genera otra vez y se envía.
    loteId = (await pedir("POST", "/lotes", { contribuyenteId: ana, anio: 2026, mes: 3, ids: fisicos })).json.id;
    expect((await pedir("POST", `/lotes/${loteId}/enviado`, { fecha: "2026-04-05" })).estado).toBe(200);
    expect((await pedir("POST", `/lotes/${loteId}/anular`, { motivo: "Tarde" })).json.codigo).toBe("LOTE_ENVIADO");

    const resultado = await pedir("POST", `/lotes/${loteId}/resultado`, {
      rechazados: [{ comprobanteId: fisicos[1], error: "Timbrado no corresponde al RUC informado" }],
      cerrar: true,
    });
    expect(resultado.estado).toBe(200);
    const aceptado = (await pedir("GET", `/comprobantes/${fisicos[0]}`)).json;
    expect(aceptado.elegibilidad.estado).toBe("ACEPTADO_DNIT");
    const rechazado = (await pedir("GET", `/comprobantes/${fisicos[1]}`)).json;
    expect(rechazado.comprobante.estadoFlujo).toBe("OBSERVADO");
    expect(rechazado.comprobante.motivoEstado).toContain("Timbrado no corresponde");
    expect(rechazado.elegibilidad.estado).toBe("RECHAZADO_DNIT");
    expect((await pedir("GET", `/lotes/${loteId}`)).json.lote.estado).toBe("CERRADO");
  });

  it("el rechazado se corrige y se reenvía en un lote nuevo", async () => {
    const id = fisicos[1]!;
    expect((await pedir("PATCH", `/comprobantes/${id}`, { timbrado: 11112222, observaciones: "Corregido según la DNIT" })).estado).toBe(200);
    for (const accion of ["ENVIAR_A_REVISION", "CONFIRMAR", "APROBAR"]) {
      expect((await pedir("POST", `/comprobantes/${id}/acciones`, { accion })).estado).toBe(200);
    }
    expect((await pedir("GET", `/comprobantes/${id}`)).json.elegibilidad).toMatchObject({ estado: "ELEGIBLE", motivo: expect.stringContaining("reenviar") });
    const preparacion = (await pedir("GET", `/lotes/preparar?contribuyenteId=${ana}&anio=2026&mes=3`)).json;
    expect(preparacion.elegibles.map((e: { id: number }) => e.id)).toEqual([id]);
    const nuevo = await pedir("POST", "/lotes", { contribuyenteId: ana, anio: 2026, mes: 3, ids: [id] });
    expect((await pedir("GET", `/lotes/${nuevo.json.id}`)).json.archivos[0].nombreZip).toBe("1234567_REG_032026_V0004.zip");
  });

  it("el reporte consolidado suma una sola vez cada comprobante (criterio 28)", async () => {
    await pedir("POST", `/comprobantes/${pendiente}/acciones`, { accion: "ANULAR", motivo: "Duplicado en papel" });
    const r = (await pedir("GET", `/reportes/consolidado?contribuyenteId=${ana}&desde=2026-03-01&hasta=2026-03-31`)).json;
    // Definitivos: dos físicos (110.000 + 55.000) y un electrónico (33.000).
    expect(r.secciones.DEFINITIVO).toEqual({ cantidad: 3, total: 198000 });
    expect(r.secciones.ANULADO).toEqual({ cantidad: 1, total: 22000 });
    expect(r.definitivos.porNaturaleza).toEqual({ FISICO: { cantidad: 2, total: 165000 }, ELECTRONICO: { cantidad: 1, total: 33000 } });
    // Imputado al 100 % en IVA y en IRP-RSP: cada obligación muestra el total, sin duplicar el total general.
    expect(r.definitivos.porObligacion.IVA.imputado).toBe(198000);
    expect(r.definitivos.porObligacion.IRP_RSP.imputado).toBe(198000);

    const excel = await pedir("GET", `/reportes/consolidado.xlsx?contribuyenteId=${ana}&desde=2026-03-01&hasta=2026-03-31`);
    expect(excel.estado).toBe(200);
    expect(excel.r.rawPayload.subarray(0, 2).toString()).toBe("PK");
  });

  it("un comprobante aceptado por la DNIT se corrige con una nueva versión (sección 17)", async () => {
    const original = fisicos[0]!;
    expect((await pedir("PATCH", `/comprobantes/${original}`, { total: "1" })).json.codigo).toBe("NO_EDITABLE");
    const r = await pedir("POST", `/comprobantes/${original}/nueva-version`, { motivo: "El total correcto era otro" });
    expect(r.estado).toBe(201);
    const nueva = r.json.comprobanteId as number;
    expect(r.json.version).toBe(2);
    expect((await pedir("POST", `/comprobantes/${original}/nueva-version`, { motivo: "Otra vez" })).json.codigo).toBe("YA_REEMPLAZADO");

    // La nueva versión se puede corregir y vuelve a recorrer el flujo.
    expect((await pedir("PATCH", `/comprobantes/${nueva}`, { gravado10: "120000", total: "120000" })).estado).toBe(200);
    for (const accion of ["ENVIAR_A_REVISION", "CONFIRMAR", "APROBAR"]) {
      expect((await pedir("POST", `/comprobantes/${nueva}/acciones`, { accion })).estado).toBe(200);
    }
    expect((await pedir("GET", `/comprobantes/${nueva}`)).json.elegibilidad.estado).toBe("ELEGIBLE");
    // La versión histórica no admite acciones ni aparece en la bandeja.
    expect((await pedir("POST", `/comprobantes/${original}/acciones`, { accion: "ANULAR", motivo: "x" + "yz" })).json.error).toContain("versión histórica");
    const bandeja = (await pedir("GET", "/comprobantes")).json.comprobantes.map((c: { id: number }) => c.id);
    expect(bandeja).toContain(nueva);
    expect(bandeja).not.toContain(original);
    // El reporte suma solo la versión vigente.
    const reporte = (await pedir("GET", `/reportes/consolidado?contribuyenteId=${ana}&desde=2026-03-01&hasta=2026-03-31`)).json;
    expect(reporte.detalle.filter((d: { numero: string }) => d.numero === "001-001-0000001")).toHaveLength(1);
  });

  it("verificación manual de un documento electrónico ante SIFEN (sección 11.5)", async () => {
    const electronicoReal = (await pedir("POST", "/comprobantes", { contribuyenteId: ana, naturaleza: "ELECTRONICO" })).json.comprobanteId;
    await pool.query("UPDATE comprobantes SET estado_tecnico = 'VALIDACION_PENDIENTE' WHERE id = $1", [electronicoReal]);
    await pedir("PATCH", `/comprobantes/${electronicoReal}`, { observaciones: "x" });
    let d = (await pedir("GET", `/comprobantes/${electronicoReal}`)).json;
    expect(d.problemas.map((p: { codigo: string }) => p.codigo)).toContain("SIFEN_SIN_VERIFICAR");
    await pedir("POST", `/comprobantes/${electronicoReal}/verificacion-sifen`, { resultado: "RECHAZADO_SIFEN", consultaEn: "2026-04-01T10:00:00Z" });
    d = (await pedir("GET", `/comprobantes/${electronicoReal}`)).json;
    expect(d.problemas.find((p: { codigo: string }) => p.codigo === "RECHAZADO_SIFEN")?.severidad).toBe("ERROR");
    await pedir("POST", `/comprobantes/${electronicoReal}/verificacion-sifen`, { resultado: "VALIDADO_SIFEN", consultaEn: "2026-04-01T10:05:00Z" });
    d = (await pedir("GET", `/comprobantes/${electronicoReal}`)).json;
    expect(d.comprobante.estadoTecnico).toBe("VALIDADO_SIFEN");
    expect(d.problemas.map((p: { codigo: string }) => p.codigo)).not.toContain("SIFEN_SIN_VERIFICAR");
    expect((await pedir("POST", `/comprobantes/${fisicos[1]}/verificacion-sifen`, { resultado: "VALIDADO_SIFEN", consultaEn: "2026-04-01T10:05:00Z" })).json.codigo).toBe("NO_ELECTRONICO");
  });
});
