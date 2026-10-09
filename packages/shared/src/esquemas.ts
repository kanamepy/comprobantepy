/** Esquemas Zod compartidos por el formulario web y la API. */
import { z } from "zod";
import { OBLIGACIONES_REGISTRO } from "./catalogos.js";
import { validarRuc } from "./ruc.js";

export const esquemaLogin = z.object({
  email: z.string().trim().toLowerCase().email("Correo inválido"),
  password: z.string().min(1, "Ingresá la contraseña"),
  codigoTotp: z
    .string()
    .regex(/^\d{6}$/, "El código tiene 6 dígitos")
    .optional(),
});
export type DatosLogin = z.infer<typeof esquemaLogin>;

export const esquemaCodigoTotp = z.object({
  codigo: z.string().regex(/^\d{6}$/, "El código tiene 6 dígitos"),
});

/** Alta de contribuyente (secciones 2.2 y 2.6). */
export const esquemaContribuyente = z
  .object({
    nombre: z.string().trim().min(2, "Ingresá el nombre").max(200),
    tipoIdentificacion: z.enum(["RUC", "CI"]),
    /** RUC con DV ("80012345-6") o número de cédula. */
    identificacion: z.string().trim().min(1, "Ingresá la identificación").max(25),
    relacion: z.string().trim().max(100).optional(),
    obligacionRegistro: z.enum(OBLIGACIONES_REGISTRO).nullable().optional(),
    correoContacto: z.string().trim().email("Correo inválido").optional().or(z.literal("")),
    autorizacionFecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha de autorización requerida"),
    autorizacionForma: z.string().trim().min(2, "Indicá cómo autorizó el titular").max(200),
    autorizacionAlcance: z.string().trim().min(2, "Indicá el alcance de la autorización").max(500),
  })
  .superRefine((datos, ctx) => {
    if (datos.tipoIdentificacion === "RUC") {
      const resultado = validarRuc(datos.identificacion);
      if (!resultado.valido) {
        ctx.addIssue({ code: "custom", path: ["identificacion"], message: `RUC inválido: ${resultado.motivo}` });
      }
    } else if (!/^\d{1,15}$/.test(datos.identificacion)) {
      ctx.addIssue({ code: "custom", path: ["identificacion"], message: "La cédula debe contener solo números" });
    }
  });
export type DatosContribuyente = z.infer<typeof esquemaContribuyente>;
