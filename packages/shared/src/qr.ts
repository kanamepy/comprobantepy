/**
 * Lectura del código QR de los documentos electrónicos SIFEN (KuDE). El QR es una URL de
 * consulta de e-Kuatia con parámetros: Id (CDC), dFeEmiDE (fecha en hexadecimal),
 * dRucRec o dNumIDRec (receptor), dTotGralOpe (total), dTotIVA, cItems, etc.
 */
import { parsearCdc, tipoComprobanteDesdeSifen } from "./cdc.js";
import { resultadoVacio, type CampoComprobante, type ResultadoExtraccion } from "./extraccion.js";

function hexATexto(valor: string): string | null {
  if (!/^([0-9a-f]{2})+$/i.test(valor)) return null;
  let texto = "";
  for (let i = 0; i < valor.length; i += 2) texto += String.fromCharCode(parseInt(valor.slice(i, i + 2), 16));
  return texto;
}

export function esQrSifen(contenido: string): boolean {
  return /ekuatia|sifen/i.test(contenido) && /[?&]Id=\d{44}/i.test(contenido);
}

export function extraerDeQr(contenido: string): ResultadoExtraccion {
  const resultado = resultadoVacio();
  const fijar = (campo: CampoComprobante, valor: string | null | undefined, confianza = 0.99) => {
    if (valor) resultado.campos[campo] = { valor, fuente: "QR", confianza };
  };
  let parametros: URLSearchParams;
  try {
    parametros = new URL(contenido.trim()).searchParams;
  } catch {
    // También se admite el contenido como cadena de parámetros sin dominio.
    parametros = new URLSearchParams(contenido.trim().replace(/^[^?]*\?/, ""));
  }
  const id = parametros.get("Id") ?? parametros.get("id");
  const datos = id ? parsearCdc(id) : null;
  if (!datos) {
    resultado.advertencias.push("El código QR no corresponde a un documento electrónico SIFEN");
    return resultado;
  }
  resultado.indicios.cdcValido = true;
  fijar("cdc", datos.cdc);
  fijar("emisorRuc", datos.rucEmisor);
  fijar("emisorDv", String(datos.dvEmisor));
  fijar("numero", datos.numero);
  const tipo = tipoComprobanteDesdeSifen(datos.tipoDocumentoElectronico);
  if (tipo) fijar("tipoComprobante", String(tipo));

  const fecha = hexATexto(parametros.get("dFeEmiDE") ?? "");
  fijar("fechaEmision", fecha && /^\d{4}-\d{2}-\d{2}/.test(fecha) ? fecha.slice(0, 10) : datos.fechaEmision);

  const rucReceptor = parametros.get("dRucRec");
  const documentoReceptor = parametros.get("dNumIDRec");
  if (rucReceptor && /^\d+$/.test(rucReceptor)) {
    fijar("receptorTipoIdentificacion", "RUC");
    fijar("receptorNumero", rucReceptor.replace(/^0+/, ""));
  } else if (documentoReceptor && documentoReceptor !== "0") {
    fijar("receptorTipoIdentificacion", "CI", 0.9);
    fijar("receptorNumero", documentoReceptor);
  }
  const total = parametros.get("dTotGralOpe");
  if (total && /^\d+(\.\d+)?$/.test(total)) fijar("total", String(Number(total)));
  return resultado;
}
