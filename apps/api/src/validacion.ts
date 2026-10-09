import type { z } from "zod";
import { ErrorHttp } from "./auth/sesiones.js";

/** Valida el cuerpo de una petición con un esquema Zod compartido; responde 400 con el detalle por campo. */
export function validar<T extends z.ZodType>(esquema: T, datos: unknown): z.infer<T> {
  const resultado = esquema.safeParse(datos);
  if (!resultado.success) {
    const campos: Record<string, string> = {};
    for (const problema of resultado.error.issues) {
      const ruta = problema.path.join(".") || "_";
      campos[ruta] ??= problema.message;
    }
    throw new ErrorHttp(400, "DATOS_INVALIDOS", "Revisá los datos ingresados", campos);
  }
  return resultado.data;
}
