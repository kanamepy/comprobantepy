import { esquemaContribuyente, separarRuc } from "@comprobantepy/shared";
import { asc, eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { registrarAuditoria } from "../auditoria.js";
import { ErrorHttp, exigirAdministrador, exigirSesion, tienePerfil } from "../auth/sesiones.js";
import type { BaseDeDatos } from "../db/conexion.js";
import { contribuyentes, usuarioContribuyentePerfiles } from "../db/esquema.js";
import { validar } from "../validacion.js";

const esquemaBaja = z.object({ motivo: z.string().trim().min(5, "Indicá el motivo de la baja").max(500) });

export async function rutasContribuyentes(app: FastifyInstance, { db }: { db: BaseDeDatos }) {
  app.addHook("preHandler", exigirSesion);

  app.get("/", async (request) => {
    const usuario = request.usuario!;
    const ids = usuario.perfiles.map((p) => p.contribuyenteId);
    const consulta = db.select().from(contribuyentes).orderBy(asc(contribuyentes.nombre));
    if (usuario.esAdministrador) return consulta;
    if (ids.length === 0) return [];
    return consulta.where(inArray(contribuyentes.id, ids));
  });

  app.post("/", async (request, reply) => {
    exigirAdministrador(request);
    const datos = validar(esquemaContribuyente, request.body);
    const { numero, dv } =
      datos.tipoIdentificacion === "RUC" ? separarRuc(datos.identificacion) : { numero: datos.identificacion, dv: null };

    const creado = await db.transaction(async (tx) => {
      const [existente] = await tx
        .select({ id: contribuyentes.id })
        .from(contribuyentes)
        .where(eq(contribuyentes.numeroIdentificacion, numero));
      if (existente) {
        throw new ErrorHttp(409, "CONTRIBUYENTE_DUPLICADO", "Ya existe un contribuyente con esa identificación");
      }
      const [fila] = await tx
        .insert(contribuyentes)
        .values({
          nombre: datos.nombre,
          tipoIdentificacion: datos.tipoIdentificacion,
          numeroIdentificacion: numero,
          dv,
          relacion: datos.relacion || null,
          obligacionRegistro: datos.obligacionRegistro ?? null,
          correoContacto: datos.correoContacto || null,
          autorizacionFecha: datos.autorizacionFecha,
          autorizacionForma: datos.autorizacionForma,
          autorizacionAlcance: datos.autorizacionAlcance,
          creadoPor: request.usuario!.id,
        })
        .returning();
      // La usuaria principal administra a todos los contribuyentes con perfil Financiero (sección 5).
      await tx
        .insert(usuarioContribuyentePerfiles)
        .values({ usuarioId: request.usuario!.id, contribuyenteId: fila!.id, perfil: "FINANCIERO" });
      await registrarAuditoria(
        tx,
        { entidad: "contribuyente", entidadId: fila!.id, contribuyenteId: fila!.id, accion: "CREAR", valorNuevo: fila },
        request,
      );
      return fila!;
    });
    reply.code(201);
    return creado;
  });

  /** Baja lógica: conserva los registros pero impide nuevas cargas (sección 2.6). */
  app.post<{ Params: { id: string } }>("/:id/baja", async (request) => {
    const id = Number(request.params.id);
    const usuario = request.usuario!;
    if (!usuario.esAdministrador && !tienePerfil(usuario, id, ["FINANCIERO"])) {
      throw new ErrorHttp(403, "SIN_PERMISO", "No tenés permiso sobre este contribuyente");
    }
    const { motivo } = validar(esquemaBaja, request.body);
    return db.transaction(async (tx) => {
      const [anterior] = await tx.select().from(contribuyentes).where(eq(contribuyentes.id, id));
      if (!anterior) throw new ErrorHttp(404, "NO_ENCONTRADO", "Contribuyente inexistente");
      if (anterior.estado === "BAJA") throw new ErrorHttp(409, "YA_DADO_DE_BAJA", "El contribuyente ya está dado de baja");
      const [actualizado] = await tx
        .update(contribuyentes)
        .set({ estado: "BAJA", bajaMotivo: motivo, bajaEn: new Date(), bajaPor: usuario.id, actualizadoEn: new Date() })
        .where(eq(contribuyentes.id, id))
        .returning();
      await registrarAuditoria(
        tx,
        { entidad: "contribuyente", entidadId: id, contribuyenteId: id, accion: "BAJA", motivo, valorAnterior: anterior, valorNuevo: actualizado },
        request,
      );
      return actualizado;
    });
  });
}
