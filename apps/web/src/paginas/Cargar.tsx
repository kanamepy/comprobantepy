import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { api, apiFormulario } from "../api";
import { Insignia } from "../componentes/Insignia";
import { useSesion } from "../sesion";

interface Resultado {
  nombre: string;
  resultado: "CREADO" | "ASOCIADO" | "YA_REGISTRADO" | "ERROR";
  comprobanteId?: number;
  avisos?: string[];
  error?: string;
}

const TEXTO_RESULTADO = {
  CREADO: { texto: "Registrado", tono: "verde" },
  ASOCIADO: { texto: "Agregado a un comprobante existente", tono: "azul" },
  YA_REGISTRADO: { texto: "Ya estaba cargado", tono: "gris" },
  ERROR: { texto: "No se pudo cargar", tono: "rojo" },
} as const;

/** Carga individual o múltiple, captura desde cámara y carga manual (secciones 6 y 16). */
export function Cargar() {
  const { contribuyenteActivo, sesion } = useSesion();
  const navegar = useNavigate();
  const [naturaleza, setNaturaleza] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [resultados, setResultados] = useState<Resultado[]>([]);
  const [error, setError] = useState<string | null>(null);
  const entradaArchivos = useRef<HTMLInputElement>(null);
  const entradaCamara = useRef<HTMLInputElement>(null);
  const [arrastrando, setArrastrando] = useState(false);

  const nombreActivo =
    contribuyenteActivo === "TODOS" ? null : sesion?.contribuyentes.find((c) => c.id === contribuyenteActivo)?.nombre;

  async function enviar(archivos: FileList | File[], canal: "CARGA" | "CAMARA") {
    const lista = [...archivos];
    if (lista.length === 0) return;
    setEnviando(true);
    setError(null);
    const datos = new FormData();
    datos.set("canal", canal);
    if (contribuyenteActivo !== "TODOS") datos.set("contribuyenteId", String(contribuyenteActivo));
    if (naturaleza) datos.set("naturaleza", naturaleza);
    for (const archivo of lista) datos.append("archivos", archivo, archivo.name);
    try {
      const respuesta = await apiFormulario<{ resultados: Resultado[] }>("/comprobantes/carga", datos);
      setResultados((anteriores) => [...respuesta.resultados, ...anteriores]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron cargar los archivos");
    } finally {
      setEnviando(false);
      if (entradaArchivos.current) entradaArchivos.current.value = "";
      if (entradaCamara.current) entradaCamara.current.value = "";
    }
  }

  async function cargaManual() {
    try {
      const r = await api<{ comprobanteId: number }>("/comprobantes", {
        cuerpo: {
          contribuyenteId: contribuyenteActivo === "TODOS" ? null : contribuyenteActivo,
          naturaleza: naturaleza || undefined,
        },
      });
      navegar(`/comprobantes/${r.comprobanteId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear el comprobante");
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Cargar comprobantes</h1>
      <p className="text-slate-700">
        El sistema lee automáticamente los XML de facturas electrónicas y los PDF con texto. Las fotos y los PDF escaneados se
        guardan como evidencia y los datos se completan a mano (la lectura automática de imágenes llega en una etapa posterior).
        {nombreActivo ? (
          <> Si el documento no indica a quién está emitido, se asigna a <strong>{nombreActivo}</strong>.</>
        ) : (
          <> Si el documento no indica a quién está emitido, queda pendiente de asignar contribuyente.</>
        )}
      </p>

      <div>
        <label htmlFor="naturaleza-carga" className="etiqueta">
          ¿Qué tipo de comprobante es? (opcional)
        </label>
        <select id="naturaleza-carga" className="campo md:w-96" value={naturaleza} onChange={(e) => setNaturaleza(e.target.value)}>
          <option value="">No sé / que lo detecte el sistema</option>
          <option value="FISICO">Físico (papel con timbrado)</option>
          <option value="ELECTRONICO">Electrónico (factura electrónica SIFEN)</option>
          <option value="VIRTUAL">Virtual</option>
        </select>
        <p className="mt-1 text-sm text-slate-600">Si el archivo es un XML o tiene CDC, el sistema lo reconoce como electrónico igualmente.</p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <button type="button" className="boton-primario min-h-16 text-lg" onClick={() => entradaCamara.current?.click()} disabled={enviando}>
          📷 Sacar foto
        </button>
        <button type="button" className="boton-secundario min-h-16 text-lg" onClick={() => entradaArchivos.current?.click()} disabled={enviando}>
          📎 Elegir archivos
        </button>
        <button type="button" className="boton-secundario min-h-16 text-lg" onClick={() => void cargaManual()} disabled={enviando}>
          ✍ Cargar a mano
        </button>
      </div>
      <input
        ref={entradaCamara}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        aria-label="Tomar foto del comprobante"
        onChange={(e) => e.target.files && void enviar(e.target.files, "CAMARA")}
      />
      <input
        ref={entradaArchivos}
        type="file"
        multiple
        accept=".pdf,.xml,.jpg,.jpeg,.png,.tif,.tiff,.webp,.heic,application/pdf,text/xml,application/xml,image/*"
        className="sr-only"
        aria-label="Elegir archivos de comprobantes"
        onChange={(e) => e.target.files && void enviar(e.target.files, "CARGA")}
      />

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setArrastrando(true);
        }}
        onDragLeave={() => setArrastrando(false)}
        onDrop={(e) => {
          e.preventDefault();
          setArrastrando(false);
          void enviar(e.dataTransfer.files, "CARGA");
        }}
        className={`hidden rounded-xl border-2 border-dashed p-8 text-center md:block ${arrastrando ? "border-blue-600 bg-blue-50" : "border-slate-300"}`}
      >
        También podés arrastrar aquí los archivos (PDF, XML o imágenes).
      </div>

      {enviando && (
        <p role="status" className="font-medium">
          Procesando archivos…
        </p>
      )}
      {error && (
        <p role="alert" className="error-campo">
          ⚠ {error}
        </p>
      )}

      {resultados.length > 0 && (
        <section aria-labelledby="titulo-resultados" className="space-y-2">
          <h2 id="titulo-resultados" className="text-lg font-semibold">
            Resultado
          </h2>
          <ul className="space-y-2">
            {resultados.map((r, i) => (
              <li key={`${r.nombre}-${i}`} className="tarjeta flex flex-wrap items-start gap-2">
                <div className="mr-auto space-y-1">
                  <p className="font-medium break-all">{r.nombre}</p>
                  <Insignia tono={TEXTO_RESULTADO[r.resultado].tono}>{TEXTO_RESULTADO[r.resultado].texto}</Insignia>
                  {r.error && <p className="text-sm text-red-800">{r.error}</p>}
                  {r.avisos?.map((aviso) => (
                    <p key={aviso} className="text-sm text-slate-700">
                      ℹ {aviso}
                    </p>
                  ))}
                </div>
                {r.comprobanteId && (
                  <Link to={`/comprobantes/${r.comprobanteId}`} className="boton-secundario">
                    Revisar
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
