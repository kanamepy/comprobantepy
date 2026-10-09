import { useId } from "react";

export interface LineaEditable {
  obligacion: string;
  actividadId: number | null;
  porcentaje: number;
}

interface Props {
  lineas: LineaEditable[];
  porcentajeNoImputado: number;
  obligaciones: { codigo: string; descripcion: string }[];
  actividades: { id: number; descripcion: string }[];
  alCambiar: (lineas: LineaEditable[], porcentajeNoImputado: number) => void;
  deshabilitado?: boolean;
}

/** Imputación múltiple: varias obligaciones y actividades con porcentaje (sección 14). */
export function EditorImputacion({ lineas, porcentajeNoImputado, obligaciones, actividades, alCambiar, deshabilitado }: Props) {
  const id = useId();
  const cambiarLinea = (indice: number, cambios: Partial<LineaEditable>) =>
    alCambiar(
      lineas.map((l, i) => (i === indice ? { ...l, ...cambios } : l)),
      porcentajeNoImputado,
    );
  const imputable = 100 - porcentajeNoImputado;
  const totales = new Map<string, number>();
  for (const l of lineas) totales.set(l.obligacion, (totales.get(l.obligacion) ?? 0) + l.porcentaje);

  return (
    <div className="space-y-3">
      {obligaciones.length === 0 && (
        <p className="text-sm text-amber-900">
          ⚠ El contribuyente no tiene obligaciones activas a la fecha del comprobante. Configuralas en Contribuyentes.
        </p>
      )}
      {lineas.map((linea, i) => (
        <div key={i} className="grid gap-2 rounded-lg border border-slate-200 p-3 md:grid-cols-[1fr_1fr_8rem_auto] md:items-end">
          <div>
            <label className="etiqueta text-sm" htmlFor={`${id}-o${i}`}>
              Obligación
            </label>
            <select
              id={`${id}-o${i}`}
              className="campo"
              value={linea.obligacion}
              disabled={deshabilitado}
              onChange={(e) => cambiarLinea(i, { obligacion: e.target.value })}
            >
              <option value="">Elegí…</option>
              {obligaciones.map((o) => (
                <option key={o.codigo} value={o.codigo}>
                  {o.descripcion}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="etiqueta text-sm" htmlFor={`${id}-a${i}`}>
              Actividad (opcional)
            </label>
            <select
              id={`${id}-a${i}`}
              className="campo"
              value={linea.actividadId ?? ""}
              disabled={deshabilitado}
              onChange={(e) => cambiarLinea(i, { actividadId: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">Sin actividad</option>
              {actividades.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.descripcion}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="etiqueta text-sm" htmlFor={`${id}-p${i}`}>
              Porcentaje
            </label>
            <input
              id={`${id}-p${i}`}
              className="campo"
              type="number"
              min={0}
              max={100}
              step="0.01"
              inputMode="decimal"
              value={linea.porcentaje}
              disabled={deshabilitado}
              onChange={(e) => cambiarLinea(i, { porcentaje: Number(e.target.value) })}
            />
          </div>
          <button
            type="button"
            className="boton-secundario"
            disabled={deshabilitado}
            onClick={() => alCambiar(lineas.filter((_, j) => j !== i), porcentajeNoImputado)}
            aria-label="Quitar línea"
          >
            Quitar
          </button>
        </div>
      ))}
      <div className="flex flex-wrap items-end gap-3">
        <button
          type="button"
          className="boton-secundario"
          disabled={deshabilitado}
          onClick={() => alCambiar([...lineas, { obligacion: obligaciones[0]?.codigo ?? "", actividadId: null, porcentaje: imputable }], porcentajeNoImputado)}
        >
          ＋ Agregar obligación
        </button>
        <div>
          <label className="etiqueta text-sm" htmlFor={`${id}-ni`}>
            Parte que no se imputa (%)
          </label>
          <input
            id={`${id}-ni`}
            className="campo w-32"
            type="number"
            min={0}
            max={100}
            step="0.01"
            value={porcentajeNoImputado}
            disabled={deshabilitado}
            onChange={(e) => alCambiar(lineas, Number(e.target.value))}
          />
        </div>
      </div>
      {[...totales].map(([obligacion, total]) =>
        obligacion && Math.abs(total - imputable) > 0.001 ? (
          <p key={obligacion} className="text-sm font-medium text-amber-900">
            ⚠ {obligacion}: las actividades suman {total} % y deben sumar {imputable} %.
          </p>
        ) : null,
      )}
      <p className="text-sm text-slate-600">
        La misma base puede imputarse al 100 % en obligaciones distintas; los porcentajes de obligaciones diferentes no se suman entre sí.
      </p>
    </div>
  );
}
