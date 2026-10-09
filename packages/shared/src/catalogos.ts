/**
 * Catálogos iniciales. En producción se versionan en la base de datos (sección 14.1);
 * estos valores son la versión inicial tomada de la Tabla 4 de la Especificación
 * Técnica para Importación de junio 2021 (sección 13.1).
 */

export type Destino = "COMPRAS" | "EGRESOS";

export type NaturalezaFiscal = "FISICO" | "ELECTRONICO" | "VIRTUAL" | "NO_DETERMINADA";

export interface TipoComprobante {
  codigo: number;
  descripcion: string;
  destino: Destino;
}

export const TIPOS_COMPROBANTE: readonly TipoComprobante[] = [
  { codigo: 101, descripcion: "Autofactura", destino: "COMPRAS" },
  { codigo: 102, descripcion: "Boleta de transporte público de pasajeros", destino: "COMPRAS" },
  { codigo: 103, descripcion: "Boleta de venta", destino: "COMPRAS" },
  { codigo: 104, descripcion: "Boleta Resimple", destino: "COMPRAS" },
  { codigo: 105, descripcion: "Boletos de loterías, juegos de azar", destino: "COMPRAS" },
  { codigo: 106, descripcion: "Boleto o ticket de transporte aéreo", destino: "COMPRAS" },
  { codigo: 107, descripcion: "Despacho de importación", destino: "COMPRAS" },
  { codigo: 108, descripcion: "Entrada a espectáculos públicos", destino: "COMPRAS" },
  { codigo: 109, descripcion: "Factura", destino: "COMPRAS" },
  { codigo: 110, descripcion: "Nota de crédito", destino: "COMPRAS" },
  { codigo: 111, descripcion: "Nota de débito", destino: "COMPRAS" },
  { codigo: 112, descripcion: "Ticket de máquina registradora", destino: "COMPRAS" },
  { codigo: 201, descripcion: "Comprobante de egresos por compras a crédito", destino: "EGRESOS" },
  { codigo: 202, descripcion: "Comprobante del exterior legalizado", destino: "EGRESOS" },
  {
    codigo: 204,
    descripcion: "Comprobante de ingresos de entidades públicas, religiosas o de beneficio público",
    destino: "EGRESOS",
  },
  { codigo: 205, descripcion: "Extracto de cuenta – billetaje electrónico", destino: "EGRESOS" },
  { codigo: 206, descripcion: "Extracto de cuenta de IPS", destino: "EGRESOS" },
  { codigo: 207, descripcion: "Extracto de cuenta TC/TD", destino: "EGRESOS" },
  { codigo: 208, descripcion: "Liquidación de salario", destino: "EGRESOS" },
  { codigo: 209, descripcion: "Otros comprobantes de egresos", destino: "EGRESOS" },
  { codigo: 211, descripcion: "Transferencias o giros bancarios / boleta de depósito", destino: "EGRESOS" },
];

export function buscarTipoComprobante(codigo: number): TipoComprobante | undefined {
  return TIPOS_COMPROBANTE.find((tipo) => tipo.codigo === codigo);
}

/** Destino de exportación; los electrónicos y virtuales nunca se exportan (sección 8.2). */
export function destinoExportacion(
  codigoTipo: number,
  naturaleza: NaturalezaFiscal,
): Destino | "NO_EXPORTABLE" {
  if (naturaleza !== "FISICO") return "NO_EXPORTABLE";
  return buscarTipoComprobante(codigoTipo)?.destino ?? "NO_EXPORTABLE";
}

/** Tipos de identificación usados en el archivo de importación. */
export const TIPO_IDENTIFICACION = {
  RUC: 11,
  CEDULA: 12,
  IDENTIFICACION_EXTERIOR: 17,
} as const;

/** Perfiles de usuario por contribuyente (sección 5). */
export const PERFILES = ["ADMINISTRADOR_TI", "AUXILIAR", "FINANCIERO", "CONSULTA"] as const;
export type Perfil = (typeof PERFILES)[number];

/** Obligaciones de registro de comprobantes (sección 18.3). */
export const OBLIGACIONES_REGISTRO = ["955", "956"] as const;
export type ObligacionRegistro = (typeof OBLIGACIONES_REGISTRO)[number];
