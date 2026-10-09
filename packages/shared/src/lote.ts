/**
 * Armado de lotes de exportación: nombre del archivo, división en archivos de hasta
 * 5.000 filas, compresión ZIP y conciliación previa (secciones 18.2, 18.3 y 18.6).
 */

import JSZip from "jszip";
import { createHash } from "node:crypto";
import type { ObligacionRegistro } from "./catalogos.js";
import {
  camposRegistro,
  validarRegistro,
  type ErrorValidacion,
  type RegistroExportable,
} from "./marangatu.js";

export const MAXIMO_FILAS_POR_ARCHIVO = 5000;

export type FormatoArchivo = "TXT" | "CSV";

export interface PeriodoLote {
  anio: number;
  /** Requerido para la obligación 955 (registro mensual). */
  mes?: number;
}

export interface OpcionesLote {
  /** RUC del informante, sin DV. */
  rucInformante: string;
  obligacion: ObligacionRegistro;
  periodo: PeriodoLote;
  /**
   * Identificadores `XXXXX` ya usados por este informante en el período. El generador
   * nunca los reutiliza (sección 18.3).
   */
  identificadoresUsados: ReadonlySet<string>;
  /** Prefijo del identificador; por defecto "V". */
  prefijo?: string;
  formato?: FormatoArchivo;
  /** Delimitador del CSV; queda a confirmar con una importación de prueba (decisión D-10). */
  delimitadorCsv?: "," | ";";
  /** Fin de línea. [A CONFIRMAR] con una importación de prueba. */
  finDeLinea?: "\n" | "\r\n";
  maximoFilasPorArchivo?: number;
}

export interface ArchivoGenerado {
  nombreBase: string;
  identificador: string;
  /** Nombre del archivo de texto dentro del ZIP. */
  nombreArchivo: string;
  nombreZip: string;
  contenido: string;
  zip: Uint8Array;
  sha256Zip: string;
  idsRegistros: string[];
}

export interface ResumenConciliacion {
  cantidadPorTipoRegistro: { compras: number; egresos: number };
  cantidadPorTipoComprobante: Record<number, number>;
  sumas: {
    comprasGravado10: number;
    comprasGravado5: number;
    comprasExento: number;
    comprasTotal: number;
    egresosTotal: number;
  };
}

export type ResultadoLote =
  | { ok: true; archivos: ArchivoGenerado[]; conciliacion: ResumenConciliacion }
  | { ok: false; errores: ErrorValidacion[]; conciliacion: ResumenConciliacion };

export function nombreBaseArchivo(
  rucInformante: string,
  obligacion: ObligacionRegistro,
  periodo: PeriodoLote,
  identificador: string,
): string {
  if (!/^[0-9A-Za-z]+$/.test(rucInformante) || rucInformante.includes("-")) {
    throw new Error("El RUC del informante se informa sin DV");
  }
  if (!/^[0-9A-Za-z]{1,5}$/.test(identificador)) {
    throw new Error("El identificador debe ser alfanumérico de hasta 5 posiciones");
  }
  if (obligacion === "955") {
    const mes = periodo.mes;
    if (!mes || mes < 1 || mes > 12) throw new Error("El registro mensual (955) requiere el mes");
    return `${rucInformante}_REG_${String(mes).padStart(2, "0")}${periodo.anio}_${identificador}`;
  }
  return `${rucInformante}_REG_${periodo.anio}_${identificador}`;
}

/** Siguiente identificador libre con el formato prefijo + correlativo (por ejemplo V0001). */
export function siguienteIdentificador(prefijo: string, usados: ReadonlySet<string>): string {
  const digitos = 5 - prefijo.length;
  if (digitos < 1) throw new Error("El prefijo deja sin lugar para el correlativo");
  const maximo = 10 ** digitos - 1;
  for (let n = 1; n <= maximo; n++) {
    const candidato = `${prefijo}${String(n).padStart(digitos, "0")}`;
    if (!usados.has(candidato)) return candidato;
  }
  throw new Error(`Se agotaron los identificadores con el prefijo ${prefijo}`);
}

export function conciliar(registros: readonly RegistroExportable[]): ResumenConciliacion {
  const resumen: ResumenConciliacion = {
    cantidadPorTipoRegistro: { compras: 0, egresos: 0 },
    cantidadPorTipoComprobante: {},
    sumas: { comprasGravado10: 0, comprasGravado5: 0, comprasExento: 0, comprasTotal: 0, egresosTotal: 0 },
  };
  for (const r of registros) {
    resumen.cantidadPorTipoComprobante[r.tipoComprobante] =
      (resumen.cantidadPorTipoComprobante[r.tipoComprobante] ?? 0) + 1;
    if (r.tipoRegistro === "COMPRA") {
      resumen.cantidadPorTipoRegistro.compras++;
      resumen.sumas.comprasGravado10 += r.gravado10;
      resumen.sumas.comprasGravado5 += r.gravado5;
      resumen.sumas.comprasExento += r.exento;
      resumen.sumas.comprasTotal += r.total;
    } else {
      resumen.cantidadPorTipoRegistro.egresos++;
      resumen.sumas.egresosTotal += r.total;
    }
  }
  return resumen;
}

function lineaArchivo(registro: RegistroExportable, delimitador: string): string {
  return camposRegistro(registro)
    .map((campo) => campo.split(delimitador).join(" "))
    .join(delimitador);
}

/**
 * Valida todos los registros y, si no hay errores, genera los archivos del lote.
 * Si algún registro tiene errores no se genera nada (sección 24.5, criterio 23).
 */
export async function generarLote(
  registros: readonly RegistroExportable[],
  opciones: OpcionesLote,
): Promise<ResultadoLote> {
  const conciliacion = conciliar(registros);
  const errores = registros.flatMap(validarRegistro);
  if (registros.length === 0) {
    errores.push({ id: "-", campo: "lote", mensaje: "El lote no tiene comprobantes" });
  }
  if (errores.length > 0) return { ok: false, errores, conciliacion };

  const formato = opciones.formato ?? "TXT";
  const delimitador = formato === "TXT" ? "\t" : (opciones.delimitadorCsv ?? ";");
  const finDeLinea = opciones.finDeLinea ?? "\n";
  const maximo = opciones.maximoFilasPorArchivo ?? MAXIMO_FILAS_POR_ARCHIVO;
  const prefijo = opciones.prefijo ?? "V";
  const usados = new Set(opciones.identificadoresUsados);
  const extension = formato === "TXT" ? "txt" : "csv";

  const archivos: ArchivoGenerado[] = [];
  for (let inicio = 0; inicio < registros.length; inicio += maximo) {
    const parte = registros.slice(inicio, inicio + maximo);
    const identificador = siguienteIdentificador(prefijo, usados);
    usados.add(identificador);
    const nombreBase = nombreBaseArchivo(opciones.rucInformante, opciones.obligacion, opciones.periodo, identificador);
    const contenido = parte.map((r) => lineaArchivo(r, delimitador)).join(finDeLinea) + finDeLinea;
    const nombreArchivo = `${nombreBase}.${extension}`;

    const zip = new JSZip();
    // Fecha fija para que el mismo contenido produzca siempre el mismo ZIP y la misma huella.
    zip.file(nombreArchivo, contenido, { date: new Date(Date.UTC(2021, 0, 1)) });
    const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });

    archivos.push({
      nombreBase,
      identificador,
      nombreArchivo,
      nombreZip: `${nombreBase}.zip`,
      contenido,
      zip: bytes,
      sha256Zip: createHash("sha256").update(bytes).digest("hex"),
      idsRegistros: parte.map((r) => r.id),
    });
  }

  return { ok: true, archivos, conciliacion };
}
