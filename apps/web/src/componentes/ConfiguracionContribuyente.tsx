import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, ErrorApi } from "../api";
import { fecha } from "../formato";
import { DialogoMotivo } from "./Dialogo";

interface ObligacionContribuyente {
  id: number;
  obligacion: string;
  descripcion: string;
  vigenteDesde: string;
  vigenteHasta: string | null;
  estado: "ACTIVO" | "ANULADO";
}
interface Actividad {
  id: number;
  descripcion: string;
  estado: "ACTIVO" | "INACTIVO";
}

/** Obligaciones con vigencia y actividades de un contribuyente (secciones 2.2 y 14.1). */
export function ConfiguracionContribuyente({ id, puedeEditar }: { id: number; puedeEditar: boolean }) {
  const [obligaciones, setObligaciones] = useState<ObligacionContribuyente[]>([]);
  const [actividades, setActividades] = useState<Actividad[]>([]);
  const [catalogo, setCatalogo] = useState<{ codigo: string; descripcion: string }[]>([]);
  const [nueva, setNueva] = useState({ obligacion: "", vigenteDesde: `${new Date().getFullYear()}-01-01`, vigenteHasta: "" });
  const [nuevaActividad, setNuevaActividad] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [anulando, setAnulando] = useState<ObligacionContribuyente | null>(null);

  const cargar = useCallback(async () => {
    const [o, a, c] = await Promise.all([
      api<ObligacionContribuyente[]>(`/contribuyentes/${id}/obligaciones`),
      api<Actividad[]>(`/contribuyentes/${id}/actividades`),
      api<{ obligaciones: { codigo: string; descripcion: string }[] }>("/catalogos"),
    ]);
    setObligaciones(o);
    setActividades(a);
    setCatalogo(c.obligaciones);
  }, [id]);

  useEffect(() => {
    void cargar().catch((err: Error) => setError(err.message));
  }, [cargar]);

  async function ejecutar(accion: () => Promise<unknown>) {
    setError(null);
    try {
      await accion();
      await cargar();
    } catch (err) {
      const detalles = err instanceof ErrorApi && err.detalles ? Object.values(err.detalles).join(" ") : "";
      setError(`${err instanceof Error ? err.message : "Error"} ${detalles}`.trim());
    }
  }

  async function agregarObligacion(e: FormEvent) {
    e.preventDefault();
    await ejecutar(() =>
      api(`/contribuyentes/${id}/obligaciones`, {
        cuerpo: { obligacion: nueva.obligacion, vigenteDesde: nueva.vigenteDesde, vigenteHasta: nueva.vigenteHasta || null },
      }),
    );
    setNueva({ ...nueva, obligacion: "" });
  }

  return (
    <div className="space-y-4 border-t border-slate-200 pt-3">
      <section className="space-y-2">
        <h3 className="font-semibold">Obligaciones</h3>
        {obligaciones.length === 0 && <p className="text-sm text-amber-900">⚠ Sin obligaciones: no se podrán imputar comprobantes.</p>}
        <ul className="space-y-1 text-sm">
          {obligaciones.map((o) => (
            <li key={o.id} className={`flex flex-wrap items-center gap-2 ${o.estado === "ANULADO" ? "line-through opacity-60" : ""}`}>
              <span className="mr-auto">
                {o.descripcion} · desde {fecha(o.vigenteDesde)}
                {o.vigenteHasta ? ` hasta ${fecha(o.vigenteHasta)}` : ""}
              </span>
              {puedeEditar && o.estado === "ACTIVO" && (
                <button type="button" className="boton text-sm text-red-800 underline" onClick={() => setAnulando(o)}>
                  Anular
                </button>
              )}
            </li>
          ))}
        </ul>
        {puedeEditar && (
          <form onSubmit={agregarObligacion} className="grid gap-2 sm:grid-cols-2 sm:items-end">
            <div className="sm:col-span-2">
              <label className="etiqueta text-sm" htmlFor={`obl-${id}`}>
                Obligación
              </label>
              <select id={`obl-${id}`} className="campo sm:col-span-2" value={nueva.obligacion} onChange={(e) => setNueva({ ...nueva, obligacion: e.target.value })} required>
                <option value="">Elegí…</option>
                {catalogo.map((c) => (
                  <option key={c.codigo} value={c.codigo}>
                    {c.descripcion}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="etiqueta text-sm" htmlFor={`desde-${id}`}>
                Desde
              </label>
              <input id={`desde-${id}`} type="date" className="campo" value={nueva.vigenteDesde} onChange={(e) => setNueva({ ...nueva, vigenteDesde: e.target.value })} required />
            </div>
            <div>
              <label className="etiqueta text-sm" htmlFor={`hasta-${id}`}>
                Hasta (opcional)
              </label>
              <input id={`hasta-${id}`} type="date" className="campo" value={nueva.vigenteHasta} onChange={(e) => setNueva({ ...nueva, vigenteHasta: e.target.value })} />
            </div>
            <button type="submit" className="boton-secundario sm:col-span-2">
              Agregar obligación
            </button>
          </form>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold">Actividades económicas</h3>
        <ul className="space-y-1 text-sm">
          {actividades.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-2">
              <span className={`mr-auto ${a.estado === "INACTIVO" ? "opacity-60" : ""}`}>
                {a.descripcion} {a.estado === "INACTIVO" && "(inactiva)"}
              </span>
              {puedeEditar && (
                <button
                  type="button"
                  className="boton text-sm underline"
                  onClick={() =>
                    void ejecutar(() => api(`/contribuyentes/${id}/actividades/${a.id}/estado`, { cuerpo: { estado: a.estado === "ACTIVO" ? "INACTIVO" : "ACTIVO" } }))
                  }
                >
                  {a.estado === "ACTIVO" ? "Desactivar" : "Reactivar"}
                </button>
              )}
            </li>
          ))}
        </ul>
        {puedeEditar && (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              await ejecutar(() => api(`/contribuyentes/${id}/actividades`, { cuerpo: { descripcion: nuevaActividad } }));
              setNuevaActividad("");
            }}
          >
            <div className="grow">
              <label className="etiqueta text-sm" htmlFor={`act-${id}`}>
                Nueva actividad
              </label>
              <input id={`act-${id}`} className="campo" placeholder="Servicios profesionales, consultoría…" value={nuevaActividad} onChange={(e) => setNuevaActividad(e.target.value)} required />
            </div>
            <button type="submit" className="boton-secundario">
              Agregar actividad
            </button>
          </form>
        )}
      </section>
      {error && <p role="alert" className="error-campo">⚠ {error}</p>}
      <DialogoMotivo
        abierto={anulando !== null}
        titulo={`Anular ${anulando?.descripcion ?? ""}`}
        textoBoton="Anular"
        alCerrar={() => setAnulando(null)}
        alConfirmar={(motivo) => {
          const o = anulando!;
          setAnulando(null);
          void ejecutar(() => api(`/contribuyentes/${id}/obligaciones/${o.id}/anular`, { cuerpo: { motivo } }));
        }}
      />
    </div>
  );
}
