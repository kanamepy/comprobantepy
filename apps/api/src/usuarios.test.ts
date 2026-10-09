/** Gestión de usuarios y perfiles (secciones 5 y 24.2). Requiere TEST_DATABASE_URL. */
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

describe.skipIf(!url)("usuarios y perfiles (integración)", () => {
  const { db, pool } = crearConexion(url);
  let app: FastifyInstance;
  let cookie = "";
  let ana = 0;
  let madre = 0;
  let madreUsuario = 0;

  async function pedir(metodo: "GET" | "POST" | "PATCH" | "PUT", ruta: string, cuerpo?: unknown, c = cookie) {
    const r = await app.inject({ method: metodo, url: `/api${ruta}`, headers: { cookie: c }, payload: cuerpo as object });
    return { estado: r.statusCode, json: r.json() };
  }
  async function ingresar(email: string, password: string) {
    const r = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password } });
    return { estado: r.statusCode, cookie: `sesion=${r.cookies.find((x) => x.name === "sesion")?.value}`, json: r.json() };
  }

  beforeAll(async () => {
    await pool.query("DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;");
    await migrar(url);
    const secreto = generarSecretoTotp();
    await db.insert(usuarios).values({ email: "admin@ejemplo.com", nombre: "Admin", passwordHash: await hashPassword("clave-admin-segura"), esAdministrador: true, totpActivo: true, totpSecretoCifrado: cifrar(secreto) });
    app = await construirApp({ db, logger: false, almacenamiento: almacenamientoLocal("/tmp/cpy-usuarios") });
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin@ejemplo.com", password: "clave-admin-segura", codigoTotp: codigoTotp(secreto) } });
    cookie = `sesion=${login.cookies.find((c) => c.name === "sesion")!.value}`;
    const aut = { autorizacionFecha: "2026-01-01", autorizacionForma: "Escrita", autorizacionAlcance: "Todo" };
    ana = (await pedir("POST", "/contribuyentes", { nombre: "Ana", tipoIdentificacion: "RUC", identificacion: "1234567-9", ...aut })).json.id;
    madre = (await pedir("POST", "/contribuyentes", { nombre: "Madre", tipoIdentificacion: "CI", identificacion: "2222222", ...aut })).json.id;
  });

  afterAll(async () => {
    await app?.close();
    await pool.end();
  });

  it("el administrador crea un usuario de consulta para la titular (perfil Consulta, sección 5.4)", async () => {
    const r = await pedir("POST", "/usuarios", { email: "Madre@Ejemplo.com", nombre: "Madre", password: "clave-madre-segura" });
    expect(r.estado).toBe(201);
    madreUsuario = r.json.id;
    expect((await pedir("POST", "/usuarios", { email: "madre@ejemplo.com", nombre: "Otra", password: "clave-madre-segura" })).json.codigo).toBe("USUARIO_EXISTENTE");
    expect((await pedir("PUT", `/usuarios/${madreUsuario}/perfiles`, { perfiles: [{ contribuyenteId: madre, perfil: "CONSULTA" }] })).estado).toBe(200);

    const sesionMadre = await ingresar("madre@ejemplo.com", "clave-madre-segura");
    expect(sesionMadre.estado).toBe(200);
    expect(sesionMadre.json.usuario.requiereConfigurar2fa).toBe(false);
    expect(sesionMadre.json.contribuyentes.map((c: { id: number }) => c.id)).toEqual([madre]);
    // Solo lectura: no puede cargar comprobantes ni ver los de otro contribuyente (criterio 24.2).
    expect((await pedir("POST", "/comprobantes", { contribuyenteId: madre }, sesionMadre.cookie)).estado).toBe(403);
    expect((await pedir("GET", `/irp/${ana}/2026`, undefined, sesionMadre.cookie)).estado).toBe(404);
    expect((await pedir("GET", `/irp/${madre}/2026`, undefined, sesionMadre.cookie)).estado).toBe(200);
  });

  it("asignar el perfil Financiero exige configurar el segundo factor", async () => {
    await pedir("PUT", `/usuarios/${madreUsuario}/perfiles`, { perfiles: [{ contribuyenteId: madre, perfil: "FINANCIERO" }] });
    const sesionMadre = await ingresar("madre@ejemplo.com", "clave-madre-segura");
    expect(sesionMadre.json.usuario.requiereConfigurar2fa).toBe(true);
  });

  it("bloquear cierra sus sesiones e impide ingresar; no se puede bloquear a sí mismo", async () => {
    const antes = await ingresar("madre@ejemplo.com", "clave-madre-segura");
    await pedir("PATCH", `/usuarios/${madreUsuario}`, { bloqueado: true });
    expect((await pedir("GET", "/auth/yo", undefined, antes.cookie)).estado).toBe(401);
    expect((await ingresar("madre@ejemplo.com", "clave-madre-segura")).estado).toBe(403);
    expect((await pedir("PATCH", "/usuarios/1", { bloqueado: true })).json.codigo).toBe("SOBRE_SI_MISMO");
    await pedir("PATCH", `/usuarios/${madreUsuario}`, { bloqueado: false });
  });

  it("restablecer la contraseña y cambiar la propia", async () => {
    await pedir("PUT", `/usuarios/${madreUsuario}/perfiles`, { perfiles: [{ contribuyenteId: madre, perfil: "CONSULTA" }] });
    await pedir("POST", `/usuarios/${madreUsuario}/restablecer-password`, { password: "clave-nueva-madre" });
    expect((await ingresar("madre@ejemplo.com", "clave-madre-segura")).estado).toBe(401);
    const s = await ingresar("madre@ejemplo.com", "clave-nueva-madre");
    expect(s.estado).toBe(200);
    expect((await pedir("POST", "/usuarios/yo/password", { actual: "incorrecta", nueva: "otra-clave-larga" }, s.cookie)).estado).toBe(400);
    expect((await pedir("POST", "/usuarios/yo/password", { actual: "clave-nueva-madre", nueva: "otra-clave-larga" }, s.cookie)).estado).toBe(200);
    expect((await ingresar("madre@ejemplo.com", "otra-clave-larga")).estado).toBe(200);
  });

  it("solo el administrador gestiona usuarios", async () => {
    const s = await ingresar("madre@ejemplo.com", "otra-clave-larga");
    expect((await pedir("GET", "/usuarios", undefined, s.cookie)).estado).toBe(403);
  });
});
