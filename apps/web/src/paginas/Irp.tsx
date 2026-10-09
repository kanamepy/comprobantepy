import { ETIQUETA_TRATAMIENTO, type TratamientoEgreso } from "@comprobantepy/shared";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { api, ErrorApi } from "../api";
import { Campo } from "../componentes/Campo";
import { Dialogo, DialogoMotivo } from "../componentes/Dialogo";
import { Insignia } from "../componentes/Insignia";
import { SelectorContribuyente } from "../componentes/SelectorContribuyente";
import { useContribuyenteElegido } from "../contribuyenteElegido";
import { fecha, fechaHora, importe, MESES } from "../formato";

interface Sumas {
  confirmado: number;
  pendiente: number;
}
interface Proyeccion {
  rentaNetaCalculada: number;
  rentaNetaImponible: number;
  impuestoDeterminado: number;
  detalle: { desde: number; hasta: number; base: number; tasaPuntosBasicos: number; impuesto: number }[];
  saldoProyectado: number;
}
interface Tablero {
  ejercicio: number;
  aviso: string;
  parametros: { tramos: { hasta: number | null; tasaPuntosBasicos: number }[]; fuente: string; version: number; compensacionesHabilitadas: boolean };
  ingresos: { gravados: Sumas; exonerados: Sumas };
  egresos: { admitidosConfirmados: number; pendientes: number; noDeducibles: number; excluidos: number; cantidadPendientes: number; cantidad: number };
  creditos: { saldoAnterior: Sumas; retenciones: Sumas; percepciones: Sumas; ajustesYMultas: Sumas };
  escenarios: { confirmado: Proyeccion; proyectado: Proyeccion };
  porMes: { mes: number; ingresosGravados: number; egresosConfirmados: number; egresosPendientes: number; cerrado: boolean }[];
  completitud: { porcentaje: number; mesesTranscurridos: number; mesesConIngresos: number; egresosConfirmados: number; egresosTotales: number; saldoAnteriorRegistrado: boolean };
  advertencias: string[];
}
interface Cierre {
  id: number;
  mes: number | null;
  estado: "CERRADO" | "REABIERTO";
  cerradoEn: string;
  reabiertoEn: string | null;
  motivoReapertura: string | null;
  diferencias: { concepto: string; cerrado: number; actual: number }[];
}
interface Egreso {
  id: number;
  fechaEmision: string;
  proveedor: string | null;
  numero: string | null;
  naturaleza: string;
  estadoFlujo: string;
  imputado: number;
  tratamiento: TratamientoEgreso | null;
  porcentajeAdmitido: number | null;
  confirmado: boolean;
  sugerencia: { tratamiento: TratamientoEgreso; porcentajeAdmitido: number | null; motivo: string };
  categoria: "CONFIRMADO" | "NO_DEDUCIBLE" | "PENDIENTE" | "EXCLUIDO";
  admitido: number;
}
interface Ingreso {
  id: number;
  fecha: string;
  tipo: string;
  tratamiento: "GRAVADO" | "EXONERADO";
  pagador: string | null;
  descripcion: string | null;
  importe: string;
  estado: "PENDIENTE" | "CONFIRMADO" | "ANULADO";
  actividad: string | null;
  anuladoMotivo: string | null;
}
interface Movimiento {
  id: number;
  fecha: string;
  tipo: "SALDO_ANTERIOR" | "RETENCION" | "PERCEPCION" | "AJUSTE" | "MULTA";
  agente: string | null;
  numeroComprobante: string | null;
  descripcion: string | null;
  importe: string;
  estado: "PENDIENTE" | "CONFIRMADO" | "ANULADO";
}

const TIPO_INGRESO: Record<string, string> = {
  SALARIO: "Salario o liquidación",
  HONORARIOS: "Honorarios profesionales",
  COMISIONES: "Comisiones o bonificaciones",
  OTROS_GRAVADOS: "Otros ingresos gravados",
  EXONERADO: "Ingreso exonerado",
  ATRIBUIDO: "Ingreso atribuido",
  AJUSTE: "Nota o ajuste",
};
const TIPO_MOVIMIENTO: Record<Movimiento["tipo"], string> = {
  SALDO_ANTERIOR: "Saldo a favor del ejercicio anterior",
  RETENCION: "Retención a cuenta",
  PERCEPCION: "Percepción a cuenta",
  AJUSTE: "Ajuste",
  MULTA: "Multa",
};
const CONCEPTO: Record<string, string> = {
  ingresosGravados: "Ingresos gravados",
  ingresosExonerados: "Ingresos exonerados",
  egresosAdmitidos: "Egresos deducibles",
  saldoAnterior: "Saldo anterior",
  retenciones: "Retenciones",
  percepciones: "Percepciones",
  ajustesYMultas: "Ajustes y multas",
  rentaNetaImponible: "Renta neta imponible",
  impuestoDeterminado: "Impuesto determinado",
  saldoProyectado: "Saldo proyectado",
};
const gs = (n: number) => importe(String(n));
const PESTANAS = ["Resumen", "Ingresos", "Egresos", "Créditos y saldos", "Cierres", "Tasas y tramos"] as const;

/**
 * Pide el motivo si el período está cerrado y reintenta (sección 20.7).
 * Devuelve false si el usuario cancela.
 */
function useMotivoPostCierre() {
  const [pedido, setPedido] = useState<{ reintentar: (motivo: string) => void; cancelar: () => void } | null>(null);
  const conMotivo = useCallback(async <T,>(accion: (motivo?: string) => Promise<T>): Promise<T | null> => {
    try {
      return await accion();
    } catch (err) {
      if (!(err instanceof ErrorApi) || err.codigo !== "PERIODO_CERRADO") throw err;
      const motivo = await new Promise<string | null>((resolver) =>
        setPedido({ reintentar: (m) => resolver(m), cancelar: () => resolver(null) }),
      );
      setPedido(null);
      return motivo ? accion(motivo) : null;
    }
  }, []);
  const dialogo = (
    <DialogoMotivo
      abierto={pedido !== null}
      titulo="El período está cerrado"
      textoBoton="Guardar con motivo"
      alCerrar={() => pedido?.cancelar()}
      alConfirmar={(m) => pedido?.reintentar(m)}
    />
  );
  return { conMotivo, dialogo };
}

/** Seguimiento anual y proyección informativa del IRP-RSP (sección 20). */
export function Irp() {
  const { contribuyente, lista, elegir } = useContribuyenteElegido();
  const [ejercicio, setEjercicio] = useState(new Date().getFullYear());
  const [pestana, setPestana] = useState<(typeof PESTANAS)[number]>("Resumen");
  const [datos, setDatos] = useState<{ tablero: Tablero; cierres: Cierre[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const recargar = () => setVersion((v) => v + 1);

  useEffect(() => {
    if (!contribuyente) return;
    api<{ tablero: Tablero; cierres: Cierre[] }>(`/irp/${contribuyente.id}/${ejercicio}`).then(
      (d) => {
        setDatos(d);
        setError(null);
      },
      (err: Error) => setError(err.message),
    );
  }, [contribuyente, ejercicio, version]);

  const anio = new Date().getFullYear();
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">IRP-RSP: seguimiento y proyección</h1>
      <p role="note" className="tarjeta border-amber-300 bg-amber-50 text-amber-950">
        ⓘ Proyección <strong>informativa</strong>: no sustituye la declaración jurada (Formulario N.° 515) ni el criterio del profesional
        responsable.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <SelectorContribuyente contribuyente={contribuyente} lista={lista} alElegir={elegir} />
        <div>
          <label className="etiqueta" htmlFor="ejercicio">
            Ejercicio
          </label>
          <select id="ejercicio" className="campo" value={ejercicio} onChange={(e) => setEjercicio(Number(e.target.value))}>
            {[anio - 2, anio - 1, anio].map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
      </div>
      {error && <p role="alert" className="error-campo">⚠ {error}</p>}

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0" role="tablist" aria-label="Secciones del IRP-RSP">
        {PESTANAS.map((p) => (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={pestana === p}
            className={`boton shrink-0 ${pestana === p ? "bg-blue-700 text-white" : "border border-slate-300 bg-white"}`}
            onClick={() => setPestana(p)}
          >
            {p}
          </button>
        ))}
      </div>

      {contribuyente && datos && (
        <>
          {pestana === "Resumen" && <Resumen datos={datos} contribuyenteId={contribuyente.id} alCambiar={recargar} />}
          {pestana === "Ingresos" && <Ingresos contribuyenteId={contribuyente.id} ejercicio={ejercicio} alCambiar={recargar} />}
          {pestana === "Egresos" && <Egresos contribuyenteId={contribuyente.id} ejercicio={ejercicio} alCambiar={recargar} />}
          {pestana === "Créditos y saldos" && <Creditos contribuyenteId={contribuyente.id} ejercicio={ejercicio} alCambiar={recargar} />}
          {pestana === "Cierres" && <Cierres datos={datos} contribuyenteId={contribuyente.id} ejercicio={ejercicio} alCambiar={recargar} />}
          {pestana === "Tasas y tramos" && <Parametros tablero={datos.tablero} alCambiar={recargar} />}
        </>
      )}
    </div>
  );
}

function Tarjeta({ titulo, valor, detalle }: { titulo: string; valor: string; detalle?: string }) {
  return (
    <li className="tarjeta">
      <p className="text-sm text-slate-700">{titulo}</p>
      <p className="text-xl font-bold">{valor}</p>
      {detalle && <p className="text-sm text-slate-600">{detalle}</p>}
    </li>
  );
}

function Resumen({ datos, contribuyenteId, alCambiar }: { datos: { tablero: Tablero; cierres: Cierre[] }; contribuyenteId: number; alCambiar: () => void }) {
  const [escenario, setEscenario] = useState<"confirmado" | "proyectado">("confirmado");
  const t = datos.tablero;
  const p = t.escenarios[escenario];
  const sumar = (s: Sumas) => (escenario === "confirmado" ? s.confirmado : s.confirmado + s.pendiente);
  const egresos = escenario === "confirmado" ? t.egresos.admitidosConfirmados : t.egresos.admitidosConfirmados + t.egresos.pendientes;
  const creditos = sumar(t.creditos.saldoAnterior) + sumar(t.creditos.retenciones) + sumar(t.creditos.percepciones);

  return (
    <div className="space-y-5">
      <fieldset className="flex flex-wrap gap-4">
        <legend className="etiqueta">Escenario</legend>
        <label className="flex min-h-11 items-center gap-2">
          <input type="radio" className="size-5" checked={escenario === "confirmado"} onChange={() => setEscenario("confirmado")} />
          Confirmado (solo lo aprobado)
        </label>
        <label className="flex min-h-11 items-center gap-2">
          <input type="radio" className="size-5" checked={escenario === "proyectado"} onChange={() => setEscenario("proyectado")} />
          Proyectado (suma lo pendiente)
        </label>
      </fieldset>
      {escenario === "proyectado" && t.egresos.pendientes > 0 && (
        <p className="text-sm text-slate-700">
          ⓘ Incluye {gs(t.egresos.pendientes)} de egresos pendientes; los que todavía no se analizaron se suponen deducibles.
        </p>
      )}

      <ul className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Tarjeta titulo="Ingresos gravados" valor={gs(sumar(t.ingresos.gravados))} detalle={`Exonerados: ${gs(sumar(t.ingresos.exonerados))}`} />
        <Tarjeta titulo="Egresos deducibles" valor={gs(egresos)} detalle={`${t.egresos.cantidadPendientes} de ${t.egresos.cantidad} pendientes`} />
        <Tarjeta titulo="Renta neta imponible" valor={gs(p.rentaNetaImponible)} detalle={p.rentaNetaCalculada < 0 ? `Calculada: ${gs(p.rentaNetaCalculada)} (se toma 0)` : undefined} />
        <Tarjeta titulo="Impuesto determinado" valor={gs(p.impuestoDeterminado)} />
        <Tarjeta titulo="Saldo anterior, retenciones y percepciones" valor={gs(creditos)} detalle={sumar(t.creditos.ajustesYMultas) ? `Ajustes y multas: ${gs(sumar(t.creditos.ajustesYMultas))}` : undefined} />
        <li className={`tarjeta ${p.saldoProyectado > 0 ? "border-red-300 bg-red-50" : "border-green-300 bg-green-50"}`}>
          <p className="text-sm text-slate-700">Saldo estimado</p>
          <p className="text-xl font-bold">{gs(Math.abs(p.saldoProyectado))}</p>
          <p className="text-sm font-medium">{p.saldoProyectado > 0 ? "▲ A pagar" : p.saldoProyectado < 0 ? "▼ A favor" : "Sin saldo"}</p>
        </li>
      </ul>

      {p.detalle.length > 0 && (
        <section className="tarjeta">
          <h2 className="mb-2 font-semibold">Cálculo por porciones de renta</h2>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="py-1">Porción</th>
                <th className="py-1 text-right">Base</th>
                <th className="py-1 text-right">Tasa</th>
                <th className="py-1 text-right">Impuesto</th>
              </tr>
            </thead>
            <tbody>
              {p.detalle.map((d) => (
                <tr key={d.desde} className="border-b border-slate-100">
                  <td className="py-1">
                    {gs(d.desde)} a {gs(d.hasta)}
                  </td>
                  <td className="py-1 text-right">{gs(d.base)}</td>
                  <td className="py-1 text-right">{d.tasaPuntosBasicos / 100} %</td>
                  <td className="py-1 text-right">{gs(d.impuesto)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="tarjeta space-y-2">
        <h2 className="font-semibold">Completitud de la información: {t.completitud.porcentaje} %</h2>
        <div className="h-3 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuenow={t.completitud.porcentaje} aria-valuemin={0} aria-valuemax={100} aria-label="Completitud">
          <div className="h-full bg-blue-700" style={{ width: `${t.completitud.porcentaje}%` }} />
        </div>
        <p className="text-sm text-slate-700">
          {t.completitud.mesesConIngresos} de {t.completitud.mesesTranscurridos} meses con ingresos · {t.completitud.egresosConfirmados} de{" "}
          {t.completitud.egresosTotales} egresos con tratamiento confirmado · saldo anterior {t.completitud.saldoAnteriorRegistrado ? "registrado" : "sin registrar"}
        </p>
        {t.advertencias.length > 0 && (
          <ul className="space-y-1 text-sm text-amber-900">
            {t.advertencias.map((a) => (
              <li key={a}>⚠ {a}</li>
            ))}
          </ul>
        )}
      </section>

      <MesesTabla tablero={t} contribuyenteId={contribuyenteId} alCambiar={alCambiar} />
    </div>
  );
}

function MesesTabla({ tablero, contribuyenteId, alCambiar }: { tablero: Tablero; contribuyenteId: number; alCambiar: () => void }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="space-y-2">
      <h2 className="font-semibold">Por mes</h2>
      {error && <p role="alert" className="error-campo">⚠ {error}</p>}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-100">
            <tr>
              <th className="p-2">Mes</th>
              <th className="p-2 text-right">Ingresos gravados</th>
              <th className="p-2 text-right">Egresos deducibles</th>
              <th className="p-2 text-right">Egresos pendientes</th>
              <th className="p-2">Cierre</th>
            </tr>
          </thead>
          <tbody>
            {tablero.porMes.map((m) => (
              <tr key={m.mes} className="border-t border-slate-200">
                <td className="p-2 capitalize">{MESES[m.mes - 1]}</td>
                <td className="p-2 text-right">{gs(m.ingresosGravados)}</td>
                <td className="p-2 text-right">{gs(m.egresosConfirmados)}</td>
                <td className="p-2 text-right">{gs(m.egresosPendientes)}</td>
                <td className="p-2">
                  {m.cerrado ? (
                    <Insignia tono="verde" icono="🔒">
                      Cerrado
                    </Insignia>
                  ) : (
                    <button
                      type="button"
                      className="boton text-sm text-blue-800 underline"
                      onClick={async () => {
                        try {
                          await api(`/irp/${contribuyenteId}/${tablero.ejercicio}/cierres`, { cuerpo: { mes: m.mes } });
                          alCambiar();
                        } catch (err) {
                          setError(err instanceof Error ? err.message : "No se pudo cerrar");
                        }
                      }}
                    >
                      Cerrar mes
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Ingresos({ contribuyenteId, ejercicio, alCambiar }: { contribuyenteId: number; ejercicio: number; alCambiar: () => void }) {
  const [lista, setLista] = useState<Ingreso[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [anulando, setAnulando] = useState<Ingreso | null>(null);
  const [formulario, setFormulario] = useState({ fecha: `${ejercicio}-01-31`, tipo: "HONORARIOS", tratamiento: "GRAVADO", importe: "", pagador: "", descripcion: "" });
  const { conMotivo, dialogo } = useMotivoPostCierre();

  const cargar = useCallback(async () => setLista(await api<Ingreso[]>(`/irp/${contribuyenteId}/${ejercicio}/ingresos`)), [contribuyenteId, ejercicio]);
  useEffect(() => {
    void cargar().catch((e: Error) => setError(e.message));
  }, [cargar]);

  async function ejecutar(accion: (motivo?: string) => Promise<unknown>) {
    setError(null);
    try {
      await conMotivo(accion);
      await cargar();
      alCambiar();
    } catch (err) {
      setError(err instanceof ErrorApi && err.detalles ? Object.values(err.detalles).join(" ") : err instanceof Error ? err.message : "Error");
    }
  }

  async function agregar(e: FormEvent) {
    e.preventDefault();
    await ejecutar((motivo) =>
      api(`/irp/${contribuyenteId}/ingresos`, {
        cuerpo: {
          fecha: formulario.fecha,
          tipo: formulario.tipo,
          tratamiento: formulario.tratamiento,
          importe: Number(formulario.importe.replace(/\D/g, "")),
          pagador: formulario.pagador || undefined,
          descripcion: formulario.descripcion || undefined,
          motivo,
        },
      }),
    );
    setFormulario({ ...formulario, importe: "", descripcion: "" });
  }

  return (
    <div className="space-y-4">
      <form onSubmit={agregar} className="tarjeta grid gap-3 md:grid-cols-3">
        <h2 className="font-semibold md:col-span-3">Registrar ingreso</h2>
        <Campo etiqueta="Fecha" type="date" value={formulario.fecha} onChange={(e) => setFormulario({ ...formulario, fecha: e.target.value })} />
        <div>
          <label className="etiqueta" htmlFor="tipo-ingreso">
            Tipo
          </label>
          <select
            id="tipo-ingreso"
            className="campo"
            value={formulario.tipo}
            onChange={(e) => setFormulario({ ...formulario, tipo: e.target.value, tratamiento: e.target.value === "EXONERADO" ? "EXONERADO" : formulario.tratamiento })}
          >
            {Object.entries(TIPO_INGRESO).map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="etiqueta" htmlFor="tratamiento-ingreso">
            Tratamiento
          </label>
          <select id="tratamiento-ingreso" className="campo" value={formulario.tratamiento} onChange={(e) => setFormulario({ ...formulario, tratamiento: e.target.value })}>
            <option value="GRAVADO">Gravado</option>
            <option value="EXONERADO">Exonerado</option>
          </select>
        </div>
        <Campo etiqueta="Importe (Gs.)" inputMode="numeric" value={formulario.importe} onChange={(e) => setFormulario({ ...formulario, importe: e.target.value.replace(/[^\d]/g, "") })} />
        <Campo etiqueta="Pagador (opcional)" value={formulario.pagador} onChange={(e) => setFormulario({ ...formulario, pagador: e.target.value })} />
        <Campo etiqueta="Descripción (opcional)" value={formulario.descripcion} onChange={(e) => setFormulario({ ...formulario, descripcion: e.target.value })} />
        <div className="md:col-span-3">
          <button type="submit" className="boton-primario" disabled={!formulario.importe}>
            Agregar ingreso
          </button>
        </div>
      </form>
      {error && <p role="alert" className="error-campo">⚠ {error}</p>}
      <ListaSimple
        filas={lista.map((i) => ({
          id: i.id,
          anulado: i.estado === "ANULADO",
          titulo: `${fecha(i.fecha)} · ${TIPO_INGRESO[i.tipo] ?? i.tipo}`,
          detalle: [i.tratamiento === "GRAVADO" ? "Gravado" : "Exonerado", i.pagador, i.descripcion, i.anuladoMotivo && `Anulado: ${i.anuladoMotivo}`].filter(Boolean).join(" · "),
          importe: Number(i.importe),
          estado: i.estado,
          acciones: (
            <>
              {i.estado === "PENDIENTE" && (
                <button type="button" className="boton-secundario" onClick={() => void ejecutar(() => api(`/irp/${contribuyenteId}/ingresos/${i.id}/confirmar`, { cuerpo: {} }))}>
                  Confirmar
                </button>
              )}
              {i.estado !== "ANULADO" && (
                <button type="button" className="boton-secundario" onClick={() => setAnulando(i)}>
                  Anular
                </button>
              )}
            </>
          ),
        }))}
      />
      <DialogoMotivo
        abierto={anulando !== null}
        titulo="Anular ingreso"
        textoBoton="Anular"
        alCerrar={() => setAnulando(null)}
        alConfirmar={(motivo) => {
          const i = anulando!;
          setAnulando(null);
          void ejecutar(() => api(`/irp/${contribuyenteId}/ingresos/${i.id}/anular`, { cuerpo: { motivo } }));
        }}
      />
      {dialogo}
    </div>
  );
}

function ListaSimple({
  filas,
}: {
  filas: { id: number; anulado: boolean; titulo: string; detalle: string; importe: number; estado: string; acciones: React.ReactNode }[];
}) {
  if (filas.length === 0) return <p className="text-slate-700">Todavía no hay registros en este ejercicio.</p>;
  return (
    <ul className="space-y-2">
      {filas.map((f) => (
        <li key={f.id} className={`tarjeta flex flex-wrap items-center gap-3 ${f.anulado ? "opacity-60" : ""}`}>
          <div className="mr-auto min-w-0">
            <p className={`font-medium ${f.anulado ? "line-through" : ""}`}>{f.titulo}</p>
            {f.detalle && <p className="text-sm text-slate-700">{f.detalle}</p>}
          </div>
          <p className="font-semibold">{gs(f.importe)}</p>
          <Insignia tono={f.estado === "CONFIRMADO" ? "verde" : f.estado === "PENDIENTE" ? "ambar" : "gris"}>
            {f.estado === "CONFIRMADO" ? "Confirmado" : f.estado === "PENDIENTE" ? "Pendiente" : "Anulado"}
          </Insignia>
          <div className="flex gap-2">{f.acciones}</div>
        </li>
      ))}
    </ul>
  );
}

function Egresos({ contribuyenteId, ejercicio, alCambiar }: { contribuyenteId: number; ejercicio: number; alCambiar: () => void }) {
  const [lista, setLista] = useState<Egreso[]>([]);
  const [seleccion, setSeleccion] = useState<Set<number>>(new Set());
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [parcial, setParcial] = useState(false);
  const [porcentaje, setPorcentaje] = useState("50");
  const { conMotivo, dialogo } = useMotivoPostCierre();

  const cargar = useCallback(async () => setLista(await api<Egreso[]>(`/irp/${contribuyenteId}/${ejercicio}/egresos`)), [contribuyenteId, ejercicio]);
  useEffect(() => {
    void cargar().catch((e: Error) => setMensaje(e.message));
  }, [cargar]);

  async function aplicar(cuerpo: Record<string, unknown>) {
    try {
      const r = await conMotivo((motivo) =>
        api<{ aplicados: number[]; excluidos: { id: number; motivo: string }[] }>(`/irp/${contribuyenteId}/egresos/tratamiento`, { cuerpo: { ids: [...seleccion], ...cuerpo, motivo } }),
      );
      if (r) setMensaje(`Aplicado a ${r.aplicados.length}${r.excluidos.length ? `; sin cambios: ${r.excluidos.length} (${r.excluidos[0]!.motivo})` : ""}`);
      setSeleccion(new Set());
      await cargar();
      alCambiar();
    } catch (err) {
      setMensaje(err instanceof Error ? err.message : "No se pudo aplicar");
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-slate-700">
        Comprobantes del ejercicio imputados al IRP-RSP (físicos, electrónicos y virtuales). El tratamiento sugerido sale del último
        comprobante confirmado del mismo proveedor; solo cuenta como confirmado cuando el comprobante está aprobado y el tratamiento
        confirmado.
      </p>
      {mensaje && <p role="status" className="font-medium">{mensaje}</p>}
      {seleccion.size > 0 && (
        <div className="tarjeta flex flex-wrap items-center gap-2">
          <span className="mr-auto font-semibold">{seleccion.size} seleccionados</span>
          <button type="button" className="boton-primario" onClick={() => void aplicar({ usarSugerencia: true })}>
            Aceptar sugerencias
          </button>
          <button type="button" className="boton-secundario" onClick={() => void aplicar({ tratamiento: "DEDUCIBLE" })}>
            Deducible
          </button>
          <button type="button" className="boton-secundario" onClick={() => setParcial(true)}>
            Parcial…
          </button>
          <button type="button" className="boton-secundario" onClick={() => void aplicar({ tratamiento: "NO_DEDUCIBLE" })}>
            No deducible
          </button>
          <button type="button" className="boton-secundario" onClick={() => void aplicar({ tratamiento: "REQUIERE_DOCUMENTACION" })}>
            Requiere documentación
          </button>
        </div>
      )}
      {lista.length === 0 ? (
        <p className="text-slate-700">No hay comprobantes imputados al IRP-RSP en este ejercicio.</p>
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
                    checked={seleccion.size === lista.length}
                    onChange={(e) => setSeleccion(e.target.checked ? new Set(lista.map((x) => x.id)) : new Set())}
                  />
                </th>
                <th className="p-2">Fecha</th>
                <th className="p-2">Comprobante</th>
                <th className="p-2 text-right">Imputado</th>
                <th className="p-2">Tratamiento</th>
                <th className="p-2 text-right">Admitido</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((e) => (
                <tr key={e.id} className="border-t border-slate-200">
                  <td className="p-2">
                    <input
                      type="checkbox"
                      className="size-5"
                      aria-label={`Seleccionar ${e.numero ?? e.id}`}
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
                  <td className="p-2 whitespace-nowrap">{fecha(e.fechaEmision)}</td>
                  <td className="p-2">
                    <Link to={`/comprobantes/${e.id}`} className="text-blue-800 underline">
                      {e.proveedor ?? "Comprobante"} {e.numero}
                    </Link>
                    {e.estadoFlujo !== "APROBADO" && <span className="block text-amber-900">Comprobante sin aprobar</span>}
                  </td>
                  <td className="p-2 text-right">{gs(e.imputado)}</td>
                  <td className="p-2">
                    {e.confirmado && e.tratamiento ? (
                      <Insignia tono={e.tratamiento === "NO_DEDUCIBLE" ? "gris" : e.tratamiento === "DEDUCIBLE" || e.tratamiento === "PARCIAL" ? "verde" : "ambar"}>
                        {ETIQUETA_TRATAMIENTO[e.tratamiento]}
                        {e.tratamiento === "PARCIAL" && ` ${e.porcentajeAdmitido} %`}
                      </Insignia>
                    ) : (
                      <span className="text-slate-700">
                        Sugerido: {ETIQUETA_TRATAMIENTO[e.sugerencia.tratamiento]}
                        {e.sugerencia.porcentajeAdmitido !== null && ` ${e.sugerencia.porcentajeAdmitido} %`}
                      </span>
                    )}
                    {e.categoria === "EXCLUIDO" && <span className="block text-red-800">Posible duplicado: no suma</span>}
                  </td>
                  <td className="p-2 text-right">{e.categoria === "CONFIRMADO" ? gs(e.admitido) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Dialogo abierto={parcial} titulo="Deducción parcial" alCerrar={() => setParcial(false)}>
        <Campo etiqueta="Porcentaje admitido" type="number" min={0} max={100} value={porcentaje} onChange={(e) => setPorcentaje(e.target.value)} />
        <div className="flex gap-2">
          <button
            type="button"
            className="boton-primario"
            onClick={() => {
              setParcial(false);
              void aplicar({ tratamiento: "PARCIAL", porcentajeAdmitido: Number(porcentaje) });
            }}
          >
            Aplicar
          </button>
          <button type="button" className="boton-secundario" onClick={() => setParcial(false)}>
            Cancelar
          </button>
        </div>
      </Dialogo>
      {dialogo}
    </div>
  );
}

function Creditos({ contribuyenteId, ejercicio, alCambiar }: { contribuyenteId: number; ejercicio: number; alCambiar: () => void }) {
  const [lista, setLista] = useState<Movimiento[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [anulando, setAnulando] = useState<Movimiento | null>(null);
  const [formulario, setFormulario] = useState({ fecha: `${ejercicio}-01-01`, tipo: "RETENCION" as Movimiento["tipo"], importe: "", agente: "", numeroComprobante: "" });
  const { conMotivo, dialogo } = useMotivoPostCierre();

  const cargar = useCallback(async () => setLista(await api<Movimiento[]>(`/irp/${contribuyenteId}/${ejercicio}/movimientos`)), [contribuyenteId, ejercicio]);
  useEffect(() => {
    void cargar().catch((e: Error) => setError(e.message));
  }, [cargar]);

  async function ejecutar(accion: (motivo?: string) => Promise<unknown>) {
    setError(null);
    try {
      await conMotivo(accion);
      await cargar();
      alCambiar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    }
  }

  return (
    <div className="space-y-4">
      <form
        className="tarjeta grid gap-3 md:grid-cols-3"
        onSubmit={async (e) => {
          e.preventDefault();
          await ejecutar((motivo) =>
            api(`/irp/${contribuyenteId}/${ejercicio}/movimientos`, {
              cuerpo: {
                fecha: formulario.fecha,
                tipo: formulario.tipo,
                importe: Number(formulario.importe),
                agente: formulario.agente || undefined,
                numeroComprobante: formulario.numeroComprobante || undefined,
                motivo,
              },
            }),
          );
          setFormulario({ ...formulario, importe: "", numeroComprobante: "" });
        }}
      >
        <h2 className="font-semibold md:col-span-3">Registrar crédito o saldo</h2>
        <div>
          <label className="etiqueta" htmlFor="tipo-movimiento">
            Tipo
          </label>
          <select id="tipo-movimiento" className="campo" value={formulario.tipo} onChange={(e) => setFormulario({ ...formulario, tipo: e.target.value as Movimiento["tipo"] })}>
            {Object.entries(TIPO_MOVIMIENTO).map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <Campo etiqueta="Fecha" type="date" value={formulario.fecha} onChange={(e) => setFormulario({ ...formulario, fecha: e.target.value })} />
        <Campo etiqueta="Importe (Gs.)" inputMode="numeric" value={formulario.importe} onChange={(e) => setFormulario({ ...formulario, importe: e.target.value.replace(/[^\d]/g, "") })} />
        {(formulario.tipo === "RETENCION" || formulario.tipo === "PERCEPCION") && (
          <>
            <Campo etiqueta="Agente (quién retuvo o percibió)" value={formulario.agente} onChange={(e) => setFormulario({ ...formulario, agente: e.target.value })} />
            <Campo etiqueta="N.° de comprobante de retención" value={formulario.numeroComprobante} onChange={(e) => setFormulario({ ...formulario, numeroComprobante: e.target.value })} />
          </>
        )}
        <div className="md:col-span-3">
          <button type="submit" className="boton-primario" disabled={!formulario.importe}>
            Agregar
          </button>
        </div>
      </form>
      {error && <p role="alert" className="error-campo">⚠ {error}</p>}
      <ListaSimple
        filas={lista.map((m) => ({
          id: m.id,
          anulado: m.estado === "ANULADO",
          titulo: `${fecha(m.fecha)} · ${TIPO_MOVIMIENTO[m.tipo]}`,
          detalle: [m.agente, m.numeroComprobante && `Comprobante ${m.numeroComprobante}`, m.descripcion].filter(Boolean).join(" · "),
          importe: Number(m.importe),
          estado: m.estado,
          acciones: (
            <>
              {m.estado === "PENDIENTE" && (
                <button type="button" className="boton-secundario" onClick={() => void ejecutar(() => api(`/irp/${contribuyenteId}/movimientos/${m.id}/confirmar`, { cuerpo: {} }))}>
                  Confirmar
                </button>
              )}
              {m.estado !== "ANULADO" && (
                <button type="button" className="boton-secundario" onClick={() => setAnulando(m)}>
                  Anular
                </button>
              )}
            </>
          ),
        }))}
      />
      <DialogoMotivo
        abierto={anulando !== null}
        titulo="Anular registro"
        textoBoton="Anular"
        alCerrar={() => setAnulando(null)}
        alConfirmar={(motivo) => {
          const m = anulando!;
          setAnulando(null);
          void ejecutar(() => api(`/irp/${contribuyenteId}/movimientos/${m.id}/anular`, { cuerpo: { motivo } }));
        }}
      />
      {dialogo}
    </div>
  );
}

function Cierres({ datos, contribuyenteId, ejercicio, alCambiar }: { datos: { cierres: Cierre[] }; contribuyenteId: number; ejercicio: number; alCambiar: () => void }) {
  const [reabriendo, setReabriendo] = useState<Cierre | null>(null);
  const [error, setError] = useState<string | null>(null);
  const anualVigente = datos.cierres.some((c) => c.mes === null && c.estado === "CERRADO");

  async function ejecutar(accion: () => Promise<unknown>) {
    setError(null);
    try {
      await accion();
      alCambiar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-slate-700">
        Un cierre congela una fotografía de control. Los cambios posteriores exigen un motivo y se muestran como diferencia contra lo cerrado.
        Los meses se cierran desde la tabla del Resumen.
      </p>
      {!anualVigente && (
        <button type="button" className="boton-primario" onClick={() => void ejecutar(() => api(`/irp/${contribuyenteId}/${ejercicio}/cierres`, { cuerpo: { mes: null } }))}>
          Cerrar el ejercicio {ejercicio}
        </button>
      )}
      {error && <p role="alert" className="error-campo">⚠ {error}</p>}
      {datos.cierres.length === 0 && <p className="text-slate-700">Todavía no hay cierres.</p>}
      <ul className="space-y-2">
        {datos.cierres.map((c) => (
          <li key={c.id} className="tarjeta space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="mr-auto font-semibold capitalize">{c.mes ? `${MESES[c.mes - 1]} ${ejercicio}` : `Ejercicio ${ejercicio} (anual)`}</h3>
              <Insignia tono={c.estado === "CERRADO" ? "verde" : "gris"} icono={c.estado === "CERRADO" ? "🔒" : "🔓"}>
                {c.estado === "CERRADO" ? `Cerrado el ${fechaHora(c.cerradoEn)}` : `Reabierto el ${fechaHora(c.reabiertoEn!)}`}
              </Insignia>
            </div>
            {c.motivoReapertura && <p className="text-sm">Motivo de la reapertura: {c.motivoReapertura}</p>}
            {c.estado === "CERRADO" &&
              (c.diferencias.length ? (
                <div className="text-sm">
                  <p className="font-medium text-amber-900">⚠ Cambió después del cierre:</p>
                  <ul className="list-disc pl-5">
                    {c.diferencias.map((d) => (
                      <li key={d.concepto}>
                        {CONCEPTO[d.concepto] ?? d.concepto}: {gs(d.cerrado)} → {gs(d.actual)}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-sm text-green-800">✔ Sin cambios desde el cierre</p>
              ))}
            {c.estado === "CERRADO" && (
              <button type="button" className="boton-secundario" onClick={() => setReabriendo(c)}>
                Reabrir
              </button>
            )}
          </li>
        ))}
      </ul>
      <DialogoMotivo
        abierto={reabriendo !== null}
        titulo="Reabrir cierre"
        textoBoton="Reabrir"
        alCerrar={() => setReabriendo(null)}
        alConfirmar={(motivo) => {
          const c = reabriendo!;
          setReabriendo(null);
          void ejecutar(() => api(`/irp/${contribuyenteId}/cierres/${c.id}/reabrir`, { cuerpo: { motivo } }));
        }}
      />
    </div>
  );
}

function Parametros({ tablero, alCambiar }: { tablero: Tablero; alCambiar: () => void }) {
  const [editando, setEditando] = useState(false);
  const [tramos, setTramos] = useState(tablero.parametros.tramos.map((t) => ({ hasta: t.hasta === null ? "" : String(t.hasta), tasa: String(t.tasaPuntosBasicos / 100) })));
  const [fuente, setFuente] = useState(tablero.parametros.fuente);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <p className="text-slate-700">
        Tasas por porción de renta neta imponible del ejercicio {tablero.ejercicio}. Fuente: {tablero.parametros.fuente}
        {tablero.parametros.version ? ` (versión ${tablero.parametros.version})` : ""}. Las compensaciones de ejercicios anteriores están{" "}
        {tablero.parametros.compensacionesHabilitadas ? "habilitadas" : "deshabilitadas hasta su validación profesional"}.
      </p>
      {!editando ? (
        <>
          <table className="tarjeta w-full text-left text-sm">
            <thead>
              <tr>
                <th className="py-1">Porción</th>
                <th className="py-1 text-right">Tasa</th>
              </tr>
            </thead>
            <tbody>
              {tablero.parametros.tramos.map((t, i, todos) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="py-1">
                    {i === 0 ? "Hasta" : `De ${gs((todos[i - 1]!.hasta ?? 0) + 1)} a`} {t.hasta === null ? "en adelante" : gs(t.hasta)}
                  </td>
                  <td className="py-1 text-right">{t.tasaPuntosBasicos / 100} %</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="boton-secundario" onClick={() => setEditando(true)}>
            Modificar
          </button>
        </>
      ) : (
        <form
          className="tarjeta space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api(`/irp/parametros/${tablero.ejercicio}`, {
                metodo: "PUT",
                cuerpo: {
                  tramos: tramos.map((t, i) => ({ hasta: i === tramos.length - 1 || !t.hasta ? null : Number(t.hasta), tasaPuntosBasicos: Math.round(Number(t.tasa) * 100) })),
                  compensacionesHabilitadas: tablero.parametros.compensacionesHabilitadas,
                  fuente,
                },
              });
              setEditando(false);
              alCambiar();
            } catch (err) {
              setError(err instanceof Error ? err.message : "No se pudo guardar");
            }
          }}
        >
          {tramos.map((t, i) => (
            <div key={i} className="grid grid-cols-[1fr_8rem_auto] items-end gap-2">
              <Campo
                etiqueta={i === tramos.length - 1 ? "Último tramo (sin límite)" : `Tramo ${i + 1}: hasta (Gs.)`}
                value={t.hasta}
                disabled={i === tramos.length - 1}
                inputMode="numeric"
                onChange={(e) => setTramos(tramos.map((x, j) => (j === i ? { ...x, hasta: e.target.value.replace(/\D/g, "") } : x)))}
              />
              <Campo etiqueta="Tasa %" value={t.tasa} inputMode="decimal" onChange={(e) => setTramos(tramos.map((x, j) => (j === i ? { ...x, tasa: e.target.value } : x)))} />
              <button type="button" className="boton-secundario" disabled={tramos.length === 1} onClick={() => setTramos(tramos.filter((_, j) => j !== i))}>
                Quitar
              </button>
            </div>
          ))}
          <button type="button" className="boton-secundario" onClick={() => setTramos([...tramos.slice(0, -1), { hasta: "", tasa: "0" }, tramos[tramos.length - 1]!])}>
            ＋ Agregar tramo
          </button>
          <Campo etiqueta="Fuente normativa" value={fuente} onChange={(e) => setFuente(e.target.value)} />
          {error && <p role="alert" className="error-campo">⚠ {error}</p>}
          <div className="flex gap-2">
            <button type="submit" className="boton-primario">
              Guardar
            </button>
            <button type="button" className="boton-secundario" onClick={() => setEditando(false)}>
              Cancelar
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
