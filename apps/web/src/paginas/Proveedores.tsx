import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { api, apiFormulario, ErrorApi, type Proveedor, type Timbrado } from "../api";
import { Campo } from "../componentes/Campo";
import { Dialogo, DialogoMotivo } from "../componentes/Dialogo";
import { Insignia } from "../componentes/Insignia";
import { fecha, fechaHora } from "../formato";
import { useSesion } from "../sesion";

const ESTADOS = {
  PENDIENTE_DE_CONFIRMAR: { texto: "A confirmar", tono: "ambar" },
  CONFIRMADO: { texto: "Confirmado", tono: "verde" },
  OBSERVADO: { texto: "Observado", tono: "rojo" },
  RECHAZADO: { texto: "Rechazado", tono: "rojo" },
} as const;

/** Bandeja de proveedores a confirmar y maestro de proveedores y timbrados (sección 11). */
export function Proveedores() {
  const [parametros, setParametros] = useSearchParams();
  const [filtro, setFiltro] = useState<string>("PENDIENTE_DE_CONFIRMAR");
  const [lista, setLista] = useState<(Proveedor & { comprobantes: number })[]>([]);
  const [error, setError] = useState<string | null>(null);
  const seleccionado = parametros.get("id") ? Number(parametros.get("id")) : null;
  const { contribuyenteActivo, sesion } = useSesion();
  const nombreActivo = contribuyenteActivo === "TODOS" ? null : sesion?.contribuyentes.find((c) => c.id === contribuyenteActivo)?.nombre;

  const cargar = useCallback(async () => {
    try {
      const consulta = new URLSearchParams();
      if (filtro) consulta.set("estado", filtro);
      if (contribuyenteActivo !== "TODOS") consulta.set("contribuyenteId", String(contribuyenteActivo));
      setLista(await api(`/proveedores?${consulta}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar");
    }
  }, [filtro, contribuyenteActivo]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Proveedores</h1>
      <p className="text-slate-700">
        {nombreActivo
          ? `Proveedores con comprobantes de ${nombreActivo}. El maestro de proveedores es compartido: confirmar uno sirve para todos los contribuyentes.`
          : "Todos los proveedores. Elegí un contribuyente arriba para ver solo los suyos."}
      </p>
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filtrar proveedores">
        {[
          ["PENDIENTE_DE_CONFIRMAR", "A confirmar"],
          ["CONFIRMADO", "Confirmados"],
          ["OBSERVADO", "Observados"],
          ["", "Todos"],
        ].map(([valor, texto]) => (
          <button
            key={valor}
            type="button"
            role="tab"
            aria-selected={filtro === valor}
            className={`boton ${filtro === valor ? "bg-blue-700 text-white" : "border border-slate-300 bg-white"}`}
            onClick={() => setFiltro(valor!)}
          >
            {texto}
          </button>
        ))}
      </div>
      {error && <p role="alert" className="error-campo">⚠ {error}</p>}
      {lista.length === 0 && <p className="text-slate-700">No hay proveedores en esta lista.</p>}
      <ul className="grid gap-3 md:grid-cols-2">
        {lista.map((p) => (
          <li key={p.id} className="tarjeta space-y-1">
            <div className="flex flex-wrap items-start gap-2">
              <h2 className="mr-auto font-semibold">{p.razonSocial}</h2>
              <Insignia tono={ESTADOS[p.estado].tono}>{ESTADOS[p.estado].texto}</Insignia>
            </div>
            <p className="text-sm">
              {p.tipoIdentificacion === 11 ? "RUC" : `Identificación (${p.tipoIdentificacion})`} {p.numeroIdentificacion}
              {p.dv !== null && `-${p.dv}`} · {p.comprobantes} comprobantes
              {p.emisorElectronico && " · emite electrónicos"}
              {p.emisorVirtual && " · emite virtuales"}
            </p>
            <button type="button" className="boton-secundario" onClick={() => setParametros({ id: String(p.id) })}>
              Revisar
            </button>
          </li>
        ))}
      </ul>
      {seleccionado && (
        <FichaProveedor
          id={seleccionado}
          alCerrar={() => {
            setParametros({});
            void cargar();
          }}
        />
      )}
    </div>
  );
}

function FichaProveedor({ id, alCerrar }: { id: number; alCerrar: () => void }) {
  const [datos, setDatos] = useState<{ proveedor: Proveedor; timbrados: Timbrado[]; coincidencias: Proveedor[] } | null>(null);
  const [edicion, setEdicion] = useState({ razonSocial: "", nombreFantasia: "", emisorElectronico: false, emisorVirtual: false });
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [pedirMotivo, setPedirMotivo] = useState<null | "OBSERVADO" | "RECHAZADO">(null);
  const [verificando, setVerificando] = useState<Timbrado | null>(null);

  const cargar = useCallback(async () => {
    const r = await api<{ proveedor: Proveedor; timbrados: Timbrado[]; coincidencias: Proveedor[] }>(`/proveedores/${id}`);
    setDatos(r);
    setEdicion({
      razonSocial: r.proveedor.razonSocial,
      nombreFantasia: r.proveedor.nombreFantasia ?? "",
      emisorElectronico: r.proveedor.emisorElectronico,
      emisorVirtual: r.proveedor.emisorVirtual,
    });
  }, [id]);

  useEffect(() => {
    void cargar().catch((err: Error) => setMensaje(err.message));
  }, [cargar]);

  async function guardarYCambiarEstado(estado?: string, motivo?: string) {
    try {
      await api(`/proveedores/${id}`, { metodo: "PATCH", cuerpo: { ...edicion, nombreFantasia: edicion.nombreFantasia || null } });
      if (estado) {
        const r = await api<{ comprobantesRecalculados: number }>(`/proveedores/${id}/estado`, { cuerpo: { estado, motivo } });
        setMensaje(`Listo. Se actualizaron ${r.comprobantesRecalculados} comprobantes.`);
      } else {
        setMensaje("Datos guardados");
      }
      await cargar();
    } catch (err) {
      setMensaje(err instanceof Error ? err.message : "No se pudo guardar");
    }
  }

  return (
    <Dialogo abierto titulo={datos?.proveedor.razonSocial ?? "Proveedor"} alCerrar={alCerrar}>
      {!datos ? (
        <p role="status">{mensaje ?? "Cargando…"}</p>
      ) : (
        <div className="max-h-[70vh] space-y-4 overflow-y-auto">
          <p>
            RUC {datos.proveedor.numeroIdentificacion}
            {datos.proveedor.dv !== null && `-${datos.proveedor.dv}`} · origen: {datos.proveedor.fuente.toLowerCase()} ·{" "}
            <Link to={`/comprobantes?proveedor=${id}`} className="text-blue-800 underline" onClick={alCerrar}>
              ver comprobantes
            </Link>
          </p>
          {datos.coincidencias.length > 0 && (
            <p className="text-sm text-amber-900">
              ⚠ Hay otros proveedores con el mismo nombre: {datos.coincidencias.map((c) => `${c.razonSocial} (${c.numeroIdentificacion})`).join(", ")}
            </p>
          )}
          <Campo etiqueta="Razón social" value={edicion.razonSocial} onChange={(e) => setEdicion({ ...edicion, razonSocial: e.target.value })} />
          <Campo etiqueta="Nombre de fantasía" value={edicion.nombreFantasia} onChange={(e) => setEdicion({ ...edicion, nombreFantasia: e.target.value })} />
          <label className="flex min-h-11 items-center gap-2">
            <input type="checkbox" className="size-5" checked={edicion.emisorElectronico} onChange={(e) => setEdicion({ ...edicion, emisorElectronico: e.target.checked })} />
            Emite comprobantes electrónicos
          </label>
          <label className="flex min-h-11 items-center gap-2">
            <input type="checkbox" className="size-5" checked={edicion.emisorVirtual} onChange={(e) => setEdicion({ ...edicion, emisorVirtual: e.target.checked })} />
            Emite comprobantes virtuales
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="boton-primario" onClick={() => void guardarYCambiarEstado("CONFIRMADO")}>
              Guardar y confirmar
            </button>
            <button type="button" className="boton-secundario" onClick={() => void guardarYCambiarEstado()}>
              Solo guardar
            </button>
            <button type="button" className="boton-secundario" onClick={() => setPedirMotivo("OBSERVADO")}>
              Observar
            </button>
            <button type="button" className="boton-peligro" onClick={() => setPedirMotivo("RECHAZADO")}>
              Rechazar
            </button>
          </div>
          {mensaje && <p role="status" className="font-medium">{mensaje}</p>}

          <section className="space-y-2">
            <h3 className="font-semibold">Timbrados</h3>
            {datos.timbrados.length === 0 && <p className="text-sm text-slate-700">Sin timbrados registrados.</p>}
            <ul className="space-y-2">
              {datos.timbrados.map((t) => (
                <li key={t.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="mr-auto">N.° {t.numero}</strong>
                    <Insignia tono={t.estadoVerificacion === "VALIDO" ? "verde" : t.estadoVerificacion === "RECHAZADO" ? "rojo" : "ambar"}>
                      {t.estadoVerificacion === "VALIDO" ? "Verificado" : t.estadoVerificacion === "RECHAZADO" ? "Rechazado" : "Sin verificar"}
                    </Insignia>
                  </div>
                  {t.consultaEn && (
                    <p>
                      Consultado el {fechaHora(t.consultaEn)}
                      {t.vigenciaDesde && ` · vigencia ${fecha(t.vigenciaDesde)} a ${fecha(t.vigenciaHasta)}`}
                      {t.evidenciaArchivoId && (
                        <>
                          {" · "}
                          <a className="text-blue-800 underline" href={`/api/archivos/${t.evidenciaArchivoId}`} target="_blank" rel="noreferrer">
                            evidencia
                          </a>
                        </>
                      )}
                    </p>
                  )}
                  <button type="button" className="boton-secundario mt-2" onClick={() => setVerificando(t)}>
                    Registrar verificación
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
      <DialogoMotivo
        abierto={pedirMotivo !== null}
        titulo={pedirMotivo === "RECHAZADO" ? "Rechazar proveedor" : "Observar proveedor"}
        textoBoton={pedirMotivo === "RECHAZADO" ? "Rechazar" : "Observar"}
        alCerrar={() => setPedirMotivo(null)}
        alConfirmar={(motivo) => {
          const estado = pedirMotivo!;
          setPedirMotivo(null);
          void guardarYCambiarEstado(estado, motivo);
        }}
      />
      {verificando && (
        <VerificacionTimbrado
          timbrado={verificando}
          alCerrar={() => setVerificando(null)}
          alGuardar={async () => {
            setVerificando(null);
            setMensaje("Verificación registrada");
            await cargar();
          }}
        />
      )}
    </Dialogo>
  );
}

/** Verificación manual en la consulta pública de la DNIT, con evidencia (sección 11.4). */
function VerificacionTimbrado({ timbrado, alCerrar, alGuardar }: { timbrado: Timbrado; alCerrar: () => void; alGuardar: () => Promise<void> }) {
  const ahora = new Date();
  const local = new Date(ahora.getTime() - ahora.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const [datos, setDatos] = useState({ resultado: "VALIDO", vigenciaDesde: timbrado.vigenciaDesde ?? "", vigenciaHasta: timbrado.vigenciaHasta ?? "", consultaEn: local, observacion: "" });
  const [evidencia, setEvidencia] = useState<File | null>(null);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    try {
      let evidenciaArchivoId: number | null = null;
      if (evidencia) {
        const formulario = new FormData();
        formulario.set("archivo", evidencia, evidencia.name);
        evidenciaArchivoId = (await apiFormulario<{ id: number }>("/archivos/evidencia", formulario)).id;
      }
      await api(`/proveedores/timbrados/${timbrado.id}/verificacion`, {
        cuerpo: {
          resultado: datos.resultado,
          vigenciaDesde: datos.vigenciaDesde || null,
          vigenciaHasta: datos.vigenciaHasta || null,
          consultaEn: new Date(datos.consultaEn).toISOString(),
          observacion: datos.observacion || undefined,
          evidenciaArchivoId,
        },
      });
      await alGuardar();
    } catch (err) {
      if (err instanceof ErrorApi && err.detalles) setErrores(err.detalles as Record<string, string>);
      setError(err instanceof Error ? err.message : "No se pudo guardar");
    }
  }

  return (
    <Dialogo abierto titulo={`Verificar timbrado ${timbrado.numero}`} alCerrar={alCerrar}>
      <form onSubmit={enviar} className="space-y-3">
        <p className="text-sm text-slate-700">
          Consultá el timbrado en la página pública de la DNIT y registrá el resultado. La verificación se reutiliza para todos los
          comprobantes de este timbrado dentro de la vigencia.
        </p>
        <fieldset>
          <legend className="etiqueta">Resultado</legend>
          {[
            ["VALIDO", "Válido y vigente"],
            ["RECHAZADO", "Inexistente, ajeno, cancelado o vencido"],
          ].map(([valor, texto]) => (
            <label key={valor} className="flex min-h-11 items-center gap-2">
              <input type="radio" name="resultado" className="size-5" checked={datos.resultado === valor} onChange={() => setDatos({ ...datos, resultado: valor! })} />
              {texto}
            </label>
          ))}
        </fieldset>
        <div className="grid gap-3 md:grid-cols-2">
          <Campo etiqueta="Vigente desde" type="date" value={datos.vigenciaDesde} onChange={(e) => setDatos({ ...datos, vigenciaDesde: e.target.value })} error={errores.vigenciaDesde} />
          <Campo etiqueta="Vigente hasta" type="date" value={datos.vigenciaHasta} onChange={(e) => setDatos({ ...datos, vigenciaHasta: e.target.value })} error={errores.vigenciaHasta} />
        </div>
        <Campo etiqueta="Fecha y hora de la consulta" type="datetime-local" value={datos.consultaEn} onChange={(e) => setDatos({ ...datos, consultaEn: e.target.value })} />
        <div>
          <label className="etiqueta" htmlFor="evidencia">
            Evidencia (captura o PDF de la consulta)
          </label>
          <input id="evidencia" type="file" accept="image/*,application/pdf" className="campo py-2" onChange={(e) => setEvidencia(e.target.files?.[0] ?? null)} />
        </div>
        <Campo etiqueta="Observación (opcional)" value={datos.observacion} onChange={(e) => setDatos({ ...datos, observacion: e.target.value })} />
        {error && <p role="alert" className="error-campo">⚠ {error}</p>}
        <div className="flex gap-2">
          <button type="submit" className="boton-primario">
            Guardar verificación
          </button>
          <button type="button" className="boton-secundario" onClick={alCerrar}>
            Cancelar
          </button>
        </div>
      </form>
    </Dialogo>
  );
}
