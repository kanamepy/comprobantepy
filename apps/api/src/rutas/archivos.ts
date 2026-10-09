import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { Almacenamiento } from "../archivos/almacenamiento.js";
import { ErrorHttp, exigirSesion } from "../auth/sesiones.js";
import type { BaseDeDatos } from "../db/conexion.js";
import { archivos, comprobanteArchivos, comprobantes, timbrados } from "../db/esquema.js";
import { guardarArchivo } from "../servicios/carga.js";
import { idsVisibles, puedeVerPendientes } from "../servicios/comprobantes.js";

export async function rutasArchivos(app: FastifyInstance, { db, almacenamiento }: { db: BaseDeDatos; almacenamiento: Almacenamiento }) {
  app.addHook("preHandler", exigirSesion);

  /** Descarga o vista previa de un archivo original, solo si el usuario puede ver algún comprobante que lo use. */
  app.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const usuario = request.usuario!;
    const id = Number(request.params.id);
    const [archivo] = await db.select().from(archivos).where(eq(archivos.id, id));
    if (!archivo) throw new ErrorHttp(404, "NO_ENCONTRADO", "Archivo inexistente");

    const vinculos = await db
      .select({ contribuyenteId: comprobantes.contribuyenteId })
      .from(comprobanteArchivos)
      .innerJoin(comprobantes, eq(comprobantes.id, comprobanteArchivos.comprobanteId))
      .where(eq(comprobanteArchivos.archivoId, id));
    const [evidenciaTimbrado] = await db.select({ id: timbrados.id }).from(timbrados).where(eq(timbrados.evidenciaArchivoId, id));
    const visibles = idsVisibles(usuario);
    const permitido =
      archivo.subidoPor === usuario.id ||
      vinculos.some((v) => (v.contribuyenteId === null ? puedeVerPendientes(usuario) : visibles.includes(v.contribuyenteId))) ||
      (Boolean(evidenciaTimbrado) && puedeVerPendientes(usuario));
    if (!permitido) throw new ErrorHttp(404, "NO_ENCONTRADO", "Archivo inexistente");

    const contenido = await almacenamiento.leer(archivo.ruta);
    const nombre = encodeURIComponent(archivo.nombreOriginal);
    const descargar = (request.query as { descargar?: string }).descargar === "1";
    reply
      .header("Content-Type", archivo.tipoDetectado === "XML" ? "text/plain; charset=utf-8" : archivo.tipoMime)
      .header("Content-Disposition", `${descargar ? "attachment" : "inline"}; filename*=UTF-8''${nombre}`)
      .header("X-Content-Type-Options", "nosniff");
    // El contenido viene de terceros: XML e imágenes se muestran aislados. Los PDF no,
    // porque el aislamiento impide que el visor de PDF del navegador los muestre.
    if (archivo.tipoDetectado !== "PDF") {
      reply.header("Content-Security-Policy", "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'");
    }
    return reply
      .header("Cache-Control", "private, no-store")
      .send(contenido);
  });

  /** Evidencia suelta (por ejemplo, la captura de la consulta de timbrado en la DNIT). */
  app.post("/evidencia", async (request, reply) => {
    const usuario = request.usuario!;
    if (!puedeVerPendientes(usuario)) throw new ErrorHttp(403, "SIN_PERMISO", "Tu perfil no permite cargar archivos");
    const parte = await request.file();
    if (!parte) throw new ErrorHttp(400, "SIN_ARCHIVOS", "Adjuntá un archivo");
    const { archivo } = await guardarArchivo(
      db,
      almacenamiento,
      { nombre: parte.filename || "evidencia", contenido: await parte.toBuffer(), canal: "EVIDENCIA" },
      usuario,
      ["PDF", "IMAGEN"],
    );
    reply.code(201);
    return { id: archivo.id, nombreOriginal: archivo.nombreOriginal };
  });
}

