/**
 * Segunda barrera de aislamiento (RLS): aunque la aplicación tuviera un error, PostgreSQL
 * no deja ver ni modificar datos de un contribuyente ajeno. Requiere TEST_DATABASE_URL con
 * un usuario que no sea superusuario.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "./auth/password.js";
import { crearConexion } from "./db/conexion.js";
import { almacenContexto } from "./db/contexto.js";
import { comprobantes, contribuyentes, ingresos, usuarios } from "./db/esquema.js";
import { migrar } from "./db/migrar.js";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("aislamiento por contribuyente en la base (RLS)", () => {
  const { db, pool } = crearConexion(url);
  let a = 0;
  let b = 0;
  let superusuario = false;
  /** drizzle envuelve el error de PostgreSQL: se mira la causa original. */
  const errorDe = async (promesa: Promise<unknown>) => {
    try {
      await promesa;
      return "sin error";
    } catch (error) {
      return String((error as { cause?: Error }).cause?.message ?? (error as Error).message);
    }
  };
  const como = <T>(ids: number[], fn: () => PromiseLike<T>) => almacenContexto.run({ sistema: false, contribuyentes: ids }, async () => await fn());

  beforeAll(async () => {
    await pool.query("DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;");
    await migrar(url);
    const { rows } = await pool.query<{ rolsuper: boolean }>("SELECT rolsuper FROM pg_roles WHERE rolname = current_user");
    superusuario = Boolean(rows[0]?.rolsuper);
    const [u] = await db.insert(usuarios).values({ email: "x@y.com", nombre: "X", passwordHash: await hashPassword("clave-larga-123") }).returning();
    const base = { tipoIdentificacion: "CI" as const, autorizacionFecha: "2026-01-01", autorizacionForma: "x", autorizacionAlcance: "x", creadoPor: u!.id };
    [{ id: a }, { id: b }] = await db.insert(contribuyentes).values([{ ...base, nombre: "A", numeroIdentificacion: "111" }, { ...base, nombre: "B", numeroIdentificacion: "222" }]).returning({ id: contribuyentes.id });
    const comprobante = { canal: "MANUAL" as const, naturaleza: "FISICO" as const, estadoTecnico: "EXTRAIDO", estadoFlujo: "PENDIENTE_DATOS" };
    await db.insert(comprobantes).values([{ ...comprobante, contribuyenteId: a }, { ...comprobante, contribuyenteId: b }, { ...comprobante, contribuyenteId: null }]);
    await db.insert(ingresos).values([
      { contribuyenteId: a, fecha: "2026-01-01", tipo: "HONORARIOS", tratamiento: "GRAVADO", importe: "100", estado: "CONFIRMADO" },
      { contribuyenteId: b, fecha: "2026-01-01", tipo: "HONORARIOS", tratamiento: "GRAVADO", importe: "200", estado: "CONFIRMADO" },
    ]);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("el usuario de la base no es superusuario (si lo fuera, RLS no aplicaría)", () => {
    expect(superusuario).toBe(false);
  });

  it("solo se ven los datos de los contribuyentes permitidos y los pendientes de asignación", async () => {
    const vistos = await como([a], () => db.select({ c: comprobantes.contribuyenteId }).from(comprobantes));
    expect(vistos.map((v) => v.c).sort()).toEqual([a, null].sort());
    const ing = await como([a], () => db.select({ importe: ingresos.importe }).from(ingresos));
    expect(ing.map((i) => i.importe)).toEqual(["100"]);
    expect(await como([], () => db.select().from(ingresos))).toEqual([]);
  });

  it("no se puede modificar ni crear datos de un contribuyente ajeno", async () => {
    const modificados = await como([a], () => db.update(ingresos).set({ importe: "999" }).where(eq(ingresos.contribuyenteId, b)).returning());
    expect(modificados).toEqual([]);
    expect(
      await errorDe(como([a], () => db.insert(ingresos).values({ contribuyenteId: b, fecha: "2026-01-02", tipo: "HONORARIOS", tratamiento: "GRAVADO", importe: "1", estado: "CONFIRMADO" }))),
    ).toMatch(/row-level security/);
    // Tampoco se puede "pasar" un comprobante propio a otro contribuyente.
    expect(await errorDe(como([a], () => db.update(comprobantes).set({ contribuyenteId: b }).where(eq(comprobantes.contribuyenteId, a))))).toMatch(
      /row-level security/,
    );
  });

  it("un usuario con varios contribuyentes ve todos los suyos", async () => {
    const ing = await como([a, b], () => db.select({ importe: ingresos.importe }).from(ingresos));
    expect(ing.map((i) => i.importe).sort()).toEqual(["100", "200"]);
  });

  it("los procesos del sistema (trabajador, migraciones) no tienen restricción", async () => {
    expect(await db.select().from(ingresos)).toHaveLength(2);
  });
});
