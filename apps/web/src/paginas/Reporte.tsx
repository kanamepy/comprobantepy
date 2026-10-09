import { useEffect, useState } from "react";
import { Link } from "react-router";
import { api } from "../api";
import { SelectorContribuyente } from "../componentes/SelectorContribuyente";
import { useContribuyenteElegido } from "../contribuyenteElegido";
import { ETIQUETA_NATURALEZA, etiquetaEstado, fecha, importe, tipoTexto } from "../formato";

interface Totales {
  cantidad: number;
  total: number;
}
interface Reporte {
  desde: string;
  hasta: string;
  secciones: Record<"DEFINITIVO" | "PRELIMINAR" | "RECHAZADO" | "DUPLICADO" | "ANULADO", Totales>;
  definitivos: {
    porNaturaleza: Record<string, Totales>;
    porDestino: Record<string, Totales>;
    porObligacion: Record<string, { descripcion: string; cantidad: number; imputado: number; actividades: Record<string, number> }>;
    iva10: number;
    iva5: number;
  };
  detalle: {
    id: number;
    seccion: string;
    fechaEmision: string | null;
    naturaleza: string;
    tipoComprobante: number | null;
    numero: string | null;
    proveedor: string | null;
    totalGs: number;
    estadoFlujo: string;
    obligaciones: string;
  }[];
}

const SECCIONES = [
  ["DEFINITIVO", "Definitivos (aprobados)"],
  ["PRELIMINAR", "Preliminares (en revisión)"],
  ["DUPLICADO", "Posibles duplicados (no suman)"],
  ["RECHAZADO", "Rechazados"],
  ["ANULADO", "Anulados"],
] as const;

const DESTINO: Record<string, string> = { COMPRAS: "Compras", EGRESOS: "Egresos", NO_EXPORTABLE: "Sin destino" };

/** Reporte tributario consolidado (sección 19). */
export function Reporte() {
  const { contribuyente, lista, elegir } = useContribuyenteElegido();
  const hoy = new Date();
  const [desde, setDesde] = useState(`${hoy.getFullYear()}-01-01`);
  const [hasta, setHasta] = useState(`${hoy.getFullYear()}-12-31`);
  const [reporte, setReporte] = useState<Reporte | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verSeccion, setVerSeccion] = useState("DEFINITIVO");

  const parametros = contribuyente ? new URLSearchParams({ contribuyenteId: String(contribuyente.id), desde, hasta }) : null;

  useEffect(() => {
    if (!parametros) return;
    api<Reporte>(`/reportes/consolidado?${parametros}`).then(
      (r) => {
        setReporte(r);
        setError(null);
      },
      (err: Error) => setError(err.message),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contribuyente?.id, desde, hasta]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-bold">Reporte tributario consolidado</h1>
        {parametros && (
          <a href={`/api/reportes/consolidado.xlsx?${parametros}`} className="boton-secundario print:hidden">
            ⬇ Excel
          </a>
        )}
        <button type="button" className="boton-secundario print:hidden" onClick={() => window.print()}>
          🖨 Imprimir / PDF
        </button>
      </div>
      <p className="text-slate-700">
        Incluye comprobantes físicos, electrónicos y virtuales. Cada comprobante suma una sola vez en el total general, aunque esté
        imputado a varias obligaciones.
      </p>
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <SelectorContribuyente contribuyente={contribuyente} lista={lista} alElegir={elegir} />
        <div>
          <label className="etiqueta" htmlFor="desde">
            Desde
          </label>
          <input id="desde" type="date" className="campo" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </div>
        <div>
          <label className="etiqueta" htmlFor="hasta">
            Hasta
          </label>
          <input id="hasta" type="date" className="campo" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </div>
      </div>
      {error && <p role="alert" className="error-campo">⚠ {error}</p>}

      {reporte && (
        <>
          <p className="hidden print:block">
            {contribuyente?.nombre} · del {fecha(reporte.desde)} al {fecha(reporte.hasta)}
          </p>
          <ul className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {SECCIONES.map(([clave, texto]) => (
              <li key={clave} className="tarjeta">
                <p className="text-sm text-slate-700">{texto}</p>
                <p className="text-xl font-bold">{importe(String(reporte.secciones[clave].total))}</p>
                <p className="text-sm text-slate-600">{reporte.secciones[clave].cantidad} comprobantes</p>
              </li>
            ))}
          </ul>

          <div className="grid gap-4 md:grid-cols-2">
            <section className="tarjeta">
              <h2 className="mb-2 font-semibold">Definitivos por naturaleza</h2>
              <Tabla filas={Object.entries(reporte.definitivos.porNaturaleza).map(([k, t]) => [ETIQUETA_NATURALEZA[k] ?? k, t.cantidad, t.total])} />
            </section>
            <section className="tarjeta">
              <h2 className="mb-2 font-semibold">Definitivos por destino</h2>
              <Tabla filas={Object.entries(reporte.definitivos.porDestino).map(([k, t]) => [DESTINO[k] ?? k, t.cantidad, t.total])} />
              <p className="mt-2 text-sm text-slate-700">
                IVA 10 %: {importe(String(reporte.definitivos.iva10))} · IVA 5 %: {importe(String(reporte.definitivos.iva5))}
              </p>
            </section>
          </div>

          <section className="tarjeta">
            <h2 className="mb-2 font-semibold">Definitivos por obligación (importe imputado)</h2>
            {Object.keys(reporte.definitivos.porObligacion).length === 0 ? (
              <p className="text-slate-700">Sin comprobantes imputados.</p>
            ) : (
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="py-1">Obligación / actividad</th>
                    <th className="py-1 text-right">Comprobantes</th>
                    <th className="py-1 text-right">Imputado</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(reporte.definitivos.porObligacion).map(([codigo, o]) => [
                    <tr key={codigo} className="border-b border-slate-100 font-medium">
                      <td className="py-1">{o.descripcion}</td>
                      <td className="py-1 text-right">{o.cantidad}</td>
                      <td className="py-1 text-right">{importe(String(o.imputado))}</td>
                    </tr>,
                    ...Object.entries(o.actividades).map(([actividad, monto]) => (
                      <tr key={`${codigo}-${actividad}`} className="text-slate-700">
                        <td className="py-1 pl-4">{actividad}</td>
                        <td />
                        <td className="py-1 text-right">{importe(String(monto))}</td>
                      </tr>
                    )),
                  ])}
                </tbody>
              </table>
            )}
          </section>

          <section className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 print:hidden">
              <h2 className="mr-auto font-semibold">Detalle</h2>
              <label htmlFor="ver-seccion" className="sr-only">
                Sección
              </label>
              <select id="ver-seccion" className="campo w-auto" value={verSeccion} onChange={(e) => setVerSeccion(e.target.value)}>
                {SECCIONES.map(([clave, texto]) => (
                  <option key={clave} value={clave}>
                    {texto}
                  </option>
                ))}
              </select>
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-100">
                  <tr>
                    <th className="p-2">Fecha</th>
                    <th className="p-2">Proveedor</th>
                    <th className="p-2">Comprobante</th>
                    <th className="p-2">Naturaleza</th>
                    <th className="p-2">Obligaciones</th>
                    <th className="p-2">Estado</th>
                    <th className="p-2 text-right">Total (Gs.)</th>
                  </tr>
                </thead>
                <tbody>
                  {reporte.detalle
                    .filter((d) => d.seccion === verSeccion)
                    .map((d) => (
                      <tr key={d.id} className="border-t border-slate-200">
                        <td className="p-2">{fecha(d.fechaEmision)}</td>
                        <td className="p-2">{d.proveedor}</td>
                        <td className="p-2">
                          <Link to={`/comprobantes/${d.id}`} className="text-blue-800 underline print:no-underline">
                            {tipoTexto(d.tipoComprobante)} {d.numero}
                          </Link>
                        </td>
                        <td className="p-2">{ETIQUETA_NATURALEZA[d.naturaleza]}</td>
                        <td className="p-2">{d.obligaciones}</td>
                        <td className="p-2">{etiquetaEstado(d.estadoFlujo)}</td>
                        <td className="p-2 text-right">{importe(String(d.totalGs))}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Tabla({ filas }: { filas: [string, number, number][] }) {
  if (filas.length === 0) return <p className="text-slate-700">Sin datos.</p>;
  return (
    <table className="w-full text-left text-sm">
      <tbody>
        {filas.map(([nombre, cantidad, total]) => (
          <tr key={nombre} className="border-b border-slate-100">
            <td className="py-1">{nombre}</td>
            <td className="py-1 text-right">{cantidad}</td>
            <td className="py-1 text-right font-medium">{importe(String(total))}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
