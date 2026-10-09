import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { api, ErrorApi, type FilaBandeja } from "../api";
import { Dialogo, DialogoMotivo } from "../componentes/Dialogo";
import { EditorImputacion, type LineaEditable } from "../componentes/EditorImputacion";
import { Insignia } from "../componentes/Insignia";
import { ETIQUETA_NATURALEZA, etiquetaEstado, fecha, importe, tipoTexto, tonoEstado } from "../formato";
import { useSesion } from "../sesion";

const PESTANAS = [
  { clave: "REVISAR", texto: "Por revisar", estados: ["BORRADOR", "PENDIENTE_ASIGNACION_CONTRIBUYENTE", "PENDIENTE_DE_REVISION", "PENDIENTE_DATOS", "PENDIENTE_CONFIRMACION_PROVEEDOR", "POSIBLE_DUPLICADO"] },
  { clave: "CONFIRMADOS", texto: "Confirmados", estados: ["CONFIRMADO"] },
  { clave: "APROBADOS", texto: "Aprobados", estados: ["APROBADO"] },
  { clave: "OBSERVADOS", texto: "Observados y rechazados", estados: ["OBSERVADO", "RECHAZADO"] },
  { clave: "TODOS", texto: "Todos", estados: null },
] as const;

interface Resumen {
  titulo: string;
  aplicados: number[];
  excluidos: { id: number; motivo?: string; categoria?: string }[];
}

const CATEGORIA: Record<string, string> = {
  BLOQUEADO: "Bloqueado por errores",
  OBSERVADO: "Observado",
  POSIBLE_DUPLICADO: "Posible duplicado",
  ESTADO: "Estado no permitido",
  PERMISO: "Sin permiso",
};

/** Bandeja de trabajo: tarjetas en el celular, tabla en la computadora, selección y acciones masivas (sección 16). */
export function Comprobantes() {
  const { contribuyenteActivo } = useSesion();
  const navegar = useNavigate();
  const [parametrosUrl] = useSearchParams();
  const proveedorFiltro = parametrosUrl.get("proveedor");
  const [filas, setFilas] = useState<FilaBandeja[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pestana, setPestana] = useState<(typeof PESTANAS)[number]["clave"]>("REVISAR");
  const [buscar, setBuscar] = useState("");
  const [verAnulados, setVerAnulados] = useState(false);
  const [seleccion, setSeleccion] = useState<Set<number>>(new Set());
  const [modoSeleccion, setModoSeleccion] = useState(false);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [dialogo, setDialogo] = useState<null | "CLASIFICAR" | "MAS" | "OBSERVAR" | "ANULAR">(null);
  const [obligaciones, setObligaciones] = useState<{ codigo: string; descripcion: string }[]>([]);

  const cargar = useCallback(async () => {
    setCargando(true);
    const parametros = new URLSearchParams({ limite: "500" });
    if (contribuyenteActivo !== "TODOS") parametros.set("contribuyenteId", String(contribuyenteActivo));
    if (buscar.trim()) parametros.set("buscar", buscar.trim());
    if (verAnulados) parametros.set("incluirAnulados", "true");
    if (proveedorFiltro) parametros.set("proveedorId", proveedorFiltro);
    try {
      const r = await api<{ comprobantes: FilaBandeja[] }>(`/comprobantes?${parametros}`);
      setFilas(r.comprobantes);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar la bandeja");
    } finally {
      setCargando(false);
    }
  }, [contribuyenteActivo, buscar, verAnulados, proveedorFiltro]);

  useEffect(() => {
    const espera = setTimeout(() => void cargar(), 250);
    return () => clearTimeout(espera);
  }, [cargar]);

  useEffect(() => {
    api<{ obligaciones: { codigo: string; descripcion: string }[] }>("/catalogos").then((c) => setObligaciones(c.obligaciones), () => undefined);
  }, []);

  const estadosPestana = PESTANAS.find((p) => p.clave === pestana)!.estados as readonly string[] | null;
  const visibles = useMemo(
    () => filas.filter((f) => !estadosPestana || estadosPestana.includes(f.estadoFlujo) || (verAnulados && f.estadoFlujo === "ANULADO")),
    [filas, estadosPestana, verAnulados],
  );
  const conteo = (estados: readonly string[] | null) => filas.filter((f) => !estados || estados.includes(f.estadoFlujo)).length;

  const seleccionadas = filas.filter((f) => seleccion.has(f.id));
  const contribuyentesSeleccion = new Set(seleccionadas.map((f) => f.contribuyenteId));
  const contribuyenteUnico = contribuyentesSeleccion.size === 1 ? [...contribuyentesSeleccion][0] : undefined;
  const mezcla = seleccion.size > 0 && (contribuyentesSeleccion.size > 1 || contribuyenteUnico === null);

  const alternar = (id: number) =>
    setSeleccion((anterior) => {
      const nueva = new Set(anterior);
      if (nueva.has(id)) nueva.delete(id);
      else nueva.add(id);
      if (nueva.size === 0) setModoSeleccion(false);
      return nueva;
    });
  const todosVisiblesSeleccionados = visibles.length > 0 && visibles.every((f) => seleccion.has(f.id));

  // Pulsación prolongada en el celular inicia la selección múltiple (sección 16.3).
  const temporizador = useRef<number | undefined>(undefined);
  const presionLarga = (id: number) => ({
    onPointerDown: () => {
      temporizador.current = window.setTimeout(() => {
        setModoSeleccion(true);
        alternar(id);
        temporizador.current = undefined;
      }, 550);
    },
    onPointerUp: () => window.clearTimeout(temporizador.current),
    onPointerLeave: () => window.clearTimeout(temporizador.current),
  });

  async function accionMasiva(accion: string, motivo?: string) {
    if (contribuyenteUnico == null) return;
    try {
      const r = await api<{ aplicados: number[]; excluidos: Resumen["excluidos"] }>("/comprobantes/masivo/acciones", {
        cuerpo: { ids: [...seleccion], contribuyenteId: contribuyenteUnico, accion, motivo },
      });
      setResumen({ titulo: accion === "CONFIRMAR" ? "Confirmación" : "Resultado", ...r });
      setSeleccion(new Set());
      setModoSeleccion(false);
      await cargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo completar la acción");
    }
  }

  return (
    <div className="space-y-4 pb-24">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-bold">Comprobantes</h1>
        <Link to="/cargar" className="boton-primario">
          ＋ Cargar
        </Link>
      </div>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0" role="tablist" aria-label="Filtrar por estado">
        {PESTANAS.map((p) => (
          <button
            key={p.clave}
            type="button"
            role="tab"
            aria-selected={pestana === p.clave}
            className={`boton shrink-0 ${pestana === p.clave ? "bg-blue-700 text-white" : "border border-slate-300 bg-white text-slate-800"}`}
            onClick={() => setPestana(p.clave)}
          >
            {p.texto} <span className="rounded-full bg-black/10 px-2 text-sm">{conteo(p.estados)}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="grow md:max-w-md">
          <span className="sr-only">Buscar</span>
          <input
            className="campo"
            type="search"
            placeholder="Buscar por número, proveedor, RUC o CDC"
            value={buscar}
            onChange={(e) => setBuscar(e.target.value)}
          />
        </label>
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" className="size-5" checked={verAnulados} onChange={(e) => setVerAnulados(e.target.checked)} />
          Ver anulados
        </label>
        {visibles.length > 0 && (
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              className="size-5"
              checked={todosVisiblesSeleccionados}
              onChange={(e) => {
                setSeleccion(e.target.checked ? new Set(visibles.map((f) => f.id)) : new Set());
                setModoSeleccion(e.target.checked);
              }}
            />
            Seleccionar todos los visibles
          </label>
        )}
      </div>

      {proveedorFiltro && (
        <p className="text-sm">
          Filtrando por un proveedor ·{" "}
          <Link to="/comprobantes" className="text-blue-800 underline">
            quitar filtro
          </Link>
        </p>
      )}
      {error && (
        <p role="alert" className="error-campo">
          ⚠ {error}
        </p>
      )}
      {cargando && filas.length === 0 && <p role="status">Cargando…</p>}
      {!cargando && visibles.length === 0 && <p className="text-slate-700">No hay comprobantes en esta bandeja.</p>}

      {/* Celular y tableta: tarjetas */}
      <ul className="grid gap-3 lg:hidden">
        {visibles.map((f) => (
          <li
            key={f.id}
            {...presionLarga(f.id)}
            className={`tarjeta flex gap-3 ${seleccion.has(f.id) ? "ring-2 ring-blue-600" : ""}`}
            onClick={() => {
              if (modoSeleccion) alternar(f.id);
            }}
          >
            <input
              type="checkbox"
              className="mt-1 size-6 shrink-0"
              aria-label={`Seleccionar comprobante ${f.numero ?? f.id}`}
              checked={seleccion.has(f.id)}
              onChange={() => alternar(f.id)}
              onClick={(e) => e.stopPropagation()}
            />
            <div className="min-w-0 grow space-y-1">
              <div className="flex flex-wrap items-start gap-2">
                <p className="mr-auto font-semibold break-words">{f.proveedor?.razonSocial ?? "Proveedor sin identificar"}</p>
                <p className="font-semibold">{importe(f.total, f.moneda)}</p>
              </div>
              <p className="text-sm text-slate-700">
                {tipoTexto(f.tipoComprobante)} {f.numero ?? ""} · {fecha(f.fechaEmision)}
              </p>
              {contribuyenteActivo === "TODOS" && <p className="text-sm">👤 {f.contribuyente?.nombre ?? "Sin asignar"}</p>}
              <div className="flex flex-wrap gap-1">
                <Insignia tono={tonoEstado(f.estadoFlujo)}>{etiquetaEstado(f.estadoFlujo)}</Insignia>
                <Insignia tono={f.naturaleza === "NO_DETERMINADA" ? "ambar" : "gris"} icono="◆">
                  {ETIQUETA_NATURALEZA[f.naturaleza]}
                </Insignia>
                <ResumenProblemas fila={f} />
              </div>
              {!modoSeleccion && (
                <Link to={`/comprobantes/${f.id}`} className="boton-secundario mt-1">
                  Abrir
                </Link>
              )}
            </div>
          </li>
        ))}
      </ul>

      {/* Computadora: tabla completa */}
      {visibles.length > 0 && (
        <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white lg:block">
          <table className="w-full text-left">
            <thead className="bg-slate-100 text-sm">
              <tr>
                <th className="p-2">
                  <span className="sr-only">Seleccionar</span>
                </th>
                <th className="p-2">Fecha</th>
                <th className="p-2">Proveedor</th>
                <th className="p-2">Comprobante</th>
                <th className="p-2 text-right">Total</th>
                <th className="p-2">Naturaleza / destino</th>
                <th className="p-2">Estado</th>
                <th className="p-2">Revisar</th>
                {contribuyenteActivo === "TODOS" && <th className="p-2">Contribuyente</th>}
              </tr>
            </thead>
            <tbody>
              {visibles.map((f) => (
                <tr
                  key={f.id}
                  className={`cursor-pointer border-t border-slate-200 hover:bg-slate-50 ${seleccion.has(f.id) ? "bg-blue-50" : ""}`}
                  onClick={() => navegar(`/comprobantes/${f.id}`)}
                >
                  <td className="p-2" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="size-5"
                      aria-label={`Seleccionar comprobante ${f.numero ?? f.id}`}
                      checked={seleccion.has(f.id)}
                      onChange={() => alternar(f.id)}
                    />
                  </td>
                  <td className="p-2 whitespace-nowrap">{fecha(f.fechaEmision)}</td>
                  <td className="p-2">
                    <div className="font-medium">{f.proveedor?.razonSocial ?? "—"}</div>
                    <div className="text-sm text-slate-600">
                      {f.proveedor ? `RUC ${f.proveedor.numeroIdentificacion}${f.proveedor.dv !== null ? `-${f.proveedor.dv}` : ""}` : ""}
                    </div>
                  </td>
                  <td className="p-2">
                    <div>{tipoTexto(f.tipoComprobante)}</div>
                    <div className="text-sm text-slate-600">{f.numero ?? "sin número"}</div>
                  </td>
                  <td className="p-2 text-right whitespace-nowrap">{importe(f.total, f.moneda)}</td>
                  <td className="p-2 text-sm">
                    <div>{ETIQUETA_NATURALEZA[f.naturaleza]}</div>
                    <div className="text-slate-600">
                      {f.destino === "COMPRAS" ? "Compras" : f.destino === "EGRESOS" ? "Egresos" : f.destino ? "No exportable" : "—"}
                      {f.obligaciones.length > 0 && ` · ${f.obligaciones.join(", ")}`}
                    </div>
                  </td>
                  <td className="p-2">
                    <Insignia tono={tonoEstado(f.estadoFlujo)}>{etiquetaEstado(f.estadoFlujo)}</Insignia>
                  </td>
                  <td className="p-2">
                    <ResumenProblemas fila={f} />
                  </td>
                  {contribuyenteActivo === "TODOS" && <td className="p-2">{f.contribuyente?.nombre ?? "Sin asignar"}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {seleccion.size > 0 && (
        <div className="fixed inset-x-0 bottom-14 z-20 border-t border-slate-300 bg-white p-3 shadow-lg md:bottom-0">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2">
            <span className="mr-auto font-semibold">{seleccion.size} seleccionados</span>
            {mezcla ? (
              <span className="text-sm text-amber-900">
                ⚠ La selección mezcla contribuyentes o incluye sin asignar: elegí un contribuyente arriba.
              </span>
            ) : (
              <>
                <button type="button" className="boton-secundario" onClick={() => setDialogo("CLASIFICAR")}>
                  Clasificar
                </button>
                <button type="button" className="boton-primario" onClick={() => void accionMasiva("CONFIRMAR")}>
                  Confirmar
                </button>
                <button type="button" className="boton-secundario" onClick={() => setDialogo("MAS")}>
                  Más acciones
                </button>
              </>
            )}
            <button type="button" className="boton text-slate-700" onClick={() => { setSeleccion(new Set()); setModoSeleccion(false); }}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      <Dialogo abierto={dialogo === "MAS"} titulo="Más acciones" alCerrar={() => setDialogo(null)}>
        <div className="grid gap-2">
          <button type="button" className="boton-primario" onClick={() => { setDialogo(null); void accionMasiva("APROBAR"); }}>
            Aprobar
          </button>
          <button type="button" className="boton-secundario" onClick={() => setDialogo("OBSERVAR")}>
            Observar…
          </button>
          <button type="button" className="boton-peligro" onClick={() => setDialogo("ANULAR")}>
            Anular…
          </button>
        </div>
        <p className="text-sm text-slate-600">Solo se aplica a los comprobantes que cumplen las condiciones; el resto se informa con su motivo.</p>
      </Dialogo>
      <DialogoMotivo
        abierto={dialogo === "OBSERVAR"}
        titulo={`Observar ${seleccion.size} comprobantes`}
        textoBoton="Observar"
        alCerrar={() => setDialogo(null)}
        alConfirmar={(motivo) => { setDialogo(null); void accionMasiva("OBSERVAR", motivo); }}
      />
      <DialogoMotivo
        abierto={dialogo === "ANULAR"}
        titulo={`Anular ${seleccion.size} comprobantes`}
        textoBoton="Anular"
        alCerrar={() => setDialogo(null)}
        alConfirmar={(motivo) => { setDialogo(null); void accionMasiva("ANULAR", motivo); }}
      />
      {dialogo === "CLASIFICAR" && contribuyenteUnico != null && (
        <DialogoClasificar
          ids={[...seleccion]}
          contribuyenteId={contribuyenteUnico}
          obligaciones={obligaciones}
          alCerrar={() => setDialogo(null)}
          alTerminar={async (r) => {
            setDialogo(null);
            setResumen({ titulo: "Clasificación", ...r });
            await cargar();
          }}
        />
      )}

      <Dialogo abierto={resumen !== null} titulo={resumen?.titulo ?? ""} alCerrar={() => setResumen(null)}>
        {resumen && (
          <div className="space-y-3">
            <p className="font-medium">✔ Aplicado a {resumen.aplicados.length} comprobantes.</p>
            {resumen.excluidos.length > 0 && (
              <>
                <p className="font-medium">✖ No se aplicó a {resumen.excluidos.length}:</p>
                <ul className="max-h-72 space-y-2 overflow-y-auto">
                  {resumen.excluidos.map((e) => {
                    const fila = filas.find((f) => f.id === e.id);
                    return (
                      <li key={e.id} className="rounded-lg border border-slate-200 p-2 text-sm">
                        <Link to={`/comprobantes/${e.id}`} className="font-medium text-blue-800 underline">
                          {fila?.proveedor?.razonSocial ?? "Comprobante"} {fila?.numero ?? `#${e.id}`}
                        </Link>
                        {e.categoria && <span className="ml-2 text-slate-600">({CATEGORIA[e.categoria] ?? e.categoria})</span>}
                        <p>{e.motivo}</p>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
            <button type="button" className="boton-primario" onClick={() => setResumen(null)}>
              Entendido
            </button>
          </div>
        )}
      </Dialogo>
    </div>
  );
}

function ResumenProblemas({ fila }: { fila: FilaBandeja }) {
  const { faltanDatos, errores, advertencias } = fila.resumenProblemas;
  if (fila.estadoFlujo === "ANULADO") return null;
  if (!faltanDatos && !errores && !advertencias) return <Insignia tono="verde">Sin observaciones</Insignia>;
  return (
    <span className="flex flex-wrap gap-1">
      {faltanDatos > 0 && <Insignia tono="ambar" icono="✎">{faltanDatos} datos faltantes</Insignia>}
      {errores > 0 && <Insignia tono="rojo">{errores} errores</Insignia>}
      {advertencias > 0 && <Insignia tono="gris" icono="!">{advertencias} avisos</Insignia>}
    </span>
  );
}

function DialogoClasificar({
  ids,
  contribuyenteId,
  obligaciones,
  alCerrar,
  alTerminar,
}: {
  ids: number[];
  contribuyenteId: number;
  obligaciones: { codigo: string; descripcion: string }[];
  alCerrar: () => void;
  alTerminar: (r: { aplicados: number[]; excluidos: { id: number; motivo?: string }[] }) => Promise<void>;
}) {
  const [lineas, setLineas] = useState<LineaEditable[]>([{ obligacion: "IRP_RSP", actividadId: null, porcentaje: 100 }]);
  const [noImputado, setNoImputado] = useState(0);
  const [modo, setModo] = useState<"AGREGAR" | "REEMPLAZAR" | "COMPLETAR_VACIOS">("COMPLETAR_VACIOS");
  const [actividades, setActividades] = useState<{ id: number; descripcion: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ id: number; descripcion: string; estado: string }[]>(`/contribuyentes/${contribuyenteId}/actividades`).then(
      (a) => setActividades(a.filter((x) => x.estado === "ACTIVO")),
      () => undefined,
    );
  }, [contribuyenteId]);

  return (
    <Dialogo abierto titulo={`Clasificar ${ids.length} comprobantes`} alCerrar={alCerrar}>
      <EditorImputacion
        lineas={lineas}
        porcentajeNoImputado={noImputado}
        obligaciones={obligaciones}
        actividades={actividades}
        alCambiar={(l, n) => {
          setLineas(l);
          setNoImputado(n);
        }}
      />
      <fieldset className="space-y-1">
        <legend className="etiqueta">Cómo aplicar</legend>
        {(
          [
            ["COMPLETAR_VACIOS", "Completar solo los que no tienen clasificación"],
            ["AGREGAR", "Agregar a las asignaciones existentes"],
            ["REEMPLAZAR", "Reemplazar las asignaciones existentes"],
          ] as const
        ).map(([valor, texto]) => (
          <label key={valor} className="flex min-h-11 items-center gap-2">
            <input type="radio" name="modo" className="size-5" checked={modo === valor} onChange={() => setModo(valor)} />
            {texto}
          </label>
        ))}
        {modo === "REEMPLAZAR" && <p className="text-sm font-medium text-amber-900">⚠ Se perderá la clasificación actual de los seleccionados.</p>}
      </fieldset>
      {error && (
        <p role="alert" className="error-campo">
          ⚠ {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          className="boton-primario"
          onClick={async () => {
            try {
              const r = await api<{ aplicados: number[]; excluidos: { id: number; motivo: string }[] }>("/comprobantes/masivo/clasificar", {
                cuerpo: { ids, contribuyenteId, modo, lineas: lineas.filter((l) => l.obligacion), porcentajeNoImputado: noImputado },
              });
              await alTerminar(r);
            } catch (err) {
              setError(err instanceof ErrorApi ? err.message : "No se pudo clasificar");
            }
          }}
        >
          Aplicar
        </button>
        <button type="button" className="boton-secundario" onClick={alCerrar}>
          Cancelar
        </button>
      </div>
    </Dialogo>
  );
}
