import { esquemaContribuyente, separarRuc } from "@comprobantepy/shared";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { registrarAuditoria } from "../auditoria.js";
import { ErrorHttp, exigirAdministrador, exigirSesion, tienePerfil, type UsuarioSesion } from "../auth/sesiones.js";
import type { BaseDeDatos } from "../db/conexion.js";
import { actividades, contribuyenteObligaciones, contribuyentes, obligaciones, usuarioContribuyentePerfiles } from "../db/esquema.js";
import { reevaluarPorContribuyente } from "../servicios/comprobantes.js";
import { validar } from "../validacion.js";

const esquemaBaja = z.object({ motivo: z.string().trim().min(5, "Indicá el motivo de la baja").max(500) });

const fechaIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida");
const esquemaObligacion = z.object({
  obligacion: z.string().min(1, "Elegí la obligación"),
  vigenteDesde: fechaIso,
  vigenteHasta: fechaIso.nullable().optional(),
});
const esquemaActividad = z.object({ descripcion: z.string().trim().min(2, "Describí la actividad").max(200) });
const esquemaMotivo = z.object({ motivo: z.string().trim().min(3, "Indicá el motivo").max(500) });

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

  /** Datos editables después del alta: relación, correo y obligación de registro (955/956). */
  app.patch<{ Params: { id: string } }>("/:id", async (request) => {
    const id = Number(request.params.id);
    exigirFinancieroDe(request, id);
    const cambios = validar(
      z
        .object({
          relacion: z.string().trim().max(100).nullable(),
          correoContacto: z.string().trim().email("Correo inválido").nullable().or(z.literal("")),
          obligacionRegistro: z.enum(["955", "956"]).nullable(),
        })
        .partial(),
      request.body,
    );
    return db.transaction(async (tx) => {
      const [anterior] = await tx.select().from(contribuyentes).where(eq(contribuyentes.id, id));
      if (!anterior) throw new ErrorHttp(404, "NO_ENCONTRADO", "Contribuyente inexistente");
      const [actualizado] = await tx
        .update(contribuyentes)
        .set({ ...cambios, correoContacto: cambios.correoContacto === "" ? null : cambios.correoContacto, actualizadoEn: new Date() })
        .where(eq(contribuyentes.id, id))
        .returning();
      await registrarAuditoria(
        tx,
        { entidad: "contribuyente", entidadId: id, contribuyenteId: id, accion: "EDITAR", valorAnterior: anterior, valorNuevo: actualizado },
        request,
      );
      return actualizado;
    });
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

  /** Solo el Financiero del contribuyente (o el administrador) configura obligaciones y actividades (sección 5.3). */
  function exigirFinancieroDe(request: { usuario: UsuarioSesion | null }, id: number) {
    const usuario = request.usuario!;
    if (!usuario.esAdministrador && !tienePerfil(usuario, id, ["FINANCIERO"])) {
      throw new ErrorHttp(403, "SIN_PERMISO", "No tenés permiso sobre este contribuyente");
    }
  }
  function exigirVisibleContribuyente(request: { usuario: UsuarioSesion | null }, id: number) {
    const usuario = request.usuario!;
    if (!usuario.esAdministrador && !usuario.perfiles.some((p) => p.contribuyenteId === id)) {
      throw new ErrorHttp(404, "NO_ENCONTRADO", "Contribuyente inexistente");
    }
  }

  app.get<{ Params: { id: string } }>("/:id/obligaciones", async (request) => {
    const id = Number(request.params.id);
    exigirVisibleContribuyente(request, id);
    return db
      .select({
        id: contribuyenteObligaciones.id,
        obligacion: contribuyenteObligaciones.obligacionCodigo,
        descripcion: obligaciones.descripcion,
        vigenteDesde: contribuyenteObligaciones.vigenteDesde,
        vigenteHasta: contribuyenteObligaciones.vigenteHasta,
        estado: contribuyenteObligaciones.estado,
      })
      .from(contribuyenteObligaciones)
      .innerJoin(obligaciones, eq(obligaciones.codigo, contribuyenteObligaciones.obligacionCodigo))
      .where(eq(contribuyenteObligaciones.contribuyenteId, id))
      .orderBy(asc(contribuyenteObligaciones.vigenteDesde));
  });

  app.post<{ Params: { id: string } }>("/:id/obligaciones", async (request, reply) => {
    const id = Number(request.params.id);
    exigirFinancieroDe(request, id);
    const datos = validar(esquemaObligacion, request.body);
    if (datos.vigenteHasta && datos.vigenteHasta < datos.vigenteDesde) {
      throw new ErrorHttp(400, "DATOS_INVALIDOS", "Revisá los datos ingresados", { vigenteHasta: "La vigencia termina antes de empezar" });
    }
    const creada = await db.transaction(async (tx) => {
      const [obligacion] = await tx.select().from(obligaciones).where(eq(obligaciones.codigo, datos.obligacion));
      if (!obligacion) throw new ErrorHttp(400, "DATOS_INVALIDOS", "Revisá los datos ingresados", { obligacion: "Obligación inexistente" });
      const [fila] = await tx
        .insert(contribuyenteObligaciones)
        .values({ contribuyenteId: id, obligacionCodigo: datos.obligacion, vigenteDesde: datos.vigenteDesde, vigenteHasta: datos.vigenteHasta ?? null })
        .returning();
      await registrarAuditoria(tx, { entidad: "contribuyente_obligacion", entidadId: fila!.id, contribuyenteId: id, accion: "CREAR", valorNuevo: fila }, request);
      await reevaluarPorContribuyente(tx, id);
      return fila;
    });
    reply.code(201);
    return creada;
  });

  app.post<{ Params: { id: string; oid: string } }>("/:id/obligaciones/:oid/anular", async (request) => {
    const id = Number(request.params.id);
    exigirFinancieroDe(request, id);
    const { motivo } = validar(esquemaMotivo, request.body);
    return db.transaction(async (tx) => {
      const [fila] = await tx
        .update(contribuyenteObligaciones)
        .set({ estado: "ANULADO", anuladoMotivo: motivo, actualizadoEn: new Date() })
        .where(and(eq(contribuyenteObligaciones.id, Number(request.params.oid)), eq(contribuyenteObligaciones.contribuyenteId, id)))
        .returning();
      if (!fila) throw new ErrorHttp(404, "NO_ENCONTRADO", "Obligación inexistente");
      await registrarAuditoria(tx, { entidad: "contribuyente_obligacion", entidadId: fila.id, contribuyenteId: id, accion: "ANULAR", motivo }, request);
      await reevaluarPorContribuyente(tx, id);
      return fila;
    });
  });

  app.get<{ Params: { id: string } }>("/:id/actividades", async (request) => {
    const id = Number(request.params.id);
    exigirVisibleContribuyente(request, id);
    return db.select().from(actividades).where(eq(actividades.contribuyenteId, id)).orderBy(asc(actividades.descripcion));
  });

  app.post<{ Params: { id: string } }>("/:id/actividades", async (request, reply) => {
    const id = Number(request.params.id);
    exigirFinancieroDe(request, id);
    const { descripcion } = validar(esquemaActividad, request.body);
    const creada = await db.transaction(async (tx) => {
      const [fila] = await tx.insert(actividades).values({ contribuyenteId: id, descripcion }).returning();
      await registrarAuditoria(tx, { entidad: "actividad", entidadId: fila!.id, contribuyenteId: id, accion: "CREAR", valorNuevo: fila }, request);
      return fila;
    });
    reply.code(201);
    return creada;
  });

  app.post<{ Params: { id: string; aid: string } }>("/:id/actividades/:aid/estado", async (request) => {
    const id = Number(request.params.id);
    exigirFinancieroDe(request, id);
    const { estado } = validar(z.object({ estado: z.enum(["ACTIVO", "INACTIVO"]) }), request.body);
    return db.transaction(async (tx) => {
      const [fila] = await tx
        .update(actividades)
        .set({ estado, actualizadoEn: new Date() })
        .where(and(eq(actividades.id, Number(request.params.aid)), eq(actividades.contribuyenteId, id)))
        .returning();
      if (!fila) throw new ErrorHttp(404, "NO_ENCONTRADO", "Actividad inexistente");
      await registrarAuditoria(tx, { entidad: "actividad", entidadId: fila.id, contribuyenteId: id, accion: `ESTADO_${estado}` }, request);
      return fila;
    });
  });
}
