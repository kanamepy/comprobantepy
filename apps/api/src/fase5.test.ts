/**
 * Pruebas de la Fase 5: seguimiento y proyección del IRP-RSP (criterios 28 a 32).
 * Requieren TEST_DATABASE_URL (la base se borra en cada ejecución).
 */
import { calcularDV } from "@comprobantepy/shared";
import type { FastifyInstance } from "fastify";
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

describe.skipIf(!url)("Fase 5 – IRP-RSP (integración)", () => {
  const { db, pool } = crearConexion(url);
  let app: FastifyInstance;
  let cookie = "";
  let ana = 0;
  const egresos: number[] = [];
  let pendienteId = 0;

  async function pedir(metodo: "GET" | "POST" | "PATCH" | "PUT", ruta: string, cuerpo?: unknown) {
    const r = await app.inject({ method: metodo, url: `/api${ruta}`, headers: { cookie }, payload: cuerpo as object });
    return { estado: r.statusCode, json: r.json() };
  }
  const tablero = async (e = 2026) => (await pedir("GET", `/irp/${ana}/${e}`)).json;

  /** Comprobante físico del proveedor, imputado al 100 % a IVA y a IRP-RSP. */
  async function comprobante(numero: string, total: number, fecha: string, aprobar: boolean) {
    const id = (await pedir("POST", "/comprobantes", { contribuyenteId: ana, naturaleza: "FISICO" })).json.comprobanteId as number;
    await pedir("PATCH", `/comprobantes/${id}`, {
      proveedor: { tipoIdentificacion: 11, identificacion: PROVEEDOR, razonSocial: "Librería" },
      tipoComprobante: 109, timbrado: 11112222, numero, fechaEmision: fecha, condicion: 1, gravado10: String(total), total: String(total),
    });
    const detalle = (await pedir("GET", `/comprobantes/${id}`)).json;
    if (detalle.proveedor.estado !== "CONFIRMADO") await pedir("POST", `/proveedores/${detalle.proveedor.id}/estado`, { estado: "CONFIRMADO" });
    await pedir("PUT", `/comprobantes/${id}/imputacion`, { lineas: [{ obligacion: "IVA", porcentaje: 100 }, { obligacion: "IRP_RSP", porcentaje: 100 }], porcentajeNoImputado: 0 });
    if (aprobar) {
      expect((await pedir("POST", `/comprobantes/${id}/acciones`, { accion: "CONFIRMAR" })).estado).toBe(200);
      expect((await pedir("POST", `/comprobantes/${id}/acciones`, { accion: "APROBAR" })).estado).toBe(200);
    }
    return id;
  }

  beforeAll(async () => {
    await pool.query("DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;");
    await migrar(url);
    const secreto = generarSecretoTotp();
    await db.insert(usuarios).values({
      email: "admin@ejemplo.com", nombre: "Admin", passwordHash: await hashPassword("clave-admin-segura"), esAdministrador: true, totpActivo: true, totpSecretoCifrado: cifrar(secreto),
    });
    app = await construirApp({ db, logger: false, almacenamiento: almacenamientoLocal("/tmp/cpy-irp") });
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin@ejemplo.com", password: "clave-admin-segura", codigoTotp: codigoTotp(secreto) } });
    cookie = `sesion=${login.cookies.find((c) => c.name === "sesion")!.value}`;
    ana = (await pedir("POST", "/contribuyentes", {
      nombre: "Ana", tipoIdentificacion: "RUC", identificacion: "1234567-9", autorizacionFecha: "2026-01-01", autorizacionForma: "Escrita", autorizacionAlcance: "Todo",
    })).json.id;
    for (const obligacion of ["IRP_RSP", "IVA"]) await pedir("POST", `/contribuyentes/${ana}/obligaciones`, { obligacion, vigenteDesde: "2025-01-01" });
  });

  afterAll(async () => {
    await app?.close();
    await pool.end();
  });

  it("caso de control: renta neta de G. 200.000.000 → impuesto G. 18.000.000 (criterio 29)", async () => {
    expect((await pedir("POST", `/irp/${ana}/ingresos`, { fecha: "2026-01-31", tipo: "HONORARIOS", tratamiento: "GRAVADO", importe: 200_000_000 })).estado).toBe(201);
    const t = (await tablero()).tablero;
    expect(t.ingresos.gravados.confirmado).toBe(200_000_000);
    expect(t.escenarios.confirmado).toMatchObject({ rentaNetaImponible: 200_000_000, impuestoDeterminado: 18_000_000 });
    expect(t.aviso).toContain("no sustituye la declaración jurada");
    expect(t.advertencias.join()).toContain("saldo a favor del ejercicio anterior");
  });

  it("los egresos sin tratamiento confirmado solo cuentan en el escenario proyectado (criterio 31)", async () => {
    egresos.push(await comprobante("001-001-0000001", 1_100_000, "2026-02-10", true));
    pendienteId = await comprobante("001-001-0000002", 550_000, "2026-02-20", false);
    const t = (await tablero()).tablero;
    expect(t.egresos.admitidosConfirmados).toBe(0);
    expect(t.egresos.pendientes).toBe(1_650_000);
    expect(t.escenarios.proyectado.rentaNetaImponible).toBe(200_000_000 - 1_650_000);
    expect(t.escenarios.confirmado.rentaNetaImponible).toBe(200_000_000);
    expect(t.advertencias.join()).toMatch(/no están aprobados/);
  });

  it("confirmar el tratamiento: imputado a IVA e IRP-RSP suma una sola vez (criterio 28)", async () => {
    const r = await pedir("POST", `/irp/${ana}/egresos/tratamiento`, { ids: egresos, tratamiento: "DEDUCIBLE" });
    expect(r.json.aplicados).toEqual(egresos);
    const t = (await tablero()).tablero;
    expect(t.egresos.admitidosConfirmados).toBe(1_100_000);
    expect(t.escenarios.confirmado.rentaNetaImponible).toBe(200_000_000 - 1_100_000);
  });

  it("deducción parcial y sugerencia según el historial del proveedor", async () => {
    const parcial = await comprobante("001-001-0000003", 1_000_000, "2026-02-25", true);
    await pedir("POST", `/irp/${ana}/egresos/tratamiento`, { ids: [parcial], tratamiento: "PARCIAL", porcentajeAdmitido: 40 });
    let t = (await tablero()).tablero;
    expect(t.egresos.admitidosConfirmados).toBe(1_100_000 + 400_000);

    const nuevo = await comprobante("001-001-0000004", 200_000, "2026-02-26", true);
    const lista = (await pedir("GET", `/irp/${ana}/2026/egresos`)).json as { id: number; sugerencia: { tratamiento: string } }[];
    expect(lista.find((e) => e.id === nuevo)!.sugerencia.tratamiento).toBe("PARCIAL");
    const r = await pedir("POST", `/irp/${ana}/egresos/tratamiento`, { ids: [nuevo], usarSugerencia: true });
    expect(r.json.aplicados).toEqual([nuevo]);
    t = (await tablero()).tablero;
    expect(t.egresos.admitidosConfirmados).toBe(1_100_000 + 400_000 + 80_000);
  });

  it("saldo anterior, retenciones y percepciones reducen el saldo proyectado", async () => {
    for (const [tipo, importe] of [["SALDO_ANTERIOR", 1_000_000], ["RETENCION", 5_000_000], ["PERCEPCION", 500_000]] as const) {
      expect((await pedir("POST", `/irp/${ana}/2026/movimientos`, { fecha: "2026-01-15", tipo, importe })).estado).toBe(201);
    }
    const t = (await tablero()).tablero;
    const c = t.escenarios.confirmado;
    expect(c.saldoProyectado).toBe(c.impuestoDeterminado - 1_000_000 - 5_000_000 - 500_000);
    expect(t.advertencias.join()).not.toContain("saldo a favor del ejercicio anterior");
  });

  it("renta negativa: la renta imponible es 0 y no hay impuesto (criterio 30)", async () => {
    await pedir("POST", `/irp/${ana}/ingresos`, { fecha: "2025-05-10", tipo: "HONORARIOS", tratamiento: "GRAVADO", importe: 100_000 });
    const id = await comprobante("001-001-0000099", 500_000, "2025-05-12", true);
    await pedir("POST", `/irp/${ana}/egresos/tratamiento`, { ids: [id], tratamiento: "DEDUCIBLE" });
    const t = (await tablero(2025)).tablero;
    expect(t.escenarios.confirmado).toMatchObject({ rentaNetaCalculada: -400_000, rentaNetaImponible: 0, impuestoDeterminado: 0 });
  });

  it("después de un cierre mensual, los cambios exigen motivo y se ven como diferencia (criterio 32)", async () => {
    const cierre = await pedir("POST", `/irp/${ana}/2026/cierres`, { mes: 1 });
    expect(cierre.estado).toBe(201);
    expect((await pedir("POST", `/irp/${ana}/2026/cierres`, { mes: 1 })).json.codigo).toBe("YA_CERRADO");

    const sinMotivo = await pedir("POST", `/irp/${ana}/ingresos`, { fecha: "2026-01-20", tipo: "COMISIONES", tratamiento: "GRAVADO", importe: 3_000_000 });
    expect(sinMotivo.json.codigo).toBe("PERIODO_CERRADO");
    const conMotivo = await pedir("POST", `/irp/${ana}/ingresos`, { fecha: "2026-01-20", tipo: "COMISIONES", tratamiento: "GRAVADO", importe: 3_000_000, motivo: "Comisión informada tarde por la empresa" });
    expect(conMotivo.estado).toBe(201);

    const { rows } = await pool.query("SELECT accion, motivo, usuario_id, valor_nuevo FROM auditoria WHERE entidad = 'ingreso' AND accion = 'CREAR_POST_CIERRE'");
    expect(rows[0]).toMatchObject({ motivo: "Comisión informada tarde por la empresa", usuario_id: 1 });

    const { cierres } = await tablero();
    const enero = cierres.find((c: { mes: number }) => c.mes === 1);
    expect(enero.diferencias).toEqual(expect.arrayContaining([{ concepto: "ingresosGravados", cerrado: 200_000_000, actual: 203_000_000 }]));
    expect((await pedir("GET", `/irp/${ana}/2026`)).json.tablero.porMes[0].cerrado).toBe(true);

    expect((await pedir("POST", `/irp/${ana}/cierres/${enero.id}/reabrir`, {})).estado).toBe(400);
    expect((await pedir("POST", `/irp/${ana}/cierres/${enero.id}/reabrir`, { motivo: "Corrección de comisiones" })).json.estado).toBe("REABIERTO");
  });

  it("las tasas y tramos se configuran por ejercicio y se validan (RF-038)", async () => {
    const malo = await pedir("PUT", "/irp/parametros/2026", { tramos: [{ hasta: 50_000_000, tasaPuntosBasicos: 800 }], fuente: "Prueba" });
    expect(malo.estado).toBe(400);
    const antes = (await tablero()).tablero.escenarios.confirmado.impuestoDeterminado;
    const nuevo = await pedir("PUT", "/irp/parametros/2026", { tramos: [{ hasta: null, tasaPuntosBasicos: 1000 }], fuente: "Escenario de prueba: tasa única" });
    expect(nuevo.json.version).toBeGreaterThan(1);
    const despues = (await tablero()).tablero.escenarios.confirmado;
    expect(despues.impuestoDeterminado).not.toBe(antes);
    expect(despues.impuestoDeterminado).toBe(Math.round(despues.rentaNetaImponible * 0.1));
  });

  it("un posible duplicado no se suma", async () => {
    await pedir("POST", `/comprobantes/${pendienteId}/acciones`, { accion: "ANULAR", motivo: "Prueba" });
    const t = (await tablero()).tablero;
    expect(t.egresos.cantidad).toBe(3);
  });
});
