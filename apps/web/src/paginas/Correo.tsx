import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { api, ErrorApi } from "../api";
import { Campo } from "../componentes/Campo";
import { Dialogo, DialogoMotivo } from "../componentes/Dialogo";
import { Insignia } from "../componentes/Insignia";
import { fechaHora } from "../formato";
import { useSesion } from "../sesion";

interface Buzon {
  id: number;
  direccion: string;
  rol: "CENTRAL" | "ORIGEN";
  mecanismo: "GMAIL_API" | "REENVIO";
  titular: string;
  filtro: string | null;
  estado: "PENDIENTE_CONEXION" | "ACTIVO" | "ERROR_AUTENTICACION" | "BAJA";
  ultimoSondeoEn: string | null;
  ultimoError: string | null;
  conectado: boolean;
  contribuyenteSugerido: string | null;
}

interface EstadoCorreo {
  googleConfigurado: boolean;
  urlRetorno: string;
  buzones: Buzon[];
  alertas: { id: number; tipo: string; mensaje: string; creadaEn: string }[];
  mensajesPorEstado: Record<string, number>;
}

interface Mensaje {
  id: number;
  buzon: string | null;
  remitenteOriginal: string | null;
  reenviadoPor: string | null;
  asunto: string | null;
  fecha: string | null;
  canal: string;
  estado: string;
  creadoEn: string;
  detalle: { nombre: string; resultado: string; comprobanteId: number | null; avisos: string[]; error?: string }[];
}

const ESTADO_MENSAJE: Record<string, { texto: string; tono: "verde" | "azul" | "ambar" | "rojo" | "gris" }> = {
  PROCESADO: { texto: "Procesado", tono: "verde" },
  DUPLICADO: { texto: "Ya estaba registrado", tono: "azul" },
  OBSERVADO: { texto: "Con observaciones", tono: "ambar" },
  SIN_ADJUNTOS: { texto: "Sin adjuntos válidos", tono: "ambar" },
  REMITENTE_NO_HABILITADO: { texto: "Remitente no habilitado", tono: "rojo" },
  ERROR: { texto: "Error", tono: "rojo" },
  DESCARTADO: { texto: "Descartado", tono: "gris" },
};

const PARA_REVISAR = ["REMITENTE_NO_HABILITADO", "SIN_ADJUNTOS", "ERROR", "OBSERVADO"];

/** Recepción por correo: buzón central, buzones de origen e incidencias (sección 7). */
export function Correo() {
  const { sesion, contribuyenteActivo } = useSesion();
  const nombreActivo = contribuyenteActivo === "TODOS" ? null : sesion?.contribuyentes.find((c) => c.id === contribuyenteActivo)?.nombre;
  const [parametros, setParametros] = useSearchParams();
  const [estado, setEstado] = useState<EstadoCorreo | null>(null);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [filtro, setFiltro] = useState<"REVISAR" | "PROCESADOS" | "TODOS">("REVISAR");
  const [aviso, setAviso] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [agregando, setAgregando] = useState(false);
  const [dandoDeBaja, setDandoDeBaja] = useState<Buzon | null>(null);
  const [aceptando, setAceptando] = useState<Mensaje | null>(null);
  const [descartando, setDescartando] = useState<Mensaje | null>(null);
  const puedeConfigurar = Boolean(sesion?.usuario.esAdministrador || sesion?.contribuyentes.some((c) => c.perfiles.includes("FINANCIERO")));

  const cargar = useCallback(async () => {
    const estados = filtro === "REVISAR" ? PARA_REVISAR.join(",") : filtro === "PROCESADOS" ? "PROCESADO,DUPLICADO" : "";
    const consulta = new URLSearchParams();
    if (estados) consulta.set("estado", estados);
    // Las incidencias (sin comprobante) no tienen contribuyente: se ven siempre en "Para revisar".
    if (contribuyenteActivo !== "TODOS" && filtro !== "REVISAR") consulta.set("contribuyenteId", String(contribuyenteActivo));
    const [e, m] = await Promise.all([api<EstadoCorreo>("/correo/estado"), api<Mensaje[]>(`/correo/mensajes?${consulta}`)]);
    setEstado(e);
    setMensajes(m);
  }, [filtro, contribuyenteActivo]);

  useEffect(() => {
    void cargar().catch((err: Error) => setAviso({ tipo: "error", texto: err.message }));
  }, [cargar]);

  useEffect(() => {
    const resultado = parametros.get("resultado");
    if (resultado) {
      setAviso(resultado === "conectado" ? { tipo: "ok", texto: "Buzón conectado con Google" } : { tipo: "error", texto: resultado });
      setParametros({}, { replace: true });
    }
  }, [parametros, setParametros]);

  async function ejecutar(accion: () => Promise<unknown>, textoOk: string) {
    try {
      await accion();
      setAviso({ tipo: "ok", texto: textoOk });
      await cargar();
    } catch (err) {
      setAviso({ tipo: "error", texto: err instanceof Error ? err.message : "No se pudo completar" });
    }
  }

  async function conectar(b: Buzon) {
    try {
      const { url } = await api<{ url: string }>(`/correo/buzones/${b.id}/conectar`);
      window.location.href = url;
    } catch (err) {
      setAviso({ tipo: "error", texto: err instanceof Error ? err.message : "No se pudo iniciar la conexión" });
    }
  }

  const central = estado?.buzones.find((b) => b.rol === "CENTRAL");

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Correo</h1>
      <p className="text-slate-700">
        Los comprobantes que lleguen al buzón central se registran solos. Cada titular puede reenviar automáticamente al buzón
        central los correos con comprobantes; así la aplicación nunca accede al resto de sus mensajes. El comprobante se asigna
        siempre a quien figura como receptor, sin importar por qué buzón llegó.
      </p>

      {aviso && (
        <p role={aviso.tipo === "error" ? "alert" : "status"} className={aviso.tipo === "error" ? "error-campo" : "font-medium text-green-800"}>
          {aviso.tipo === "error" ? "⚠" : "✔"} {aviso.texto}
        </p>
      )}

      {estado?.alertas.map((a) => (
        <p key={a.id} role="alert" className="tarjeta border-red-300 bg-red-50 font-medium text-red-900">
          ⚠ {a.mensaje} <span className="text-sm font-normal">({fechaHora(a.creadaEn)})</span>
        </p>
      ))}

      {estado && !estado.googleConfigurado && (
        <section className="tarjeta space-y-2 border-amber-300 bg-amber-50">
          <h2 className="font-semibold">Falta configurar el acceso a Gmail</h2>
          <p>
            Para leer el buzón central hay que crear un proyecto en Google Cloud y completar <code>GOOGLE_CLIENT_ID</code> y{" "}
            <code>GOOGLE_CLIENT_SECRET</code> en el archivo <code>.env</code>. Los pasos están en el README, en “Conectar Gmail”.
          </p>
          <p className="text-sm">
            Dirección de retorno autorizada a registrar en Google: <code className="break-all">{estado.urlRetorno}</code>
          </p>
          <p className="text-sm">Mientras tanto, podés cargar correos guardados como archivo .eml desde “Cargar”.</p>
        </section>
      )}

      <section className="space-y-3" aria-labelledby="titulo-buzones">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="titulo-buzones" className="mr-auto text-lg font-semibold">
            Buzones
          </h2>
          {puedeConfigurar && (
            <button type="button" className="boton-primario" onClick={() => setAgregando(true)}>
              ＋ Agregar buzón
            </button>
          )}
        </div>
        {estado && estado.buzones.length === 0 && (
          <p className="text-slate-700">Todavía no hay buzones. Empezá por el buzón central (vgomez.factura@gmail.com).</p>
        )}
        <ul className="grid gap-3 md:grid-cols-2">
          {estado?.buzones.map((b) => (
            <li key={b.id} className="tarjeta space-y-2">
              <div className="flex flex-wrap items-start gap-2">
                <h3 className="mr-auto font-semibold break-all">{b.direccion}</h3>
                <EstadoBuzon b={b} />
              </div>
              <p className="text-sm text-slate-700">
                {b.rol === "CENTRAL" ? "Buzón central" : b.mecanismo === "REENVIO" ? "Reenvía al buzón central" : "Conexión directa"} · {b.titular}
                {b.filtro && ` · lee solo: ${b.filtro}`}
                {b.contribuyenteSugerido && ` · si el comprobante no indica receptor: ${b.contribuyenteSugerido}`}
              </p>
              {b.mecanismo === "GMAIL_API" && (
                <p className="text-sm text-slate-700">
                  Última revisión: {b.ultimoSondeoEn ? fechaHora(b.ultimoSondeoEn) : "nunca"}
                  {b.ultimoError && <span className="block text-red-800">Último error: {b.ultimoError}</span>}
                </p>
              )}
              {b.mecanismo === "REENVIO" && (
                <p className="text-sm text-slate-600">
                  Configurá en ese correo una regla que reenvíe a {central?.direccion ?? "el buzón central"} los mensajes con comprobantes.
                </p>
              )}
              {puedeConfigurar && (
                <div className="flex flex-wrap gap-2">
                  {b.mecanismo === "GMAIL_API" && (!b.conectado || b.estado === "ERROR_AUTENTICACION") && (
                    <button type="button" className="boton-primario" disabled={!estado.googleConfigurado} onClick={() => void conectar(b)}>
                      {b.conectado ? "Volver a conectar" : "Conectar con Google"}
                    </button>
                  )}
                  {b.mecanismo === "GMAIL_API" && b.conectado && (
                    <button
                      type="button"
                      className="boton-secundario"
                      onClick={() =>
                        void ejecutar(async () => {
                          const r = await api<{ leidos: number; nuevos: number; errores: string[] }>(`/correo/buzones/${b.id}/sondear`, { cuerpo: {} });
                          if (r.errores.length) throw new Error(r.errores.join("; "));
                          setAviso({ tipo: "ok", texto: `${r.nuevos} mensajes nuevos` });
                        }, "Revisión terminada")
                      }
                    >
                      Revisar ahora
                    </button>
                  )}
                  <button type="button" className="boton-secundario" onClick={() => setDandoDeBaja(b)}>
                    Dar de baja
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3" aria-labelledby="titulo-mensajes">
        <h2 id="titulo-mensajes" className="text-lg font-semibold">
          Mensajes recibidos
        </h2>
        {nombreActivo && filtro !== "REVISAR" && (
          <p className="text-sm text-slate-700">Mostrando los correos que trajeron comprobantes de {nombreActivo}.</p>
        )}
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filtrar mensajes">
          {(
            [
              ["REVISAR", "Para revisar", PARA_REVISAR],
              ["PROCESADOS", "Procesados", ["PROCESADO", "DUPLICADO"]],
              ["TODOS", "Todos", null],
            ] as const
          ).map(([clave, texto, estados]) => (
            <button
              key={clave}
              type="button"
              role="tab"
              aria-selected={filtro === clave}
              className={`boton ${filtro === clave ? "bg-blue-700 text-white" : "border border-slate-300 bg-white"}`}
              onClick={() => setFiltro(clave)}
            >
              {texto}
              {estados && estado && (
                <span className="rounded-full bg-black/10 px-2 text-sm">{estados.reduce((s, e) => s + (estado.mensajesPorEstado[e] ?? 0), 0)}</span>
              )}
            </button>
          ))}
        </div>
        {mensajes.length === 0 && <p className="text-slate-700">No hay mensajes en esta lista.</p>}
        <ul className="space-y-3">
          {mensajes.map((m) => (
            <li key={m.id} className="tarjeta space-y-2">
              <div className="flex flex-wrap items-start gap-2">
                <div className="mr-auto min-w-0">
                  <p className="font-semibold break-words">{m.asunto ?? "(sin asunto)"}</p>
                  <p className="text-sm text-slate-700 break-all">
                    De {m.remitenteOriginal ?? "—"}
                    {m.reenviadoPor && ` · reenviado por ${m.reenviadoPor}`}
                    {m.buzon ? ` · llegó a ${m.buzon}` : " · cargado a mano (.eml)"} · {fechaHora(m.fecha ?? m.creadoEn)}
                  </p>
                </div>
                <Insignia tono={ESTADO_MENSAJE[m.estado]?.tono ?? "gris"}>{ESTADO_MENSAJE[m.estado]?.texto ?? m.estado}</Insignia>
              </div>
              {m.estado === "REMITENTE_NO_HABILITADO" && (
                <p className="text-sm text-red-900">
                  Fue reenviado desde una dirección que no está registrada. Para evitar que terceros carguen documentos, no se procesó.
                </p>
              )}
              {m.detalle.length > 0 && (
                <ul className="space-y-1 text-sm">
                  {m.detalle.map((d, i) => (
                    <li key={i}>
                      📎 {d.nombre}:{" "}
                      {d.comprobanteId ? (
                        <Link to={`/comprobantes/${d.comprobanteId}`} className="text-blue-800 underline">
                          {d.resultado === "CREADO" ? "comprobante registrado" : d.resultado === "ASOCIADO" ? "agregado a un comprobante existente" : "ya estaba registrado"}
                        </Link>
                      ) : (
                        <span>{d.error ?? d.avisos.join("; ")}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {puedeConfigurar && PARA_REVISAR.includes(m.estado) && (
                <div className="flex flex-wrap gap-2">
                  {m.estado === "REMITENTE_NO_HABILITADO" && (
                    <button type="button" className="boton-primario" onClick={() => setAceptando(m)}>
                      Aceptar y procesar
                    </button>
                  )}
                  <button type="button" className="boton-secundario" onClick={() => setDescartando(m)}>
                    Descartar
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      {agregando && (
        <FormularioBuzon
          hayCentral={Boolean(central)}
          alCerrar={() => setAgregando(false)}
          alGuardar={async () => {
            setAgregando(false);
            setAviso({ tipo: "ok", texto: "Buzón agregado" });
            await cargar();
          }}
        />
      )}
      <DialogoMotivo
        abierto={dandoDeBaja !== null}
        titulo={`Dar de baja ${dandoDeBaja?.direccion ?? ""}`}
        textoBoton="Dar de baja"
        alCerrar={() => setDandoDeBaja(null)}
        alConfirmar={(motivo) => {
          const b = dandoDeBaja!;
          setDandoDeBaja(null);
          void ejecutar(() => api(`/correo/buzones/${b.id}/baja`, { cuerpo: { motivo } }), "Buzón dado de baja; los comprobantes ya registrados se conservan");
        }}
      />
      <DialogoMotivo
        abierto={descartando !== null}
        titulo="Descartar mensaje"
        textoBoton="Descartar"
        alCerrar={() => setDescartando(null)}
        alConfirmar={(motivo) => {
          const m = descartando!;
          setDescartando(null);
          void ejecutar(() => api(`/correo/mensajes/${m.id}/descartar`, { cuerpo: { motivo } }), "Mensaje descartado");
        }}
      />
      {aceptando && (
        <Dialogo abierto titulo="Aceptar mensaje" alCerrar={() => setAceptando(null)}>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              const datos = new FormData(e.currentTarget);
              const m = aceptando;
              setAceptando(null);
              void ejecutar(
                () =>
                  api(`/correo/mensajes/${m.id}/aceptar`, {
                    cuerpo: { habilitarRemitente: datos.get("habilitar") === "on", titular: String(datos.get("titular") ?? "") || undefined },
                  }),
                "Mensaje procesado",
              );
            }}
          >
            <p>Se procesarán los comprobantes adjuntos del mensaje reenviado por {aceptando.reenviadoPor}.</p>
            <label className="flex min-h-11 items-center gap-2">
              <input type="checkbox" name="habilitar" className="size-5" defaultChecked />
              Habilitar esta dirección para próximos reenvíos
            </label>
            <Campo etiqueta="Titular de esa dirección" name="titular" placeholder="Por ejemplo: Madre" />
            <div className="flex gap-2">
              <button type="submit" className="boton-primario">
                Aceptar y procesar
              </button>
              <button type="button" className="boton-secundario" onClick={() => setAceptando(null)}>
                Cancelar
              </button>
            </div>
          </form>
        </Dialogo>
      )}
    </div>
  );
}

function EstadoBuzon({ b }: { b: Buzon }) {
  if (b.mecanismo === "REENVIO") return <Insignia tono="verde">Habilitado</Insignia>;
  if (b.estado === "ACTIVO") return <Insignia tono="verde">Conectado</Insignia>;
  if (b.estado === "ERROR_AUTENTICACION") return <Insignia tono="rojo">Hay que reconectar</Insignia>;
  return <Insignia tono="ambar">Sin conectar</Insignia>;
}

function FormularioBuzon({ hayCentral, alCerrar, alGuardar }: { hayCentral: boolean; alCerrar: () => void; alGuardar: () => Promise<void> }) {
  const { sesion } = useSesion();
  const [tipo, setTipo] = useState<"CENTRAL" | "REENVIO" | "DIRECTO">(hayCentral ? "REENVIO" : "CENTRAL");
  const [datos, setDatos] = useState({
    direccion: hayCentral ? "" : "vgomez.factura@gmail.com",
    titular: "",
    filtro: "label:Comprobantes",
    contribuyenteSugeridoId: "",
    autorizacionFecha: new Date().toISOString().slice(0, 10),
    autorizacionForma: "",
  });
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    try {
      await api("/correo/buzones", {
        cuerpo: {
          direccion: datos.direccion,
          titular: datos.titular,
          rol: tipo === "CENTRAL" ? "CENTRAL" : "ORIGEN",
          mecanismo: tipo === "REENVIO" ? "REENVIO" : "GMAIL_API",
          filtro: tipo === "DIRECTO" ? datos.filtro : null,
          contribuyenteSugeridoId: datos.contribuyenteSugeridoId ? Number(datos.contribuyenteSugeridoId) : null,
          autorizacionFecha: datos.autorizacionFecha,
          autorizacionForma: datos.autorizacionForma,
        },
      });
      await alGuardar();
    } catch (err) {
      if (err instanceof ErrorApi && err.detalles) setErrores(err.detalles as Record<string, string>);
      setError(err instanceof Error ? err.message : "No se pudo guardar");
    }
  }

  return (
    <Dialogo abierto titulo="Agregar buzón" alCerrar={alCerrar}>
      <form onSubmit={enviar} className="max-h-[70vh] space-y-3 overflow-y-auto" noValidate>
        <fieldset className="space-y-1">
          <legend className="etiqueta">Tipo</legend>
          {!hayCentral && (
            <label className="flex min-h-11 items-center gap-2">
              <input type="radio" className="size-5" checked={tipo === "CENTRAL"} onChange={() => setTipo("CENTRAL")} />
              Buzón central (Gmail)
            </label>
          )}
          <label className="flex min-h-11 items-center gap-2">
            <input type="radio" className="size-5" checked={tipo === "REENVIO"} onChange={() => setTipo("REENVIO")} />
            Correo de un titular que reenvía al central (recomendado)
          </label>
          <label className="flex min-h-11 items-center gap-2">
            <input type="radio" className="size-5" checked={tipo === "DIRECTO"} onChange={() => setTipo("DIRECTO")} />
            Conectar el Gmail de un titular (solo una etiqueta)
          </label>
        </fieldset>
        <Campo etiqueta="Dirección de correo" type="email" value={datos.direccion} onChange={(e) => setDatos({ ...datos, direccion: e.target.value })} error={errores.direccion} />
        <Campo etiqueta="Titular" placeholder="Ana, Madre, Esposo…" value={datos.titular} onChange={(e) => setDatos({ ...datos, titular: e.target.value })} error={errores.titular} />
        {tipo === "DIRECTO" && (
          <Campo
            etiqueta="Etiqueta a leer"
            value={datos.filtro}
            onChange={(e) => setDatos({ ...datos, filtro: e.target.value })}
            error={errores.filtro}
            ayuda="Solo se leen los mensajes con esta etiqueta de Gmail; nunca el buzón completo."
          />
        )}
        {tipo !== "CENTRAL" && (
          <div>
            <label className="etiqueta" htmlFor="sugerido">
              Contribuyente si el comprobante no indica receptor (opcional)
            </label>
            <select id="sugerido" className="campo" value={datos.contribuyenteSugeridoId} onChange={(e) => setDatos({ ...datos, contribuyenteSugeridoId: e.target.value })}>
              <option value="">Ninguno</option>
              {sesion?.contribuyentes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </div>
        )}
        <Campo etiqueta="Fecha de autorización del titular" type="date" value={datos.autorizacionFecha} onChange={(e) => setDatos({ ...datos, autorizacionFecha: e.target.value })} error={errores.autorizacionFecha} />
        <Campo etiqueta="Forma de la autorización" placeholder="Escrita, verbal…" value={datos.autorizacionForma} onChange={(e) => setDatos({ ...datos, autorizacionForma: e.target.value })} error={errores.autorizacionForma} />
        {error && <p role="alert" className="error-campo">⚠ {error}</p>}
        <div className="flex gap-2">
          <button type="submit" className="boton-primario">
            Guardar
          </button>
          <button type="button" className="boton-secundario" onClick={alCerrar}>
            Cancelar
          </button>
        </div>
      </form>
    </Dialogo>
  );
}
