/**
 * Respaldos desde la terminal:
 *   npm run respaldo                  -> crea un respaldo nuevo y borra los más viejos
 *   npm run respaldo -- probar        -> prueba restaurar el último respaldo (en una base temporal)
 *   npm run respaldo -- probar <carpeta>
 *   npm run respaldo -- listar
 */
import { config } from "../config.js";
import { crearRespaldo, listarRespaldos, podarRespaldos, probarRestauracion } from "../respaldo/respaldo.js";

const [accion = "crear", carpetaElegida] = process.argv.slice(2);

async function principal() {
  if (accion === "crear") {
    const { carpeta, manifiesto } = await crearRespaldo({
      databaseUrl: config.databaseUrl,
      carpetaArchivos: config.carpetaArchivos,
      carpetaRespaldos: config.carpetaRespaldos,
    });
    console.log(`Respaldo creado en ${carpeta}`);
    console.log(`  ${manifiesto.cantidadArchivos} archivos (${(manifiesto.bytesArchivos / 1024 / 1024).toFixed(1)} MB) y la base de datos.`);
    console.log(`  ${manifiesto.aviso}`);
    for (const borrado of await podarRespaldos(config.carpetaRespaldos, config.respaldosConservar)) console.log(`  Se borró el respaldo viejo ${borrado}`);
    return;
  }
  if (accion === "listar") {
    const lista = await listarRespaldos(config.carpetaRespaldos);
    console.log(lista.length ? lista.join("\n") : `No hay respaldos en ${config.carpetaRespaldos}`);
    return;
  }
  if (accion === "probar") {
    const carpeta = carpetaElegida ?? (await listarRespaldos(config.carpetaRespaldos))[0];
    if (!carpeta) throw new Error(`No hay respaldos en ${config.carpetaRespaldos}`);
    console.log(`Probando la restauración de ${carpeta} en una base temporal…`);
    const r = await probarRestauracion(carpeta, config.databaseUrl, config.claveCifrado);
    for (const [tabla, n] of Object.entries(r.tablas)) console.log(`  ${tabla}: ${n} filas`);
    console.log(`  Archivos verificados: ${r.archivosVerificados}`);
    for (const p of r.problemas) console.log(`  ⚠ ${p}`);
    console.log(r.ok ? "✔ El respaldo se puede restaurar." : "✘ El respaldo tiene problemas.");
    if (!r.ok) process.exitCode = 1;
    return;
  }
  throw new Error(`Acción desconocida: ${accion} (usá crear, probar o listar)`);
}

principal().catch((error) => {
  console.error("Error:", (error as Error).message);
  process.exit(1);
});
