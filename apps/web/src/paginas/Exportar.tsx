import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { api, ErrorApi } from "../api";
import { Dialogo, DialogoMotivo } from "../componentes/Dialogo";
import { Insignia } from "../componentes/Insignia";
import { SelectorContribuyente } from "../componentes/SelectorContribuyente";
import { useContribuyenteElegido } from "../contribuyenteElegido";
import { fecha, fechaHora, importe, MESES, periodoTexto, tipoTexto } from "../formato";

interface Candidato {
  id: number;
  numero: string | null;
  fechaEmision: string | null;
  tipoComprobante: number | null;
  proveedor: string | null;
  total: string | null;
  elegibilidad: { estado: string; motivo: string };
}

interface Conciliacion {
  cantidadPorTipoRegistro: { compras: number; egresos: number };
  cantidadPorTipoComprobante: Record<string, number>;
  sumas: { comprasGravado10: number; comprasGravado5: number; comprasExento: number; comprasTotal: number; egresosTotal: number };
}

interface Preparacion {
  contribuyente: { id: number; nombre: string; ruc: string; obligacion: "955" | "956" };
  periodo: { anio: number; mes: number | null; desde: string; hasta: string };
  elegibles: Candidato[];
  noElegibles: Candidato[];
  yaExportados: Candidato[];
  conciliacion: Conciliacion;
}

interface ArchivoLote {
  id: number;
  nombreZip: string;
  filas: number;
  sha256Zip: string;
  tamano: number;
}

interface Lote {
  id: number;
  obligacion: string;
  anio: number;
  mes: number | null;
  formato: string;
  estado: "GENERADO" | "ENVIADO" | "CERRADO" | "ANULADO";
  conciliacion: Conciliacion;
  generadoEn: string;
  generadoPorNombre: string | null;
  enviadoEn: string | null;
  anuladoMotivo: string | null;
  archivos: ArchivoLote[];
}

const ESTADO_LOTE = {
  GENERADO: { texto: "Generado: falta importarlo en Marangatu", tono: "ambar" },
  ENVIADO: { texto: "Enviado: esperando resultado de la DNIT", tono: "azul" },
  CERRADO: { texto: "Cerrado", tono: "verde" },
  ANULADO: { texto: "Anulado", tono: "gris" },
} as const;

/** Exportación a Marangatu: conciliación previa, generación de lotes y resultado de la DNIT (sección 18). */
export function Exportar() {
  const { contribuyente, lista, elegir } = useContribuyenteElegido();
  const hoy = new Date();
  const mesAnterior = hoy.getMonth() === 0 ? 12 : hoy.getMonth();
  const [anio, setAnio] = useState(hoy.getMonth() === 0 ? hoy.getFullYear() - 1 : hoy.getFullYear());
  const [mes, setMes] = useState(mesAnterior);
  const [preparacion, setPreparacion] = useState<Preparacion | null>(null);
  const [seleccion, setSeleccion] = useState<Set<number>>(new Set());
  const [formato, setFormato] = useState<"TXT" | "CSV">("TXT");
  const [delimitador, setDelimitador] = useState<";" | ",">(";");
  const [lotes, setLotes] = useState<Lote[]>([]);
  const [error, setError] = useState<{ texto: string; detalles?: { id: string; mensaje: string }[] } | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [generando, setGenerando] = useState(false);

  const obligacion = contribuyente?.obligacionRegistro ?? null;

  const cargar = useCallback(async () => {
    if (!contribuyente || !obligacion) return;
    setError(null);
    try {
      const parametros = new URLSearchParams({ contribuyenteId: String(contribuyente.id), anio: String(anio) });
      if (obligacion === "955") parametros.set("mes", String(mes));
      const [p, l] = await Promise.all([api<Preparacion>(`/lotes/preparar?${parametros}`), api<Lote[]>(`/lotes?contribuyenteId=${contribuyente.id}`)]);
      setPreparacion(p);
      setSeleccion(new Set(p.elegibles.map((e) => e.id)));
      setLotes(l);
    } catch (err) {
      setError({ texto: err instanceof Error ? err.message : "No se pudo preparar el lote" });
    }
  }, [contribuyente, obligacion, anio, mes]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const seleccionados = useMemo(() => preparacion?.elegibles.filter((e) => seleccion.has(e.id)) ?? [], [preparacion, seleccion]);
  const totalSeleccionado = seleccionados.reduce((s, e) => s + Number(e.total ?? 0), 0);

  async function generar() {
    if (!contribuyente) return;
    setGenerando(true);
    setError(null);
    try {
      const lote = await api<Lote>("/lotes", {
        cuerpo: {
          contribuyenteId: contribuyente.id,
          anio,
          mes: obligacion === "955" ? mes : null,
          ids: [...seleccion],
          formato,
          delimitadorCsv: formato === "CSV" ? delimitador : undefined,
        },
      });
      setMensaje(`Lote generado para ${periodoTexto(lote.anio, lote.mes)}. Descargá el archivo e importalo en Marangatu.`);
      await cargar();
    } catch (err) {
      setError({
        texto: err instanceof Error ? err.message : "No se pudo generar",
        detalles: err instanceof ErrorApi && Array.isArray(err.detalles) ? (err.detalles as unknown as { id: string; mensaje: string }[]) : undefined,
      });
    } finally {
      setGenerando(false);
    }
  }

  const anios = [hoy.getFullYear() - 2, hoy.getFullYear() - 1, hoy.getFullYear()];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Exportar a Marangatu</h1>
      <p className="text-slate-700">
        Se exportan solo los comprobantes <strong>físicos aprobados</strong>. Los electrónicos y virtuales no se exportan porque
        Marangatu ya los tiene. Cada lote es de un solo contribuyente y el archivo generado no se modifica: para corregir se anula
        (si todavía no se importó) o se genera un lote nuevo.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <SelectorContribuyente contribuyente={contribuyente} lista={lista} alElegir={elegir} />
        {obligacion && (
          <>
            {obligacion === "955" && (
              <div>
                <label className="etiqueta" htmlFor="mes">
                  Mes
                </label>
                <select id="mes" className="campo" value={mes} onChange={(e) => setMes(Number(e.target.value))}>
                  {MESES.map((m, i) => (
                    <option key={m} value={i + 1}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="etiqueta" htmlFor="anio">
                Año
              </label>
              <select id="anio" className="campo" value={anio} onChange={(e) => setAnio(Number(e.target.value))}>
                {anios.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
            <p className="pb-3 text-sm text-slate-700">Registro {obligacion === "955" ? "mensual (955)" : "anual (956)"}</p>
          </>
        )}
      </div>

      {contribuyente && !obligacion && (
        <p className="tarjeta text-amber-900">
          ⚠ Falta indicar si {contribuyente.nombre} registra comprobantes en forma mensual (955) o anual (956). Configuralo en{" "}
          <Link to="/contribuyentes" className="underline">
            Contribuyentes
          </Link>
          .
        </p>
      )}
      {mensaje && (
        <p role="status" className="font-medium text-green-800">
          ✔ {mensaje}
        </p>
      )}
      {error && (
        <div role="alert" className="tarjeta border-red-300 bg-red-50">
          <p className="font-medium text-red-900">⚠ {error.texto}</p>
          {error.detalles && (
            <ul className="mt-2 list-disc pl-5 text-sm">
              {error.detalles.map((d, i) => (
                <li key={i}>
                  <Link to={`/comprobantes/${d.id}`} className="underline">
                    Comprobante {d.id}
                  </Link>
                  : {d.mensaje}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {preparacion && (
        <section className="space-y-4" aria-labelledby="titulo-preparacion">
          <h2 id="titulo-preparacion" className="text-lg font-semibold">
            Nuevo lote – {periodoTexto(preparacion.periodo.anio, preparacion.periodo.mes)}
          </h2>

          {preparacion.elegibles.length === 0 ? (
            <p className="text-slate-700">No hay comprobantes listos para exportar en este período.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-100">
                  <tr>
                    <th className="p-2">
                      <input
                        type="checkbox"
                        className="size-5"
                        aria-label="Seleccionar todos"
                        checked={seleccion.size === preparacion.elegibles.length}
                        onChange={(e) => setSeleccion(e.target.checked ? new Set(preparacion.elegibles.map((x) => x.id)) : new Set())}
                      />
                    </th>
                    <th className="p-2">Fecha</th>
                    <th className="p-2">Proveedor</th>
                    <th className="p-2">Comprobante</th>
                    <th className="p-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {preparacion.elegibles.map((e) => (
                    <tr key={e.id} className="border-t border-slate-200">
                      <td className="p-2">
                        <input
                          type="checkbox"
                          className="size-5"
                          aria-label={`Incluir ${e.numero ?? e.id}`}
                          checked={seleccion.has(e.id)}
                          onChange={() =>
                            setSeleccion((s) => {
                              const n = new Set(s);
                              if (n.has(e.id)) n.delete(e.id);
                              else n.add(e.id);
                              return n;
                            })
                          }
                        />
                      </td>
                      <td className="p-2">{fecha(e.fechaEmision)}</td>
                      <td className="p-2">{e.proveedor}</td>
                      <td className="p-2">
                        <Link to={`/comprobantes/${e.id}`} className="text-blue-800 underline">
                          {tipoTexto(e.tipoComprobante)} {e.numero}
                        </Link>
                        {e.elegibilidad.motivo.includes("reenviar") && <span className="ml-1 text-amber-900">(reenvío)</span>}
                      </td>
                      <td className="p-2 text-right">{importe(e.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {preparacion.noElegibles.length > 0 && (
            <details className="tarjeta">
              <summary className="min-h-11 cursor-pointer font-medium">
                {preparacion.noElegibles.length === 1
                  ? "1 comprobante físico del período que todavía no se puede exportar"
                  : `${preparacion.noElegibles.length} comprobantes físicos del período que todavía no se pueden exportar`}
              </summary>
              <ul className="mt-2 space-y-1 text-sm">
                {preparacion.noElegibles.map((e) => (
                  <li key={e.id}>
                    <Link to={`/comprobantes/${e.id}`} className="text-blue-800 underline">
                      {e.proveedor ?? "Comprobante"} {e.numero ?? `#${e.id}`}
                    </Link>
                    : {e.elegibilidad.motivo}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {preparacion.yaExportados.length > 0 && (
            <p className="text-sm text-slate-700">
              ✔ {preparacion.yaExportados.length === 1 ? "1 comprobante del período ya está" : `${preparacion.yaExportados.length} comprobantes del período ya están`} en un
              lote (generado, enviado o aceptado).
            </p>
          )}

          {preparacion.elegibles.length > 0 && (
            <section className="tarjeta space-y-3" aria-labelledby="titulo-conciliacion">
              <h3 id="titulo-conciliacion" className="font-semibold">
                Conciliación previa
              </h3>
              <dl className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <Dato titulo="Seleccionados" valor={`${seleccion.size} de ${preparacion.elegibles.length}`} />
                <Dato titulo="Total seleccionado" valor={importe(String(totalSeleccionado))} />
                <Dato titulo="Compras / Egresos (elegibles)" valor={`${preparacion.conciliacion.cantidadPorTipoRegistro.compras} / ${preparacion.conciliacion.cantidadPorTipoRegistro.egresos}`} />
                <Dato titulo="Compras: gravado 10 %" valor={importe(String(preparacion.conciliacion.sumas.comprasGravado10))} />
                <Dato titulo="Compras: gravado 5 %" valor={importe(String(preparacion.conciliacion.sumas.comprasGravado5))} />
                <Dato titulo="Compras: exento" valor={importe(String(preparacion.conciliacion.sumas.comprasExento))} />
                <Dato titulo="Compras: total" valor={importe(String(preparacion.conciliacion.sumas.comprasTotal))} />
                <Dato titulo="Egresos: total" valor={importe(String(preparacion.conciliacion.sumas.egresosTotal))} />
                <Dato
                  titulo="Por tipo de comprobante"
                  valor={Object.entries(preparacion.conciliacion.cantidadPorTipoComprobante)
                    .map(([tipo, n]) => `${tipo}: ${n}`)
                    .join(" · ")}
                />
              </dl>
              <p className="text-sm text-slate-700">
                Archivo: <code>{preparacion.contribuyente.ruc}_REG_{obligacion === "955" ? `${String(mes).padStart(2, "0")}${anio}` : anio}_V…</code>
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="etiqueta" htmlFor="formato">
                    Formato
                  </label>
                  <select id="formato" className="campo" value={formato} onChange={(e) => setFormato(e.target.value as "TXT" | "CSV")}>
                    <option value="TXT">TXT con tabulaciones (recomendado)</option>
                    <option value="CSV">CSV</option>
                  </select>
                </div>
                {formato === "CSV" && (
                  <div>
                    <label className="etiqueta" htmlFor="delimitador">
                      Separador
                    </label>
                    <select id="delimitador" className="campo" value={delimitador} onChange={(e) => setDelimitador(e.target.value as ";" | ",")}>
                      <option value=";">Punto y coma (;)</option>
                      <option value=",">Coma (,)</option>
                    </select>
                  </div>
                )}
                <button type="button" className="boton-primario" disabled={seleccion.size === 0 || generando} onClick={() => void generar()}>
                  {generando ? "Generando…" : `Generar archivo con ${seleccion.size} comprobantes`}
                </button>
              </div>
            </section>
          )}
        </section>
      )}

      {lotes.length > 0 && <ListaLotes lotes={lotes} alCambiar={cargar} />}
    </div>
  );
}

function Dato({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div className="rounded-lg bg-slate-50 p-2">
      <dt className="text-slate-600">{titulo}</dt>
      <dd className="font-semibold">{valor || "—"}</dd>
    </div>
  );
}

function ListaLotes({ lotes, alCambiar }: { lotes: Lote[]; alCambiar: () => Promise<void> }) {
  const [anulando, setAnulando] = useState<Lote | null>(null);
  const [enviando, setEnviando] = useState<Lote | null>(null);
  const [resultado, setResultado] = useState<Lote | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function ejecutar(accion: () => Promise<unknown>) {
    setError(null);
    try {
      await accion();
      await alCambiar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo completar la acción");
    }
  }

  return (
    <section className="space-y-3" aria-labelledby="titulo-lotes">
      <h2 id="titulo-lotes" className="text-lg font-semibold">
        Lotes generados
      </h2>
      {error && <p role="alert" className="error-campo">⚠ {error}</p>}
      <ul className="space-y-3">
        {lotes.map((l) => (
          <li key={l.id} className={`tarjeta space-y-2 ${l.estado === "ANULADO" ? "opacity-70" : ""}`}>
            <div className="flex flex-wrap items-start gap-2">
              <h3 className="mr-auto font-semibold">
                Lote {l.id} · {periodoTexto(l.anio, l.mes)}
              </h3>
              <Insignia tono={ESTADO_LOTE[l.estado].tono}>{ESTADO_LOTE[l.estado].texto}</Insignia>
            </div>
            <p className="text-sm text-slate-700">
              Generado el {fechaHora(l.generadoEn)} por {l.generadoPorNombre ?? "—"} · {l.conciliacion.cantidadPorTipoRegistro.compras} compras,{" "}
              {l.conciliacion.cantidadPorTipoRegistro.egresos} egresos · total {importe(String(l.conciliacion.sumas.comprasTotal + l.conciliacion.sumas.egresosTotal))}
              {l.enviadoEn && ` · importado el ${fecha(l.enviadoEn)}`}
              {l.anuladoMotivo && ` · anulado: ${l.anuladoMotivo}`}
            </p>
            <ul className="space-y-1 text-sm">
              {l.archivos.map((a) => (
                <li key={a.id}>
                  ⬇{" "}
                  <a href={`/api/lotes/${l.id}/archivos/${a.id}`} className="font-medium text-blue-800 underline">
                    {a.nombreZip}
                  </a>{" "}
                  <span className="text-slate-600">
                    ({a.filas} filas · SHA-256 {a.sha256Zip.slice(0, 12)}…)
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              {l.estado === "GENERADO" && (
                <>
                  <button type="button" className="boton-primario" onClick={() => setEnviando(l)}>
                    Ya lo importé en Marangatu
                  </button>
                  <button type="button" className="boton-secundario" onClick={() => setAnulando(l)}>
                    Anular lote
                  </button>
                </>
              )}
              {l.estado === "ENVIADO" && (
                <button type="button" className="boton-primario" onClick={() => setResultado(l)}>
                  Registrar resultado de la DNIT
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      <DialogoMotivo
        abierto={anulando !== null}
        titulo={`Anular lote ${anulando?.id ?? ""}`}
        textoBoton="Anular lote"
        alCerrar={() => setAnulando(null)}
        alConfirmar={(motivo) => {
          const l = anulando!;
          setAnulando(null);
          void ejecutar(() => api(`/lotes/${l.id}/anular`, { cuerpo: { motivo } }));
        }}
      />
      {enviando && (
        <DialogoEnviado
          lote={enviando}
          alCerrar={() => setEnviando(null)}
          alConfirmar={(f) => {
            const l = enviando;
            setEnviando(null);
            void ejecutar(() => api(`/lotes/${l.id}/enviado`, { cuerpo: { fecha: f } }));
          }}
        />
      )}
      {resultado && (
        <DialogoResultado
          lote={resultado}
          alCerrar={() => setResultado(null)}
          alTerminar={async () => {
            setResultado(null);
            await alCambiar();
          }}
        />
      )}
    </section>
  );
}

function DialogoEnviado({ lote, alCerrar, alConfirmar }: { lote: Lote; alCerrar: () => void; alConfirmar: (fecha: string) => void }) {
  const [valor, setValor] = useState(new Date().toISOString().slice(0, 10));
  return (
    <Dialogo abierto titulo={`Lote ${lote.id} importado en Marangatu`} alCerrar={alCerrar}>
      <p>Indicá la fecha en que importaste el archivo. Después, cuando la DNIT informe el resultado en el Buzón Marandu, registralo aquí.</p>
      <label className="etiqueta" htmlFor="fecha-envio">
        Fecha de importación
      </label>
      <input id="fecha-envio" type="date" className="campo" value={valor} onChange={(e) => setValor(e.target.value)} />
      <div className="flex gap-2">
        <button type="button" className="boton-primario" onClick={() => alConfirmar(valor)}>
          Guardar
        </button>
        <button type="button" className="boton-secundario" onClick={alCerrar}>
          Cancelar
        </button>
      </div>
    </Dialogo>
  );
}

interface FilaLote {
  comprobanteId: number;
  numero: string | null;
  proveedor: string | null;
  total: string | null;
  estado: string;
  fila: number;
}

/** Resultado informado por la DNIT (sección 18.7). */
function DialogoResultado({ lote, alCerrar, alTerminar }: { lote: Lote; alCerrar: () => void; alTerminar: () => Promise<void> }) {
  const [filas, setFilas] = useState<FilaLote[]>([]);
  const [errores, setErrores] = useState<Record<number, string>>({});
  const [cerrar, setCerrar] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ comprobantes: FilaLote[] }>(`/lotes/${lote.id}`).then((d) => setFilas(d.comprobantes.filter((c) => c.estado === "ENVIADO")), () => undefined);
  }, [lote.id]);

  const rechazados = Object.entries(errores).filter(([, e]) => e !== undefined);

  return (
    <Dialogo abierto titulo={`Resultado de la DNIT – lote ${lote.id}`} alCerrar={alCerrar}>
      <p className="text-sm">
        Marcá los comprobantes con error y copiá el mensaje de la DNIT. Volverán a “Observado” para corregirlos y reenviarlos en un lote nuevo.
      </p>
      <ul className="max-h-80 space-y-2 overflow-y-auto">
        {filas.map((f) => {
          const marcado = errores[f.comprobanteId] !== undefined;
          return (
            <li key={f.comprobanteId} className="rounded-lg border border-slate-200 p-2 text-sm">
              <label className="flex min-h-11 items-center gap-2">
                <input
                  type="checkbox"
                  className="size-5"
                  checked={marcado}
                  onChange={(e) =>
                    setErrores((anterior) => {
                      const nuevo = { ...anterior };
                      if (e.target.checked) nuevo[f.comprobanteId] = "";
                      else delete nuevo[f.comprobanteId];
                      return nuevo;
                    })
                  }
                />
                Fila {f.fila}: {f.proveedor} {f.numero} ({importe(f.total)})
              </label>
              {marcado && (
                <input
                  className="campo"
                  aria-label="Error informado por la DNIT"
                  placeholder="Error informado por la DNIT"
                  value={errores[f.comprobanteId]}
                  onChange={(e) => setErrores({ ...errores, [f.comprobanteId]: e.target.value })}
                />
              )}
            </li>
          );
        })}
      </ul>
      <label className="flex min-h-11 items-center gap-2">
        <input type="checkbox" className="size-5" checked={cerrar} onChange={(e) => setCerrar(e.target.checked)} />
        Cerrar el lote: los demás comprobantes quedaron aceptados
      </label>
      {error && <p role="alert" className="error-campo">⚠ {error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          className="boton-primario"
          onClick={async () => {
            try {
              await api(`/lotes/${lote.id}/resultado`, {
                cuerpo: { rechazados: rechazados.map(([id, e]) => ({ comprobanteId: Number(id), error: e })), cerrar },
              });
              await alTerminar();
            } catch (err) {
              setError(err instanceof ErrorApi ? err.message : "No se pudo guardar");
            }
          }}
        >
          Guardar resultado
        </button>
        <button type="button" className="boton-secundario" onClick={alCerrar}>
          Cancelar
        </button>
      </div>
    </Dialogo>
  );
}
