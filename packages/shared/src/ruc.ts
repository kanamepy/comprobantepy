/**
 * Validación del RUC paraguayo (sección 9.1).
 *
 * El dígito verificador se calcula con el algoritmo módulo 11 publicado por la DNIT:
 * los caracteres no numéricos se reemplazan por su código ASCII, se recorren los
 * dígitos de derecha a izquierda multiplicándolos por factores 2, 3, … hasta la base
 * máxima (11) y se reinicia en 2. Si el resto de dividir la suma entre 11 es mayor
 * que 1, el DV es 11 − resto; en otro caso es 0.
 */

const BASE_MAXIMA = 11;

export function calcularDV(numero: string, baseMaxima = BASE_MAXIMA): number {
  const limpio = numero.trim().toUpperCase();
  if (limpio.length === 0) {
    throw new Error("El número de RUC está vacío");
  }

  let digitos = "";
  for (const caracter of limpio) {
    digitos += /[0-9]/.test(caracter) ? caracter : String(caracter.charCodeAt(0));
  }

  let total = 0;
  let factor = 2;
  for (let i = digitos.length - 1; i >= 0; i--) {
    if (factor > baseMaxima) factor = 2;
    total += Number(digitos[i]) * factor;
    factor++;
  }

  const resto = total % 11;
  return resto > 1 ? 11 - resto : 0;
}

export interface RucSeparado {
  numero: string;
  dv: number | null;
}

/** Separa "80012345-6" en número y DV. Acepta también el número sin DV. */
export function separarRuc(valor: string): RucSeparado {
  const limpio = valor.replace(/[\s.]/g, "").toUpperCase();
  const partes = limpio.split("-");
  if (partes.length > 2 || !partes[0]) {
    throw new Error(`Formato de RUC no reconocido: ${valor}`);
  }
  const [numero, dv] = partes;
  if (dv === undefined || dv === "") return { numero, dv: null };
  if (!/^[0-9]$/.test(dv)) {
    throw new Error(`El dígito verificador debe ser un solo dígito: ${valor}`);
  }
  return { numero, dv: Number(dv) };
}

export interface ResultadoValidacionRuc {
  valido: boolean;
  numero: string;
  dv: number | null;
  dvEsperado: number;
  motivo?: string;
}

/** Valida un RUC con DV ("80012345-6"). Un RUC sin DV se informa como inválido. */
export function validarRuc(valor: string): ResultadoValidacionRuc {
  let separado: RucSeparado;
  try {
    separado = separarRuc(valor);
  } catch (error) {
    return { valido: false, numero: valor, dv: null, dvEsperado: -1, motivo: (error as Error).message };
  }
  const dvEsperado = calcularDV(separado.numero);
  if (separado.dv === null) {
    return { valido: false, ...separado, dvEsperado, motivo: "Falta el dígito verificador" };
  }
  if (separado.dv !== dvEsperado) {
    return {
      valido: false,
      ...separado,
      dvEsperado,
      motivo: `DV incorrecto: se esperaba ${dvEsperado}`,
    };
  }
  return { valido: true, ...separado, dvEsperado };
}

export function formatearRuc(numero: string): string {
  return `${numero}-${calcularDV(numero)}`;
}
