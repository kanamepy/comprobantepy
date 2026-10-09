/**
 * Sondeo periódico de los buzones conectados, con monitoreo del token y alertas
 * (secciones 7.1 y RF-041). Es idempotente: un mensaje ya registrado no se reprocesa.
 */
import { and, eq, isNull, or, lt, sql } from "drizzle-orm";
import type { Almacenamiento } from "../archivos/almacenamiento.js";
import { descifrar } from "../cifrado.js";
import type { BaseDeDatos } from "../db/conexion.js";
import { alertas, buzones } from "../db/esquema.js";
import { adaptadorGmail, ErrorAutenticacionCorreo, type AdaptadorCorreo } from "./gmail.js";
import { registrarYProcesar, type FilaBuzon } from "./procesamiento.js";

export type FabricaAdaptador = (buzon: FilaBuzon) => AdaptadorCorreo;

export const fabricaGmail: FabricaAdaptador = (buzon) => adaptadorGmail(descifrar(buzon.credencialCifrada ?? ""), buzon.filtro);

export interface ResultadoSondeo {
  buzonId: number;
  leidos: number;
  nuevos: number;
  errores: string[];
  omitido?: string;
}

async function abrirAlerta(db: BaseDeDatos, tipo: string, mensaje: string, buzonId: number) {
  const [abierta] = await db
    .select({ id: alertas.id })
    .from(alertas)
    .where(and(eq(alertas.tipo, tipo), eq(alertas.buzonId, buzonId), isNull(alertas.resueltaEn)));
  if (!abierta) await db.insert(alertas).values({ tipo, mensaje, buzonId });
}

async function cerrarAlertas(db: BaseDeDatos, buzonId: number) {
  await db.update(alertas).set({ resueltaEn: new Date() }).where(and(eq(alertas.buzonId, buzonId), isNull(alertas.resueltaEn)));
}

export async function sondearBuzon(
  db: BaseDeDatos,
  almacenamiento: Almacenamiento,
  buzon: FilaBuzon,
  fabrica: FabricaAdaptador = fabricaGmail,
): Promise<ResultadoSondeo> {
  const resultado: ResultadoSondeo = { buzonId: buzon.id, leidos: 0, nuevos: 0, errores: [] };
  // Reserva el buzón: si otro proceso lo está leyendo (hace menos de 10 minutos), se omite.
  const [reservado] = await db
    .update(buzones)
    .set({ sondeoEnCurso: new Date() })
    .where(and(eq(buzones.id, buzon.id), or(isNull(buzones.sondeoEnCurso), lt(buzones.sondeoEnCurso, sql`now() - interval '10 minutes'`))))
    .returning({ id: buzones.id });
  if (!reservado) return { ...resultado, omitido: "Otro proceso está leyendo este buzón" };

  try {
    const adaptador = fabrica(buzon);
    const ids = await adaptador.listarPendientes();
    for (const id of ids) {
      resultado.leidos++;
      try {
        const { mensaje, nuevo } = await registrarYProcesar(db, almacenamiento, {
          crudo: await adaptador.obtenerCrudo(id),
          buzon,
          idProveedor: id,
          canal: "BUZON",
        });
        if (nuevo) resultado.nuevos++;
        // El correo nunca se borra: solo se etiqueta (sección 7.3).
        await adaptador.marcar(id, mensaje.estado);
      } catch (error) {
        if (error instanceof ErrorAutenticacionCorreo) throw error;
        resultado.errores.push(`${id}: ${(error as Error).message}`);
      }
    }
    await db
      .update(buzones)
      .set({ estado: "ACTIVO", ultimoSondeoEn: new Date(), ultimoError: resultado.errores[0] ?? null })
      .where(eq(buzones.id, buzon.id));
    await cerrarAlertas(db, buzon.id);
  } catch (error) {
    const mensaje = (error as Error).message;
    if (error instanceof ErrorAutenticacionCorreo) {
      await db.update(buzones).set({ estado: "ERROR_AUTENTICACION", ultimoError: mensaje }).where(eq(buzones.id, buzon.id));
      await abrirAlerta(
        db,
        "TOKEN_CORREO",
        `Se perdió la conexión con ${buzon.direccion}: hay que volver a conectarlo. Si el proyecto de Google sigue en modo "Testing", el permiso vence cada 7 días.`,
        buzon.id,
      );
    } else {
      await db.update(buzones).set({ ultimoError: mensaje }).where(eq(buzones.id, buzon.id));
      await abrirAlerta(db, "ERROR_CORREO", `Error al leer ${buzon.direccion}: ${mensaje}`, buzon.id);
    }
    resultado.errores.push(mensaje);
  } finally {
    await db.update(buzones).set({ sondeoEnCurso: null }).where(eq(buzones.id, buzon.id));
  }
  return resultado;
}

/** Lee todos los buzones conectados (los de reenvío no se leen: reenvían al central). */
export async function sondearTodos(db: BaseDeDatos, almacenamiento: Almacenamiento, fabrica: FabricaAdaptador = fabricaGmail) {
  const lista = await db
    .select()
    .from(buzones)
    .where(and(eq(buzones.mecanismo, "GMAIL_API"), sql`${buzones.estado} IN ('ACTIVO', 'ERROR_AUTENTICACION')`, sql`${buzones.credencialCifrada} IS NOT NULL`));
  const resultados: ResultadoSondeo[] = [];
  for (const buzon of lista) resultados.push(await sondearBuzon(db, almacenamiento, buzon, fabrica));
  return resultados;
}
