/**
 * Respaldos (sección 21.6): copia de la base (pg_dump) y de los archivos originales, más
 * una prueba de restauración que recupera la copia en una base temporal y verifica que
 * cada archivo exista, se pueda descifrar y conserve su huella.
 *
 * Usa pg_dump/pg_restore instalados en la PC; si no están, los ejecuta dentro del
 * contenedor de docker compose ("postgres").
 */
import { spawn, spawnSync } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { almacenamientoLocal, sha256 } from "../archivos/almacenamiento.js";

export interface OpcionesRespaldo {
  databaseUrl: string;
  carpetaArchivos: string;
  carpetaRespaldos: string;
}

export interface Manifiesto {
  creadoEn: string;
  base: string;
  cantidadArchivos: number;
  bytesArchivos: number;
  aviso: string;
}

const AVISO =
  "Los archivos están cifrados con CLAVE_CIFRADO. Sin esa clave (guardada aparte, nunca junto a este respaldo) no se pueden leer.";

function hayLocal(herramienta: string) {
  return spawnSync(herramienta, ["--version"], { stdio: "ignore" }).status === 0;
}

/** Dentro del contenedor, PostgreSQL escucha en localhost:5432. */
function urlEnContenedor(url: string) {
  const u = new URL(url);
  u.hostname = "localhost";
  u.port = "5432";
  return u.toString();
}

function ejecutarPg(herramienta: "pg_dump" | "pg_restore", args: (url: string) => string[], url: string, e: { entrada?: string; salida?: string }) {
  const local = hayLocal(herramienta);
  const [comando, argumentos] = local
    ? [herramienta, args(url)]
    : ["docker", ["compose", "exec", "-T", "postgres", herramienta, ...args(urlEnContenedor(url))]];
  return new Promise<void>((resolver, rechazar) => {
    const proceso = spawn(comando, argumentos, { stdio: [e.entrada ? "pipe" : "ignore", e.salida ? "pipe" : "inherit", "pipe"] });
    let errores = "";
    proceso.stderr!.on("data", (d) => (errores += String(d)));
    if (e.entrada) createReadStream(e.entrada).pipe(proceso.stdin!);
    if (e.salida) proceso.stdout!.pipe(createWriteStream(e.salida));
    proceso.on("error", (error) =>
      rechazar(new Error(`No se pudo ejecutar ${herramienta}${local ? "" : " (ni en la PC ni con docker compose)"}: ${error.message}`)),
    );
    proceso.on("close", (codigo) => (codigo === 0 ? resolver() : rechazar(new Error(`${herramienta} terminó con error: ${errores.trim().slice(0, 500)}`))));
  });
}

async function contarArchivos(carpeta: string): Promise<{ cantidad: number; bytes: number }> {
  let cantidad = 0;
  let bytes = 0;
  for (const entrada of await readdir(carpeta, { recursive: true, withFileTypes: true }).catch(() => [])) {
    if (!entrada.isFile()) continue;
    cantidad++;
    bytes += (await stat(join(entrada.parentPath, entrada.name))).size;
  }
  return { cantidad, bytes };
}

function marcaDeTiempo(fecha = new Date()) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${fecha.getFullYear()}${p(fecha.getMonth() + 1)}${p(fecha.getDate())}-${p(fecha.getHours())}${p(fecha.getMinutes())}${p(fecha.getSeconds())}`;
}

/** Crea una carpeta respaldo-AAAAMMDD-HHMMSS con base.dump, archivos/ y manifiesto.json. */
export async function crearRespaldo(o: OpcionesRespaldo): Promise<{ carpeta: string; manifiesto: Manifiesto }> {
  const carpeta = join(o.carpetaRespaldos, `respaldo-${marcaDeTiempo()}`);
  await mkdir(carpeta, { recursive: true });
  try {
    // Primero la base y después los archivos: todo archivo referenciado ya está en disco.
    await ejecutarPg("pg_dump", (url) => ["--format=custom", "--no-owner", "--no-privileges", "--enable-row-security", `--dbname=${url}`], o.databaseUrl, {
      salida: join(carpeta, "base.dump"),
    });
    await cp(o.carpetaArchivos, join(carpeta, "archivos"), { recursive: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
    const { cantidad, bytes } = await contarArchivos(join(carpeta, "archivos"));
    const manifiesto: Manifiesto = { creadoEn: new Date().toISOString(), base: "base.dump", cantidadArchivos: cantidad, bytesArchivos: bytes, aviso: AVISO };
    await writeFile(join(carpeta, "manifiesto.json"), JSON.stringify(manifiesto, null, 2));
    return { carpeta, manifiesto };
  } catch (error) {
    await rm(carpeta, { recursive: true, force: true });
    throw error;
  }
}

/** Respaldos completos (con manifiesto), del más nuevo al más viejo. */
export async function listarRespaldos(carpetaRespaldos: string): Promise<string[]> {
  const nombres = (await readdir(carpetaRespaldos).catch(() => [] as string[])).filter((n) => n.startsWith("respaldo-")).sort().reverse();
  const completos: string[] = [];
  for (const nombre of nombres) {
    if (await stat(join(carpetaRespaldos, nombre, "manifiesto.json")).catch(() => null)) completos.push(join(carpetaRespaldos, nombre));
  }
  return completos;
}

/** Borra los respaldos más viejos y conserva los últimos `conservar`. */
export async function podarRespaldos(carpetaRespaldos: string, conservar: number) {
  const borrados: string[] = [];
  for (const carpeta of (await listarRespaldos(carpetaRespaldos)).slice(Math.max(1, conservar))) {
    await rm(carpeta, { recursive: true, force: true });
    borrados.push(carpeta);
  }
  return borrados;
}

export interface ResultadoPrueba {
  ok: boolean;
  tablas: Record<string, number>;
  archivosVerificados: number;
  problemas: string[];
}

// Las políticas de aislamiento sin contexto de sesión dejan ver todo (contexto de sistema),
// por eso pg_dump/pg_restore funcionan con --enable-row-security aun sin ser administrador.

/**
 * Restaura el respaldo en una base temporal (que luego se borra) y verifica los archivos.
 * No toca la base en uso. El usuario de la base necesita permiso para crear bases (CREATEDB).
 */
export async function probarRestauracion(carpeta: string, databaseUrl: string, clave: Buffer): Promise<ResultadoPrueba> {
  JSON.parse(await readFile(join(carpeta, "manifiesto.json"), "utf8")) as Manifiesto;
  const nombreTemporal = `cpy_prueba_restauracion_${Date.now()}`;
  const admin = new pg.Client({ connectionString: databaseUrl });
  await admin.connect();
  const urlTemporal = new URL(databaseUrl);
  urlTemporal.pathname = `/${nombreTemporal}`;
  const problemas: string[] = [];
  const tablas: Record<string, number> = {};
  let archivosVerificados = 0;
  try {
    await admin.query(`CREATE DATABASE ${nombreTemporal}`);
    try {
      await ejecutarPg("pg_restore", (url) => ["--no-owner", "--no-privileges", "--enable-row-security", "--exit-on-error", `--dbname=${url}`], urlTemporal.toString(), {
        entrada: join(carpeta, "base.dump"),
      });
      const restaurada = new pg.Client({ connectionString: urlTemporal.toString() });
      await restaurada.connect();
      try {
        // Contexto de sistema: el aislamiento por contribuyente no filtra el conteo.
        await restaurada.query("SELECT set_config('app.sistema', 'on', false)");
        for (const tabla of ["usuarios", "contribuyentes", "comprobantes", "archivos", "lotes", "auditoria"]) {
          tablas[tabla] = Number((await restaurada.query(`SELECT count(*) AS n FROM ${tabla}`)).rows[0].n);
        }
        const almacen = almacenamientoLocal(join(carpeta, "archivos"), clave);
        const { rows } = await restaurada.query<{ id: number; ruta: string; sha256: string }>("SELECT id, ruta, sha256 FROM archivos ORDER BY id");
        for (const fila of rows) {
          try {
            const contenido = await almacen.leer(fila.ruta);
            if (sha256(contenido) !== fila.sha256) problemas.push(`Archivo ${fila.id}: la huella no coincide`);
            else archivosVerificados++;
          } catch (error) {
            const codigo = (error as NodeJS.ErrnoException).code;
            problemas.push(`Archivo ${fila.id}: ${codigo === "ENOENT" ? "falta en el respaldo" : "no se pudo descifrar (¿otra CLAVE_CIFRADO?)"}`);
          }
        }
      } finally {
        await restaurada.end();
      }
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS ${nombreTemporal} WITH (FORCE)`);
    }
  } finally {
    await admin.end();
  }
  return { ok: problemas.length === 0, tablas, archivosVerificados, problemas };
}
