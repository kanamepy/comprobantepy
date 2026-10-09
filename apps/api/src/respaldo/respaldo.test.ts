/**
 * Respaldo y prueba de restauración contra una base propia (no toca la de las otras pruebas).
 * Requiere TEST_DATABASE_URL con un usuario que pueda crear bases y pg_dump/pg_restore.
 */
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { almacenamientoLocal, sha256 } from "../archivos/almacenamiento.js";
import { crearConexion } from "../db/conexion.js";
import { archivos, comprobantes, contribuyentes, usuarios } from "../db/esquema.js";
import { migrar } from "../db/migrar.js";
import { hashPassword } from "../auth/password.js";
import { crearRespaldo, listarRespaldos, podarRespaldos, probarRestauracion } from "./respaldo.js";

const urlPruebas = process.env.TEST_DATABASE_URL;
const clave = Buffer.alloc(32, 3);

describe.skipIf(!urlPruebas)("respaldos", () => {
  const nombre = `cpy_prueba_respaldo_${process.pid}`;
  const url = (() => {
    const u = new URL(urlPruebas ?? "postgres://x/y");
    u.pathname = `/${nombre}`;
    return u.toString();
  })();
  let carpeta = "";
  let admin: pg.Client;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: urlPruebas });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${nombre} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${nombre}`);
    await migrar(url);
    carpeta = await mkdtemp(join(tmpdir(), "cpy-respaldo-"));
    const almacen = almacenamientoLocal(join(carpeta, "archivos"), clave);
    const { db, pool } = crearConexion(url);
    try {
      const [u] = await db.insert(usuarios).values({ email: "r@r.com", nombre: "R", passwordHash: await hashPassword("clave-larga-123") }).returning();
      const [c] = await db
        .insert(contribuyentes)
        .values({ nombre: "Ana", tipoIdentificacion: "CI", numeroIdentificacion: "123", autorizacionFecha: "2026-01-01", autorizacionForma: "x", autorizacionAlcance: "x", creadoPor: u!.id })
        .returning();
      await db.insert(comprobantes).values({ contribuyenteId: c!.id, canal: "MANUAL", naturaleza: "FISICO", estadoTecnico: "EXTRAIDO", estadoFlujo: "PENDIENTE_DATOS" });
      for (const texto of ["uno", "dos"]) {
        const contenido = Buffer.from(`%PDF-1.4 ${texto}`);
        const huella = sha256(contenido);
        const ruta = await almacen.guardar(contenido, huella);
        await db.insert(archivos).values({ sha256: huella, nombreOriginal: `${texto}.pdf`, tipoMime: "application/pdf", tipoDetectado: "PDF", tamano: contenido.length, ruta, canal: "MANUAL", subidoPor: u!.id });
      }
    } finally {
      await pool.end();
    }
  });

  afterAll(async () => {
    await admin.query(`DROP DATABASE IF EXISTS ${nombre} WITH (FORCE)`);
    await admin.end();
    if (carpeta) await rm(carpeta, { recursive: true, force: true });
  });

  it("copia la base y los archivos, y la restauración de prueba los verifica", async () => {
    const opciones = { databaseUrl: url, carpetaArchivos: join(carpeta, "archivos"), carpetaRespaldos: join(carpeta, "respaldos") };
    const { carpeta: respaldo, manifiesto } = await crearRespaldo(opciones);
    expect(manifiesto.cantidadArchivos).toBe(2);
    const prueba = await probarRestauracion(respaldo, url, clave);
    expect(prueba).toMatchObject({ ok: true, archivosVerificados: 2, problemas: [] });
    expect(prueba.tablas).toMatchObject({ usuarios: 1, contribuyentes: 1, comprobantes: 1, archivos: 2 });

    // Un archivo dañado o una clave equivocada se detectan.
    const [sub] = await readdir(join(respaldo, "archivos"));
    const [sub2] = await readdir(join(respaldo, "archivos", sub!));
    const [archivo] = await readdir(join(respaldo, "archivos", sub!, sub2!));
    await writeFile(join(respaldo, "archivos", sub!, sub2!, archivo!), "dañado");
    const mala = await probarRestauracion(respaldo, url, clave);
    expect(mala.ok).toBe(false);
    expect(mala.problemas).toHaveLength(1);
    expect((await probarRestauracion(respaldo, url, Buffer.alloc(32, 9))).problemas).toHaveLength(2);
  });

  it("conserva solo los últimos respaldos", async () => {
    const opciones = { databaseUrl: url, carpetaArchivos: join(carpeta, "archivos"), carpetaRespaldos: join(carpeta, "respaldos") };
    await new Promise((r) => setTimeout(r, 1100));
    await crearRespaldo(opciones);
    expect(await listarRespaldos(opciones.carpetaRespaldos)).toHaveLength(2);
    expect(await podarRespaldos(opciones.carpetaRespaldos, 1)).toHaveLength(1);
    expect(await listarRespaldos(opciones.carpetaRespaldos)).toHaveLength(1);
  });
});
