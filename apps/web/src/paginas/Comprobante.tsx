import {
  ACCIONES,
  ESTADOS_EDITABLES,
  ETIQUETA_ACCION,
  TIPOS_COMPROBANTE,
  UMBRAL_CONFIANZA,
  calcularDV,
  type AccionFlujo,
  type EstadoFlujo,
} from "@comprobantepy/shared";
import { useCallback, useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api, apiFormulario, ErrorApi, type CampoOrigen, type DetalleComprobante } from "../api";
import { Campo } from "../componentes/Campo";
import { Dialogo, DialogoMotivo } from "../componentes/Dialogo";
import { EditorImputacion, type LineaEditable } from "../componentes/EditorImputacion";
import { Insignia } from "../componentes/Insignia";
import {
  ETIQUETA_ELEGIBILIDAD,
  ETIQUETA_FUENTE,
  ETIQUETA_NATURALEZA,
  ETIQUETA_TECNICO,
  etiquetaEstado,
  fechaHora,
  importe,
  tonoEstado,
} from "../formato";
import { useSesion } from "../sesion";

type Valores = Record<string, string>;

interface DefinicionCampo {
  clave: string;
  etiqueta: string;
  tipo: "texto" | "entero" | "fecha" | "importe" | "seleccion";
  opciones?: [string, string][];
  ayuda?: string;
  visible?: (v: Valores) => boolean;
}

const esEgreso = (v: Valores) => Number(v.tipoComprobante) >= 200;
const tieneAsociado = (v: Valores) => ["110", "111", "201"].includes(v.tipoComprobante ?? "");

const CAMPOS: { titulo: string; campos: DefinicionCampo[] }[] = [
  {
    titulo: "Comprobante",
    campos: [
      {
        clave: "naturaleza",
        etiqueta: "Naturaleza fiscal",
        tipo: "seleccion",
        opciones: [
          ["NO_DETERMINADA", "Sin determinar"],
          ["FISICO", "Físico (papel con timbrado)"],
          ["ELECTRONICO", "Electrónico (SIFEN)"],
          ["VIRTUAL", "Virtual"],
        ],
      },
      {
        clave: "tipoComprobante",
        etiqueta: "Tipo de comprobante",
        tipo: "seleccion",
        opciones: [["", "Elegí…"], ...TIPOS_COMPROBANTE.map((t) => [String(t.codigo), `${t.codigo} – ${t.descripcion}`] as [string, string])],
      },
      { clave: "timbrado", etiqueta: "Timbrado", tipo: "entero" },
      { clave: "numero", etiqueta: "Número", tipo: "texto", ayuda: "Formato 001-001-0000123" },
      { clave: "fechaEmision", etiqueta: "Fecha de emisión", tipo: "fecha" },
      {
        clave: "condicion",
        etiqueta: "Condición",
        tipo: "seleccion",
        opciones: [
          ["", "Sin indicar"],
          ["1", "Contado"],
          ["2", "Crédito"],
        ],
      },
      { clave: "moneda", etiqueta: "Moneda", tipo: "texto", ayuda: "PYG, USD…" },
      { clave: "tipoCambio", etiqueta: "Tipo de cambio", tipo: "texto", visible: (v) => v.moneda !== "PYG" },
    ],
  },
  {
    titulo: "Importes",
    campos: [
      { clave: "gravado10", etiqueta: "Gravado 10 % (IVA incluido)", tipo: "importe" },
      { clave: "gravado5", etiqueta: "Gravado 5 % (IVA incluido)", tipo: "importe" },
      { clave: "exento", etiqueta: "Exento o no gravado", tipo: "importe" },
      { clave: "total", etiqueta: "Total", tipo: "importe" },
      { clave: "iva10", etiqueta: "IVA 10 %", tipo: "importe" },
      { clave: "iva5", etiqueta: "IVA 5 %", tipo: "importe" },
    ],
  },
  {
    titulo: "Comprobante asociado",
    campos: [
      { clave: "asociadoNumero", etiqueta: "Número asociado", tipo: "texto", visible: tieneAsociado },
      { clave: "asociadoTimbrado", etiqueta: "Timbrado asociado", tipo: "entero", visible: tieneAsociado },
      { clave: "asociadoCdc", etiqueta: "CDC asociado", tipo: "texto", visible: tieneAsociado },
    ],
  },
  {
    titulo: "Datos del egreso",
    campos: [
      { clave: "numeroCuenta", etiqueta: "Número de cuenta o tarjeta", tipo: "texto", ayuda: "Se guarda cifrado; dejalo vacío para no cambiarlo", visible: (v) => ["207", "211"].includes(v.tipoComprobante ?? "") },
      { clave: "entidadFinanciera", etiqueta: "Banco, financiera o cooperativa", tipo: "texto", visible: (v) => ["207", "211"].includes(v.tipoComprobante ?? "") },
      { clave: "numeroPatronalIps", etiqueta: "Número patronal IPS", tipo: "texto", visible: (v) => v.tipoComprobante === "206" },
      { clave: "especificarTipoDocumento", etiqueta: "Tipo de documento", tipo: "texto", visible: (v) => v.tipoComprobante === "209" },
    ],
  },
  {
    titulo: "Receptor (a quién está emitido)",
    campos: [
      {
        clave: "receptorTipoIdentificacion",
        etiqueta: "Tipo de identificación",
        tipo: "seleccion",
        opciones: [
          ["", "No figura"],
          ["RUC", "RUC"],
          ["CI", "Cédula"],
          ["OTRO", "Otro"],
        ],
      },
      { clave: "receptorNumero", etiqueta: "Número", tipo: "texto" },
      { clave: "receptorDv", etiqueta: "DV", tipo: "entero", visible: (v) => v.receptorTipoIdentificacion === "RUC" },
      { clave: "receptorNombre", etiqueta: "Nombre", tipo: "texto" },
    ],
  },
];

const CAMPOS_RECEPTOR = new Set(["receptorTipoIdentificacion", "receptorNumero", "receptorDv"]);
const TODOS = CAMPOS.flatMap((s) => s.campos);

function valoresDe(d: DetalleComprobante): Valores {
  const c = d.comprobante as unknown as Record<string, unknown>;
  const v: Valores = {};
  for (const campo of TODOS) {
    const valor = campo.clave === "numeroCuenta" ? "" : c[campo.clave];
    v[campo.clave] =
      valor === null || valor === undefined ? "" : campo.tipo === "importe" ? String(Number(valor)) : String(valor);
  }
  v.observaciones = d.comprobante.observaciones ?? "";
  v.contribuyenteId = d.comprobante.contribuyenteId ? String(d.comprobante.contribuyenteId) : "";
  return v;
}

function convertir(campo: DefinicionCampo | undefined, valor: string): unknown {
  if (valor === "") return null;
  if (!campo) return valor;
  if (campo.tipo === "entero" || (campo.tipo === "seleccion" && (campo.clave === "tipoComprobante" || campo.clave === "condicion"))) {
    return Number(valor);
  }
  return valor;
}

export function Comprobante() {
  const { id } = useParams();
  const { sesion } = useSesion();
  const [d, setD] = useState<DetalleComprobante | null>(null);
  const [valores, setValores] = useState<Valores>({});
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [mensaje, setMensaje] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [accionPendiente, setAccionPendiente] = useState<AccionFlujo | null>(null);
  const [pedirMotivoReceptor, setPedirMotivoReceptor] = useState(false);
  const [lineas, setLineas] = useState<LineaEditable[]>([]);
  const [noImputado, setNoImputado] = useState(0);
  const [proveedorNuevo, setProveedorNuevo] = useState<{ tipo: string; identificacion: string; razonSocial: string } | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [pedirNuevaVersion, setPedirNuevaVersion] = useState(false);
  const [verificandoSifen, setVerificandoSifen] = useState(false);
  const navegar = useNavigate();

  const cargar = useCallback(async () => {
    try {
      const detalle = await api<DetalleComprobante>(`/comprobantes/${id}`);
      setD(detalle);
      setValores(valoresDe(detalle));
      setLineas(detalle.imputacion.lineas.map((l) => ({ obligacion: l.obligacion, actividadId: l.actividadId, porcentaje: Number(l.porcentaje) })));
      setNoImputado(Number(detalle.imputacion.porcentajeNoImputado));
      setProveedorNuevo(null);
    } catch (err) {
      setMensaje({ tipo: "error", texto: err instanceof Error ? err.message : "No se pudo cargar" });
    }
  }, [id]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // Mientras la imagen se lee en segundo plano, se actualiza sola cada 3 segundos.
  const leyendo = d?.comprobante.estadoTecnico === "PROCESANDO";
  useEffect(() => {
    if (!leyendo) return;
    const temporizador = setInterval(() => void cargar(), 3000);
    return () => clearInterval(temporizador);
  }, [leyendo, cargar]);

  if (!d) {
    return mensaje ? <p role="alert" className="error-campo">⚠ {mensaje.texto}</p> : <p role="status">Cargando…</p>;
  }

  const c = d.comprobante;
  const editable = ESTADOS_EDITABLES.includes(c.estadoFlujo as EstadoFlujo);
  const original = valoresDe(d);
  const cambiados = Object.keys(valores).filter((k) => valores[k] !== original[k]);
  const hayCambios = cambiados.length > 0 || proveedorNuevo !== null;

  async function guardar(motivo?: string) {
    if (!d) return;
    const cuerpo: Record<string, unknown> = {};
    for (const clave of cambiados) {
      if (clave === "numeroCuenta" && valores[clave] === "") continue;
      if (clave === "contribuyenteId") {
        cuerpo.contribuyenteId = valores.contribuyenteId ? Number(valores.contribuyenteId) : null;
        continue;
      }
      cuerpo[clave] = convertir(TODOS.find((f) => f.clave === clave), valores[clave] ?? "");
    }
    if (proveedorNuevo) {
      cuerpo.proveedor = {
        tipoIdentificacion: Number(proveedorNuevo.tipo),
        identificacion: proveedorNuevo.identificacion,
        razonSocial: proveedorNuevo.razonSocial || undefined,
      };
    }
    const tocaReceptor = cambiados.some((k) => CAMPOS_RECEPTOR.has(k));
    if (tocaReceptor && d.comprobante.receptorNumero && !motivo) {
      setPedirMotivoReceptor(true);
      return;
    }
    if (motivo) cuerpo.motivo = motivo;
    setGuardando(true);
    try {
      await api(`/comprobantes/${d.comprobante.id}`, { metodo: "PATCH", cuerpo });
      setErrores({});
      setMensaje({ tipo: "ok", texto: "Cambios guardados" });
      await cargar();
    } catch (err) {
      if (err instanceof ErrorApi && err.detalles) setErrores(err.detalles as Record<string, string>);
      setMensaje({ tipo: "error", texto: err instanceof Error ? err.message : "No se pudo guardar" });
    } finally {
      setGuardando(false);
    }
  }

  async function guardarImputacion() {
    try {
      await api(`/comprobantes/${c.id}/imputacion`, {
        metodo: "PUT",
        cuerpo: { lineas: lineas.filter((l) => l.obligacion), porcentajeNoImputado: noImputado },
      });
      setMensaje({ tipo: "ok", texto: "Imputación guardada" });
      await cargar();
    } catch (err) {
      setMensaje({ tipo: "error", texto: err instanceof Error ? err.message : "No se pudo guardar la imputación" });
    }
  }

  async function ejecutar(accion: AccionFlujo, motivo?: string) {
    try {
      await api(`/comprobantes/${c.id}/acciones`, { cuerpo: { accion, motivo } });
      setMensaje({ tipo: "ok", texto: `${ETIQUETA_ACCION[accion]}: listo` });
      await cargar();
    } catch (err) {
      setMensaje({ tipo: "error", texto: err instanceof Error ? err.message : "No se pudo completar la acción" });
    }
  }

  async function nuevaVersion(motivo: string) {
    try {
      const r = await api<{ comprobanteId: number; version: number }>(`/comprobantes/${c.id}/nueva-version`, { cuerpo: { motivo } });
      setMensaje({ tipo: "ok", texto: `Se creó la versión ${r.version}: corregila y volvé a aprobarla para exportarla` });
      void navegar(`/comprobantes/${r.comprobanteId}`);
    } catch (err) {
      setMensaje({ tipo: "error", texto: err instanceof Error ? err.message : "No se pudo crear la nueva versión" });
    }
  }

  const historica = c.reemplazadoPorId !== null;
  const perfilesDelContribuyente = sesion?.contribuyentes.find((x) => x.id === c.contribuyenteId)?.perfiles ?? [];
  const puedeVersionar = !historica && c.estadoMarangatu === "ACEPTADO_DNIT" && perfilesDelContribuyente.includes("FINANCIERO");
  const puedeVerificarSifen =
    !historica && c.naturaleza === "ELECTRONICO" && perfilesDelContribuyente.some((p) => p === "FINANCIERO" || p === "AUXILIAR");

  const archivoPrincipal = d.archivos.find((a) => a.tipoDetectado !== "XML") ?? d.archivos[0];
  const contribuyentesActivos = sesion?.contribuyentes.filter((x) => x.estado === "ACTIVO") ?? [];
  const sugeridaDe = c.camposOrigen._imputacionSugeridaDe as number | undefined;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link to="/comprobantes" className="boton text-blue-800 underline">
          ← Bandeja
        </Link>
        <h1 className="mr-auto text-2xl font-bold">
          {d.proveedor?.razonSocial ?? "Comprobante"} {c.numero && <span className="text-slate-600">{c.numero}</span>}
        </h1>
        <p className="text-xl font-semibold">{importe(c.total, c.moneda)}</p>
      </div>

      <section aria-label="Estado" className="flex flex-wrap gap-2">
        <Insignia tono={tonoEstado(c.estadoFlujo)}>{etiquetaEstado(c.estadoFlujo)}</Insignia>
        <Insignia tono={c.naturaleza === "NO_DETERMINADA" ? "ambar" : "gris"} icono="◆">
          {ETIQUETA_NATURALEZA[c.naturaleza]}
        </Insignia>
        <Insignia tono="gris" icono="⚙">{ETIQUETA_TECNICO[c.estadoTecnico] ?? c.estadoTecnico}</Insignia>
        <Insignia tono={d.elegibilidad.estado === "ELEGIBLE" ? "verde" : "gris"} icono="⇪">
          {ETIQUETA_ELEGIBILIDAD[d.elegibilidad.estado] ?? d.elegibilidad.estado}
        </Insignia>
        <span className="text-sm text-slate-700">
          👤 {d.contribuyente?.nombre ?? "Sin contribuyente asignado"}
          {c.asignacionManual && " (elegido a mano)"}
        </span>
      </section>
      {c.motivoEstado && <p className="text-sm">Motivo del estado: {c.motivoEstado}</p>}
      {historica && (
        <p role="status" className="tarjeta border-amber-300 bg-amber-50 text-amber-950">
          🕘 Esta es la versión {c.version}, ya reemplazada. Se conserva solo como historial.{" "}
          <Link className="font-medium underline" to={`/comprobantes/${c.reemplazadoPorId}`}>
            Ver la versión vigente
          </Link>
        </p>
      )}
      {!historica && c.versionAnteriorId !== null && (
        <p className="text-sm text-slate-700">
          Versión {c.version} de este comprobante.{" "}
          <Link className="text-blue-800 underline" to={`/comprobantes/${c.versionAnteriorId}`}>
            Ver la versión anterior
          </Link>
        </p>
      )}
      {c.estadoMarangatu && (
        <p className="text-sm text-slate-700">
          Marangatu: {ETIQUETA_MARANGATU[c.estadoMarangatu]}
          {c.estadoMarangatu === "ACEPTADO_DNIT" && !historica && " — para corregirlo, creá una nueva versión."}
        </p>
      )}

      {leyendo && (
        <p role="status" className="tarjeta border-blue-300 bg-blue-50 font-medium text-blue-900">
          ⏳ Leyendo la imagen automáticamente… los datos aparecen en unos segundos.
        </p>
      )}
      {mensaje && (
        <p role={mensaje.tipo === "error" ? "alert" : "status"} className={mensaje.tipo === "error" ? "error-campo" : "font-medium text-green-800"}>
          {mensaje.tipo === "error" ? "⚠" : "✔"} {mensaje.texto}
        </p>
      )}

      {(d.acciones.length > 0 || puedeVersionar || puedeVerificarSifen) && (
        <div className="flex flex-wrap gap-2">
          {puedeVersionar && (
            <button type="button" className="boton-secundario" onClick={() => setPedirNuevaVersion(true)}>
              Nueva versión (corregir)
            </button>
          )}
          {puedeVerificarSifen && (
            <button type="button" className="boton-secundario" onClick={() => setVerificandoSifen(true)}>
              Verificación en SIFEN
            </button>
          )}
          {d.acciones.map((a) => {
            const accion = a as AccionFlujo;
            const clase = accion === "ANULAR" || accion === "RECHAZAR" ? "boton-peligro" : accion === "CONFIRMAR" || accion === "APROBAR" ? "boton-primario" : "boton-secundario";
            return (
              <button
                key={accion}
                type="button"
                className={clase}
                disabled={hayCambios}
                title={hayCambios ? "Guardá los cambios antes" : undefined}
                onClick={() => (ACCIONES[accion].requiereMotivo ? setAccionPendiente(accion) : void ejecutar(accion))}
              >
                {ETIQUETA_ACCION[accion]}
              </button>
            );
          })}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <section aria-label="Documento original" className="space-y-2 lg:sticky lg:top-20 lg:self-start">
          {archivoPrincipal ? (
            archivoPrincipal.tipoDetectado === "IMAGEN" ? (
              <img src={`/api/archivos/${archivoPrincipal.id}`} alt="Comprobante original" className="w-full rounded-xl border border-slate-200 bg-white" />
            ) : (
              <iframe
                title="Documento original"
                src={`/api/archivos/${archivoPrincipal.id}`}
                className="h-[70vh] w-full rounded-xl border border-slate-200 bg-white"
              />
            )
          ) : (
            <p className="tarjeta text-slate-700">Carga manual: no hay archivo adjunto.</p>
          )}
          {d.archivos.length > 0 && (
            <ul className="space-y-1 text-sm">
              {d.archivos.map((a) => (
                <li key={a.id}>
                  📄{" "}
                  <a href={`/api/archivos/${a.id}?descargar=1`} className="text-blue-800 underline">
                    {a.nombreOriginal}
                  </a>{" "}
                  <span className="text-slate-600">
                    ({a.tipoDetectado}, {Math.ceil(a.tamano / 1024)} KB)
                  </span>
                </li>
              ))}
            </ul>
          )}
          {editable && !leyendo && d.archivos.some((a) => a.tipoDetectado !== "XML") && (
            <button
              type="button"
              className="boton-secundario"
              onClick={async () => {
                try {
                  await api(`/comprobantes/${c.id}/releer`, { cuerpo: {} });
                  await cargar();
                } catch (err) {
                  setMensaje({ tipo: "error", texto: err instanceof Error ? err.message : "No se pudo volver a leer" });
                }
              }}
            >
              ↻ Volver a leer la imagen
            </button>
          )}
          {d.correos.length > 0 && (
            <ul className="space-y-1 text-sm">
              {d.correos.map((m) => (
                <li key={m.id}>
                  ✉ Recibido por correo de {m.remitenteOriginal ?? "—"}
                  {m.reenviadoPor && `, reenviado por ${m.reenviadoPor}`}
                  {m.fecha && ` el ${fechaHora(m.fecha)}`}
                  {m.asunto && <span className="text-slate-600"> · “{m.asunto}”</span>}
                </li>
              ))}
            </ul>
          )}
          {c.advertenciasExtraccion.length > 0 && (
            <ul className="space-y-1 text-sm text-slate-700">
              {c.advertenciasExtraccion.map((a) => (
                <li key={a}>ℹ {a}</li>
              ))}
            </ul>
          )}
        </section>

        <div className="space-y-4">
          {d.problemas.length > 0 && (
            <section className="tarjeta space-y-2" aria-labelledby="titulo-problemas">
              <h2 id="titulo-problemas" className="font-semibold">
                Para revisar
              </h2>
              <ul className="space-y-1">
                {d.problemas.map((p, i) => (
                  <li key={i} className={p.severidad === "ERROR" ? "text-red-800" : p.severidad === "FALTA_DATO" ? "text-amber-900" : "text-slate-700"}>
                    {p.severidad === "ERROR" ? "✖ Error: " : p.severidad === "FALTA_DATO" ? "✎ Falta: " : "! Aviso: "}
                    {p.mensaje}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {d.posiblesDuplicados.length > 0 && (
            <section className="tarjeta border-red-300 bg-red-50">
              <h2 className="font-semibold text-red-900">Posibles duplicados</h2>
              <ul>
                {d.posiblesDuplicados.map((p) => (
                  <li key={p.id}>
                    <Link to={`/comprobantes/${p.id}`} className="text-blue-800 underline">
                      Comprobante {p.numero ?? `#${p.id}`}
                    </Link>{" "}
                    ({etiquetaEstado(p.estadoFlujo)})
                  </li>
                ))}
              </ul>
              <p className="text-sm">Si es el mismo comprobante, anulá uno; si son distintos, elegí “No es duplicado”.</p>
            </section>
          )}

          <section className="tarjeta space-y-3" aria-labelledby="titulo-proveedor">
            <h2 id="titulo-proveedor" className="font-semibold">
              Proveedor
            </h2>
            {d.proveedor ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="mr-auto">
                  {d.proveedor.razonSocial} · RUC {d.proveedor.numeroIdentificacion}
                  {d.proveedor.dv !== null && `-${d.proveedor.dv}`}
                </span>
                <Insignia tono={d.proveedor.estado === "CONFIRMADO" ? "verde" : d.proveedor.estado === "PENDIENTE_DE_CONFIRMAR" ? "ambar" : "rojo"}>
                  {d.proveedor.estado === "PENDIENTE_DE_CONFIRMAR" ? "A confirmar" : d.proveedor.estado.toLowerCase()}
                </Insignia>
                <Link to={`/proveedores?id=${d.proveedor.id}`} className="text-blue-800 underline">
                  Ver proveedor
                </Link>
              </div>
            ) : (
              <p className="text-amber-900">Sin proveedor identificado.</p>
            )}
            {d.timbrado && (
              <p className="text-sm">
                Timbrado {d.timbrado.numero}:{" "}
                <strong>
                  {d.timbrado.estado === "VALIDO" ? "verificado válido" : d.timbrado.estado === "RECHAZADO" ? "rechazado" : "sin verificar"}
                </strong>
                {d.timbrado.estado !== "VALIDO" && " — registrá la verificación desde la ficha del proveedor"}
              </p>
            )}
            {editable &&
              (proveedorNuevo ? (
                <div className="grid gap-2 md:grid-cols-3">
                  <div>
                    <label className="etiqueta text-sm" htmlFor="prov-tipo">
                      Identificación
                    </label>
                    <select id="prov-tipo" className="campo" value={proveedorNuevo.tipo} onChange={(e) => setProveedorNuevo({ ...proveedorNuevo, tipo: e.target.value })}>
                      <option value="11">RUC</option>
                      <option value="12">Cédula</option>
                      <option value="17">Exterior</option>
                    </select>
                  </div>
                  <div>
                    <label className="etiqueta text-sm" htmlFor="prov-num">
                      {proveedorNuevo.tipo === "11" ? "RUC con DV" : "Número"}
                    </label>
                    <input
                      id="prov-num"
                      className="campo"
                      placeholder={proveedorNuevo.tipo === "11" ? "80012345-6" : ""}
                      value={proveedorNuevo.identificacion}
                      onChange={(e) => setProveedorNuevo({ ...proveedorNuevo, identificacion: e.target.value })}
                    />
                    {proveedorNuevo.tipo === "11" && /^\d+$/.test(proveedorNuevo.identificacion) && (
                      <p className="mt-1 text-sm text-slate-600">
                        DV calculado: {proveedorNuevo.identificacion}-{calcularDV(proveedorNuevo.identificacion)}
                      </p>
                    )}
                    {errores.proveedor && <p className="error-campo">⚠ {errores.proveedor}</p>}
                  </div>
                  <div>
                    <label className="etiqueta text-sm" htmlFor="prov-nombre">
                      Razón social (si es nuevo)
                    </label>
                    <input
                      id="prov-nombre"
                      className="campo"
                      value={proveedorNuevo.razonSocial}
                      onChange={(e) => setProveedorNuevo({ ...proveedorNuevo, razonSocial: e.target.value })}
                    />
                  </div>
                </div>
              ) : (
                <button type="button" className="boton-secundario" onClick={() => setProveedorNuevo({ tipo: "11", identificacion: "", razonSocial: "" })}>
                  {d.proveedor ? "Cambiar proveedor" : "Indicar proveedor"}
                </button>
              ))}
          </section>

          {!c.receptorNumero && editable && (
            <section className="tarjeta">
              <label className="etiqueta" htmlFor="contribuyente-manual">
                Contribuyente (el documento no indica el receptor)
              </label>
              <select
                id="contribuyente-manual"
                className="campo"
                value={valores.contribuyenteId ?? ""}
                onChange={(e) => setValores({ ...valores, contribuyenteId: e.target.value })}
              >
                <option value="">Sin asignar</option>
                {contribuyentesActivos.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.nombre}
                  </option>
                ))}
              </select>
            </section>
          )}

          {CAMPOS.map((seccion) => {
            const visibles = seccion.campos.filter((campo) => !campo.visible || campo.visible(valores));
            if (visibles.length === 0) return null;
            return (
              <fieldset key={seccion.titulo} className="tarjeta" disabled={!editable}>
                <legend className="px-1 font-semibold">{seccion.titulo}</legend>
                <div className="grid gap-3 md:grid-cols-2">
                  {visibles.map((campo) => (
                    <CampoConOrigen
                      key={campo.clave}
                      campo={campo}
                      valor={valores[campo.clave] ?? ""}
                      origen={c.camposOrigen[campo.clave] as CampoOrigen | undefined}
                      error={errores[campo.clave] ?? d.problemas.find((p) => p.campo === campo.clave && p.severidad !== "ADVERTENCIA")?.mensaje}
                      alCambiar={(valor) => setValores({ ...valores, [campo.clave]: valor })}
                      extra={campo.clave === "numeroCuenta" && c.numeroCuentaMascara ? `Actual: ${c.numeroCuentaMascara}` : undefined}
                    />
                  ))}
                </div>
              </fieldset>
            );
          })}

          <fieldset className="tarjeta" disabled={!editable}>
            <legend className="px-1 font-semibold">Observaciones</legend>
            <label className="sr-only" htmlFor="observaciones">
              Observaciones
            </label>
            <textarea
              id="observaciones"
              className="campo min-h-20 py-2"
              value={valores.observaciones ?? ""}
              onChange={(e) => setValores({ ...valores, observaciones: e.target.value })}
            />
          </fieldset>

          {editable && (
            <div className="sticky bottom-16 z-10 flex gap-2 rounded-xl bg-white/95 p-2 shadow md:bottom-2">
              <button type="button" className="boton-primario" disabled={!hayCambios || guardando} onClick={() => void guardar()}>
                {guardando ? "Guardando…" : "Guardar cambios"}
              </button>
              <button
                type="button"
                className="boton-secundario"
                disabled={!hayCambios}
                onClick={() => {
                  setValores(original);
                  setProveedorNuevo(null);
                  setErrores({});
                }}
              >
                Descartar
              </button>
            </div>
          )}

          <section className="tarjeta space-y-3" aria-labelledby="titulo-imputacion">
            <h2 id="titulo-imputacion" className="font-semibold">
              Obligaciones y actividades
            </h2>
            {sugeridaDe && (
              <p className="text-sm text-slate-700">
                ℹ Sugerida a partir del{" "}
                <Link to={`/comprobantes/${sugeridaDe}`} className="text-blue-800 underline">
                  comprobante anterior del mismo proveedor
                </Link>
                . Revisala antes de confirmar.
              </p>
            )}
            <EditorImputacion
              lineas={lineas}
              porcentajeNoImputado={noImputado}
              obligaciones={d.obligacionesActivas}
              actividades={d.actividades}
              deshabilitado={!editable || !c.contribuyenteId}
              alCambiar={(l, n) => {
                setLineas(l);
                setNoImputado(n);
              }}
            />
            {editable && c.contribuyenteId && (
              <button type="button" className="boton-primario" onClick={() => void guardarImputacion()}>
                Guardar imputación
              </button>
            )}
          </section>

          <details className="tarjeta">
            <summary className="min-h-11 cursor-pointer font-semibold">Historial ({d.historial.length})</summary>
            <ol className="mt-2 space-y-2">
              {d.historial.map((h) => (
                <li key={h.id} className="border-l-2 border-slate-300 pl-3 text-sm">
                  <strong>{h.accion.replaceAll("_", " ").toLowerCase()}</strong> · {fechaHora(h.ocurridoEn)} · {h.usuario ?? "sistema"}
                  {h.motivo && <div>Motivo: {h.motivo}</div>}
                </li>
              ))}
            </ol>
          </details>
        </div>
      </div>

      <DialogoMotivo
        abierto={accionPendiente !== null}
        titulo={accionPendiente ? ETIQUETA_ACCION[accionPendiente] : ""}
        textoBoton={accionPendiente ? ETIQUETA_ACCION[accionPendiente] : ""}
        alCerrar={() => setAccionPendiente(null)}
        alConfirmar={(motivo) => {
          const accion = accionPendiente!;
          setAccionPendiente(null);
          void ejecutar(accion, motivo);
        }}
      />
      <DialogoMotivo
        abierto={pedirNuevaVersion}
        titulo="Corregir un comprobante aceptado por la DNIT"
        textoBoton="Crear nueva versión"
        alCerrar={() => setPedirNuevaVersion(false)}
        alConfirmar={(motivo) => {
          setPedirNuevaVersion(false);
          void nuevaVersion(motivo);
        }}
      />
      {verificandoSifen && (
        <VerificacionSifen
          comprobanteId={c.id}
          alCerrar={() => setVerificandoSifen(false)}
          alGuardar={async () => {
            setVerificandoSifen(false);
            setMensaje({ tipo: "ok", texto: "Verificación registrada" });
            await cargar();
          }}
        />
      )}
      <DialogoMotivo
        abierto={pedirMotivoReceptor}
        titulo="Corregir el receptor leído del documento"
        textoBoton="Guardar corrección"
        alCerrar={() => setPedirMotivoReceptor(false)}
        alConfirmar={(motivo) => {
          setPedirMotivoReceptor(false);
          void guardar(motivo);
        }}
      />
    </div>
  );
}

const ETIQUETA_MARANGATU: Record<string, string> = {
  INCLUIDO_EN_LOTE: "incluido en un lote",
  ENVIADO: "enviado, esperando el resultado",
  ACEPTADO_DNIT: "aceptado por la DNIT",
  RECHAZADO_DNIT: "rechazado por la DNIT",
};

/** Registro manual de la consulta del documento electrónico en e-Kuatia (sección 11.5). */
function VerificacionSifen({ comprobanteId, alCerrar, alGuardar }: { comprobanteId: number; alCerrar: () => void; alGuardar: () => Promise<void> }) {
  const ahora = new Date();
  const local = new Date(ahora.getTime() - ahora.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const [datos, setDatos] = useState({ resultado: "VALIDADO_SIFEN", consultaEn: local, observacion: "" });
  const [evidencia, setEvidencia] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const idEvidencia = useId();

  async function enviar(e: FormEvent) {
    e.preventDefault();
    try {
      let evidenciaArchivoId: number | null = null;
      if (evidencia) {
        const formulario = new FormData();
        formulario.set("archivo", evidencia, evidencia.name);
        evidenciaArchivoId = (await apiFormulario<{ id: number }>("/archivos/evidencia", formulario)).id;
      }
      await api(`/comprobantes/${comprobanteId}/verificacion-sifen`, {
        cuerpo: {
          resultado: datos.resultado,
          consultaEn: new Date(datos.consultaEn).toISOString(),
          observacion: datos.observacion || undefined,
          evidenciaArchivoId,
        },
      });
      await alGuardar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar");
    }
  }

  return (
    <Dialogo abierto titulo="Verificación en SIFEN" alCerrar={alCerrar}>
      <form onSubmit={enviar} className="space-y-3">
        <p className="text-sm text-slate-700">
          Consultá el CDC en e-Kuatia (consulta pública de documentos electrónicos) y registrá lo que encontraste.
        </p>
        <fieldset>
          <legend className="etiqueta">Resultado</legend>
          {[
            ["VALIDADO_SIFEN", "Existe y está aprobado"],
            ["RECHAZADO_SIFEN", "No existe, fue cancelado o tiene otros datos"],
          ].map(([valor, texto]) => (
            <label key={valor} className="flex min-h-11 items-center gap-2">
              <input type="radio" name="resultado" className="size-5" checked={datos.resultado === valor} onChange={() => setDatos({ ...datos, resultado: valor! })} />
              {texto}
            </label>
          ))}
        </fieldset>
        <Campo etiqueta="Fecha y hora de la consulta" type="datetime-local" value={datos.consultaEn} onChange={(e) => setDatos({ ...datos, consultaEn: e.target.value })} />
        <div>
          <label className="etiqueta" htmlFor={idEvidencia}>
            Evidencia (captura o PDF de la consulta, opcional)
          </label>
          <input id={idEvidencia} type="file" accept="image/*,application/pdf" className="campo py-2" onChange={(e) => setEvidencia(e.target.files?.[0] ?? null)} />
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

function CampoConOrigen({
  campo,
  valor,
  origen,
  error,
  alCambiar,
  extra,
}: {
  campo: DefinicionCampo;
  valor: string;
  origen: CampoOrigen | undefined;
  error?: string;
  alCambiar: (valor: string) => void;
  extra?: ReactNode;
}) {
  const id = useId();
  const dudoso = origen && origen.fuente !== "MANUAL" && origen.confianza < UMBRAL_CONFIANZA;
  const clase = `campo ${dudoso ? "border-amber-500 bg-amber-50" : ""} ${error ? "border-red-600" : ""}`;
  return (
    <div>
      <label htmlFor={id} className="etiqueta">
        {campo.etiqueta}
      </label>
      {campo.tipo === "seleccion" ? (
        <select id={id} className={clase} value={valor} onChange={(e) => alCambiar(e.target.value)}>
          {campo.opciones!.map(([v, t]) => (
            <option key={v} value={v}>
              {t}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          className={clase}
          type={campo.tipo === "fecha" ? "date" : "text"}
          inputMode={campo.tipo === "importe" ? "decimal" : campo.tipo === "entero" ? "numeric" : undefined}
          value={valor}
          onChange={(e) => alCambiar(campo.tipo === "importe" ? e.target.value.replace(/[^\d.]/g, "") : e.target.value)}
          aria-invalid={error ? true : undefined}
        />
      )}
      {origen && (
        <p className={`mt-1 text-xs ${dudoso ? "font-medium text-amber-900" : "text-slate-600"}`}>
          {dudoso ? "⚠ Revisar: " : ""}
          {origen.fuente === "MANUAL"
            ? `Corregido a mano${origen.detectado ? ` (se había leído “${origen.detectado.valor}” de ${ETIQUETA_FUENTE[origen.detectado.fuente] ?? origen.detectado.fuente})` : ""}`
            : `Leído de ${ETIQUETA_FUENTE[origen.fuente] ?? origen.fuente}${origen.confianza < 1 ? ` (confianza ${Math.round(origen.confianza * 100)} %)` : ""}`}
        </p>
      )}
      {campo.ayuda && !origen && <p className="mt-1 text-xs text-slate-600">{campo.ayuda}</p>}
      {extra && <p className="mt-1 text-xs text-slate-600">{extra}</p>}
      {error && <p className="error-campo">⚠ {error}</p>}
    </div>
  );
}
