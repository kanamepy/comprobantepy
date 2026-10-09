/**
 * Pruebas de integración contra un PostgreSQL real.
 * Ejecutar con: TEST_DATABASE_URL=postgres://usuario:clave@localhost:5432/comprobantepy_test npm test
 */
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { construirApp } from "./app.js";
import { hashPassword } from "./auth/password.js";
import { codigoTotp } from "./auth/totp.js";
import { crearConexion } from "./db/conexion.js";
import { usuarios } from "./db/esquema.js";
import { migrar } from "./db/migrar.js";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("API (integración)", () => {
  const { db, pool } = crearConexion(url);
  let app: FastifyInstance;
  let cookieAdmin = "";
  let secretoTotp = "";

  const contribuyenteValido = {
    nombre: "Ana Pérez",
    tipoIdentificacion: "RUC",
    identificacion: "1234567-9",
    relacion: "Titular",
    obligacionRegistro: "955",
    autorizacionFecha: "2026-09-28",
    autorizacionForma: "Autorización escrita firmada",
    autorizacionAlcance: "Registro de comprobantes y reportes tributarios",
  };

  async function login(email: string, password: string, codigoTotpLogin?: string) {
    return app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password, codigoTotp: codigoTotpLogin } });
  }

  function cookieDe(respuesta: { cookies: { name: string; value: string }[] }) {
    const cookie = respuesta.cookies.find((c) => c.name === "sesion");
    return `sesion=${cookie?.value}`;
  }

  beforeAll(async () => {
    await pool.query("DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;");
    await migrar(url);
    await db.insert(usuarios).values([
      { email: "admin@ejemplo.com", nombre: "Admin", passwordHash: await hashPassword("clave-admin-segura"), esAdministrador: true },
      { email: "auxiliar@ejemplo.com", nombre: "Auxiliar", passwordHash: await hashPassword("clave-auxiliar-segura") },
    ]);
    app = await construirApp({ db, logger: false });
  });

  afterAll(async () => {
    await app?.close();
    await pool.end();
  });

  it("rechaza credenciales inválidas", async () => {
    const respuesta = await login("admin@ejemplo.com", "incorrecta");
    expect(respuesta.statusCode).toBe(401);
    expect(respuesta.json().codigo).toBe("CREDENCIALES_INVALIDAS");
  });

  it("el administrador sin segundo factor debe configurarlo antes de operar", async () => {
    const respuesta = await login("ADMIN@ejemplo.com", "clave-admin-segura");
    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json().usuario.requiereConfigurar2fa).toBe(true);
    cookieAdmin = cookieDe(respuesta);

    const lista = await app.inject({ method: "GET", url: "/api/contribuyentes", headers: { cookie: cookieAdmin } });
    expect(lista.statusCode).toBe(403);
    expect(lista.json().codigo).toBe("REQUIERE_CONFIGURAR_2FA");
  });

  it("configura el segundo factor", async () => {
    const inicio = await app.inject({ method: "POST", url: "/api/auth/totp/iniciar", headers: { cookie: cookieAdmin } });
    secretoTotp = inicio.json().secreto;
    expect(inicio.json().uri).toContain("otpauth://totp/");

    const malo = await app.inject({
      method: "POST", url: "/api/auth/totp/confirmar", headers: { cookie: cookieAdmin }, payload: { codigo: "000000" },
    });
    expect(malo.statusCode).toBe(400);

    const ok = await app.inject({
      method: "POST", url: "/api/auth/totp/confirmar", headers: { cookie: cookieAdmin }, payload: { codigo: codigoTotp(secretoTotp) },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().usuario.requiereConfigurar2fa).toBe(false);
  });

  it("valida el RUC al dar de alta un contribuyente (criterio 16)", async () => {
    const respuesta = await app.inject({
      method: "POST", url: "/api/contribuyentes", headers: { cookie: cookieAdmin },
      payload: { ...contribuyenteValido, identificacion: "1234567-8" },
    });
    expect(respuesta.statusCode).toBe(400);
    expect(respuesta.json().detalles.identificacion).toContain("se esperaba 9");
  });

  it("crea un contribuyente, asigna perfil Financiero y audita", async () => {
    const respuesta = await app.inject({
      method: "POST", url: "/api/contribuyentes", headers: { cookie: cookieAdmin }, payload: contribuyenteValido,
    });
    expect(respuesta.statusCode).toBe(201);
    expect(respuesta.json()).toMatchObject({ numeroIdentificacion: "1234567", dv: 9, estado: "ACTIVO" });

    const duplicado = await app.inject({
      method: "POST", url: "/api/contribuyentes", headers: { cookie: cookieAdmin }, payload: contribuyenteValido,
    });
    expect(duplicado.statusCode).toBe(409);

    const yo = await app.inject({ method: "GET", url: "/api/auth/yo", headers: { cookie: cookieAdmin } });
    expect(yo.json().contribuyentes[0].perfiles).toEqual(["FINANCIERO"]);

    const { rows } = await pool.query("SELECT accion FROM auditoria WHERE entidad = 'contribuyente'");
    expect(rows.map((r) => r.accion)).toEqual(["CREAR"]);
  });

  it("la auditoría no se puede modificar ni borrar", async () => {
    await expect(pool.query("UPDATE auditoria SET accion = 'X'")).rejects.toThrow(/solo inserción/);
    await expect(pool.query("DELETE FROM auditoria")).rejects.toThrow(/solo inserción/);
    await expect(pool.query("TRUNCATE auditoria")).rejects.toThrow(/solo inserción/);
  });

  it("con segundo factor activo, el login exige el código", async () => {
    await app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie: cookieAdmin } });
    const sinSesion = await app.inject({ method: "GET", url: "/api/auth/yo", headers: { cookie: cookieAdmin } });
    expect(sinSesion.statusCode).toBe(401);

    const sinCodigo = await login("admin@ejemplo.com", "clave-admin-segura");
    expect(sinCodigo.json().codigo).toBe("REQUIERE_TOTP");
    const conCodigo = await login("admin@ejemplo.com", "clave-admin-segura", codigoTotp(secretoTotp));
    expect(conCodigo.statusCode).toBe(200);
    cookieAdmin = cookieDe(conCodigo);
  });

  it("un usuario sin perfiles no ve contribuyentes ni puede crearlos", async () => {
    const respuesta = await login("auxiliar@ejemplo.com", "clave-auxiliar-segura");
    const cookie = cookieDe(respuesta);
    const lista = await app.inject({ method: "GET", url: "/api/contribuyentes", headers: { cookie } });
    expect(lista.json()).toEqual([]);
    const alta = await app.inject({
      method: "POST", url: "/api/contribuyentes", headers: { cookie },
      payload: { ...contribuyenteValido, identificacion: "1111111-0" },
    });
    expect(alta.statusCode).toBe(403);
  });

  it("da de baja con motivo obligatorio", async () => {
    const [{ id }] = (await db.execute(sql`SELECT id FROM contribuyentes LIMIT 1`)).rows as { id: number }[];
    const sinMotivo = await app.inject({
      method: "POST", url: `/api/contribuyentes/${id}/baja`, headers: { cookie: cookieAdmin }, payload: {},
    });
    expect(sinMotivo.statusCode).toBe(400);
    const baja = await app.inject({
      method: "POST", url: `/api/contribuyentes/${id}/baja`, headers: { cookie: cookieAdmin },
      payload: { motivo: "El titular revocó la autorización" },
    });
    expect(baja.json().estado).toBe("BAJA");
  });
});
