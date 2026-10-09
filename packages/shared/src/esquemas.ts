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

const importeTexto = z
  .string()
  .trim()
  .regex(/^\d{1,18}(\.\d{1,2})?$/, "Importe inválido (usá punto para decimales, sin separador de miles)");

/** Identificación del proveedor tal como la carga el usuario. */
export const esquemaProveedorEntrada = z.object({
  tipoIdentificacion: z.union([z.literal(11), z.literal(12), z.literal(13), z.literal(14), z.literal(15), z.literal(17)]),
  /** RUC con DV ("80012345-6") o el número del documento. */
  identificacion: z.string().trim().min(1, "Falta la identificación").max(25),
  razonSocial: z.string().trim().max(250).optional(),
});

/** Edición de los datos de un comprobante (sección 16). Todos los campos son opcionales. */
export const esquemaEdicionComprobante = z
  .object({
    naturaleza: z.enum(["FISICO", "ELECTRONICO", "VIRTUAL", "NO_DETERMINADA"]),
    tipoComprobante: z.number().int().min(100).max(999).nullable(),
    proveedor: esquemaProveedorEntrada.nullable(),
    contribuyenteId: z.number().int().positive().nullable(),
    timbrado: z.number().int().min(0).max(99_999_999).nullable(),
    numero: z.string().trim().max(20).nullable(),
    fechaEmision: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida").nullable(),
    moneda: z.string().trim().length(3, "Código de moneda de 3 letras"),
    tipoCambio: z.string().trim().regex(/^\d{1,10}(\.\d{1,4})?$/, "Tipo de cambio inválido").nullable(),
    condicion: z.union([z.literal(1), z.literal(2)]).nullable(),
    receptorTipoIdentificacion: z.enum(["RUC", "CI", "OTRO"]).nullable(),
    receptorNumero: z.string().trim().max(20).nullable(),
    receptorDv: z.number().int().min(0).max(9).nullable(),
    receptorNombre: z.string().trim().max(250).nullable(),
    gravado10: importeTexto.nullable(),
    gravado5: importeTexto.nullable(),
    exento: importeTexto.nullable(),
    iva10: importeTexto.nullable(),
    iva5: importeTexto.nullable(),
    total: importeTexto.nullable(),
    asociadoNumero: z.string().trim().max(20).nullable(),
    asociadoTimbrado: z.number().int().min(1).max(99_999_999).nullable(),
    asociadoCdc: z.string().trim().max(60).nullable(),
    numeroCuenta: z.string().trim().max(30).nullable(),
    entidadFinanciera: z.string().trim().max(250).nullable(),
    numeroPatronalIps: z.string().trim().max(30).nullable(),
    especificarTipoDocumento: z.string().trim().max(50).nullable(),
    observaciones: z.string().trim().max(2000).nullable(),
    /** Obligatorio al corregir el receptor o el contribuyente (sección 2.3, regla 5). */
    motivo: z.string().trim().max(500),
  })
  .partial();
export type EdicionComprobante = z.infer<typeof esquemaEdicionComprobante>;

export const esquemaImputacion = z.object({
  lineas: z
    .array(
      z.object({
        obligacion: z.string().min(1),
        actividadId: z.number().int().positive().nullable().optional(),
        porcentaje: z.number().min(0).max(100),
      }),
    )
    .max(50),
  porcentajeNoImputado: z.number().min(0).max(100).default(0),
});
export type ImputacionEntrada = z.infer<typeof esquemaImputacion>;

export const esquemaAccion = z.object({
  accion: z.enum(["CONFIRMAR", "APROBAR", "OBSERVAR", "RECHAZAR", "ENVIAR_A_REVISION", "REABRIR", "ANULAR", "DESCARTAR_DUPLICADO"]),
  motivo: z.string().trim().max(500).optional(),
});

/** Acciones masivas (sección 16.3): nunca mezclan contribuyentes. */
export const esquemaAccionMasiva = esquemaAccion.extend({
  ids: z.array(z.number().int().positive()).min(1).max(500),
  contribuyenteId: z.number().int().positive(),
});

export const esquemaClasificacionMasiva = esquemaImputacion.extend({
  ids: z.array(z.number().int().positive()).min(1).max(500),
  contribuyenteId: z.number().int().positive(),
  modo: z.enum(["AGREGAR", "REEMPLAZAR", "COMPLETAR_VACIOS"]),
});

export const esquemaVerificacionTimbrado = z.object({
  resultado: z.enum(["VALIDO", "RECHAZADO"]),
  vigenciaDesde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida").nullable().optional(),
  vigenciaHasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida").nullable().optional(),
  /** Fecha y hora de la consulta en la DNIT (ISO). */
  consultaEn: z.string().min(10, "Indicá cuándo consultaste"),
  evidenciaArchivoId: z.number().int().positive().nullable().optional(),
  observacion: z.string().trim().max(1000).optional(),
});
