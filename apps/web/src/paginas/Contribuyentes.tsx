import { calcularDV, esquemaContribuyente } from "@comprobantepy/shared";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, ErrorApi, type Contribuyente } from "../api";
import { Campo } from "../componentes/Campo";
import { useSesion } from "../sesion";

/** Fecha local de hoy en formato aaaa-mm-dd (toISOString usaría UTC y en Paraguay podría dar el día siguiente). */
function hoy() {
  const fecha = new Date();
  const dosDigitos = (n: number) => String(n).padStart(2, "0");
  return `${fecha.getFullYear()}-${dosDigitos(fecha.getMonth() + 1)}-${dosDigitos(fecha.getDate())}`;
}

const formularioVacio = {
  nombre: "",
  tipoIdentificacion: "RUC" as "RUC" | "CI",
  identificacion: "",
  relacion: "",
  obligacionRegistro: "" as "" | "955" | "956",
  correoContacto: "",
  autorizacionFecha: hoy(),
  autorizacionForma: "",
  autorizacionAlcance: "Registro de comprobantes, exportación a Marangatu y reportes tributarios",
};

export function Contribuyentes() {
  const { sesion, recargar } = useSesion();
  const [lista, setLista] = useState<Contribuyente[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mostrarFormulario, setMostrarFormulario] = useState(false);
  const [verBajas, setVerBajas] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setLista(await api<Contribuyente[]>("/contribuyentes"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar la lista");
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function darDeBaja(c: Contribuyente) {
    const motivo = window.prompt(`Motivo de la baja de ${c.nombre} (obligatorio):`);
    if (!motivo) return;
    try {
      await api(`/contribuyentes/${c.id}/baja`, { cuerpo: { motivo } });
      await Promise.all([cargar(), recargar()]);
    } catch (err) {
      window.alert(err instanceof ErrorApi && err.detalles?.motivo ? err.detalles.motivo : (err as Error).message);
    }
  }

  const visibles = lista.filter((c) => verBajas || c.estado === "ACTIVO");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-bold">Contribuyentes</h1>
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" className="size-5" checked={verBajas} onChange={(e) => setVerBajas(e.target.checked)} />
          Ver dados de baja
        </label>
        {sesion?.usuario.esAdministrador && !mostrarFormulario && (
          <button type="button" className="boton-primario" onClick={() => setMostrarFormulario(true)}>
            ＋ Agregar
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="error-campo">
          ⚠ {error}
        </p>
      )}

      {mostrarFormulario && (
        <FormularioContribuyente
          alCancelar={() => setMostrarFormulario(false)}
          alGuardar={async () => {
            setMostrarFormulario(false);
            await Promise.all([cargar(), recargar()]);
          }}
        />
      )}

      {visibles.length === 0 ? (
        <p className="text-slate-700">No hay contribuyentes para mostrar.</p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {visibles.map((c) => (
            <li key={c.id} className={`tarjeta space-y-1 ${c.estado === "BAJA" ? "opacity-70" : ""}`}>
              <div className="flex items-start gap-2">
                <h2 className="mr-auto text-lg font-semibold">{c.nombre}</h2>
                <span
                  className={`rounded-full px-2 py-0.5 text-sm font-medium ${c.estado === "ACTIVO" ? "bg-green-100 text-green-900" : "bg-slate-200 text-slate-800"}`}
                >
                  {c.estado === "ACTIVO" ? "✔ Activo" : "⏸ Dado de baja"}
                </span>
              </div>
              <p>
                {c.tipoIdentificacion}: {c.numeroIdentificacion}
                {c.dv !== null && `-${c.dv}`}
                {c.relacion && ` · ${c.relacion}`}
              </p>
              <p className="text-sm text-slate-700">
                Registro de comprobantes:{" "}
                {c.obligacionRegistro === "955" ? "mensual (955)" : c.obligacionRegistro === "956" ? "anual (956)" : "a confirmar"}
              </p>
              <p className="text-sm text-slate-700">
                Autorización: {c.autorizacionFecha} · {c.autorizacionForma}
              </p>
              {c.estado === "BAJA" && c.bajaMotivo && <p className="text-sm">Motivo de baja: {c.bajaMotivo}</p>}
              {c.estado === "ACTIVO" && (
                <div className="pt-2">
                  <button type="button" className="boton-secundario" onClick={() => void darDeBaja(c)}>
                    Dar de baja
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FormularioContribuyente({ alCancelar, alGuardar }: { alCancelar: () => void; alGuardar: () => Promise<void> }) {
  const [datos, setDatos] = useState(formularioVacio);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const cambiar = (campo: keyof typeof formularioVacio) => (valor: string) =>
    setDatos((anterior) => ({ ...anterior, [campo]: valor }));

  // Ayuda inmediata: muestra el DV calculado mientras se escribe el RUC.
  const numeroRuc = datos.identificacion.split("-")[0]?.replace(/[\s.]/g, "") ?? "";
  const dvSugerido = datos.tipoIdentificacion === "RUC" && /^\w+$/.test(numeroRuc) ? calcularDV(numeroRuc) : null;

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErrorGeneral(null);
    const cuerpo = { ...datos, obligacionRegistro: datos.obligacionRegistro || null };
    // Las mismas reglas que aplica el servidor, compartidas desde @comprobantepy/shared.
    const resultado = esquemaContribuyente.safeParse(cuerpo);
    if (!resultado.success) {
      const nuevos: Record<string, string> = {};
      for (const problema of resultado.error.issues) nuevos[problema.path.join(".")] ??= problema.message;
      setErrores(nuevos);
      return;
    }
    setErrores({});
    setGuardando(true);
    try {
      await api("/contribuyentes", { cuerpo });
      await alGuardar();
    } catch (err) {
      if (err instanceof ErrorApi && err.detalles) setErrores(err.detalles);
      setErrorGeneral(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={enviar} className="tarjeta space-y-4" noValidate>
      <h2 className="text-lg font-semibold">Nuevo contribuyente</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <Campo etiqueta="Nombre completo" value={datos.nombre} onChange={(e) => cambiar("nombre")(e.target.value)} error={errores.nombre} />
        <Campo
          etiqueta="Relación (opcional)"
          placeholder="Titular, madre, esposo…"
          value={datos.relacion}
          onChange={(e) => cambiar("relacion")(e.target.value)}
          error={errores.relacion}
        />
        <div>
          <label className="etiqueta" htmlFor="tipo-identificacion">
            Tipo de identificación
          </label>
          <select
            id="tipo-identificacion"
            className="campo"
            value={datos.tipoIdentificacion}
            onChange={(e) => cambiar("tipoIdentificacion")(e.target.value)}
          >
            <option value="RUC">RUC</option>
            <option value="CI">Cédula (todavía sin RUC)</option>
          </select>
        </div>
        <Campo
          etiqueta={datos.tipoIdentificacion === "RUC" ? "RUC con dígito verificador" : "Número de cédula"}
          placeholder={datos.tipoIdentificacion === "RUC" ? "1234567-9" : "1234567"}
          value={datos.identificacion}
          onChange={(e) => cambiar("identificacion")(e.target.value)}
          error={errores.identificacion}
          ayuda={dvSugerido !== null && numeroRuc ? `DV calculado: ${numeroRuc}-${dvSugerido}` : undefined}
        />
        <div>
          <label className="etiqueta" htmlFor="obligacion-registro">
            Obligación de registro
          </label>
          <select
            id="obligacion-registro"
            className="campo"
            value={datos.obligacionRegistro}
            onChange={(e) => cambiar("obligacionRegistro")(e.target.value)}
          >
            <option value="">A confirmar</option>
            <option value="955">955 – Registro mensual</option>
            <option value="956">956 – Registro anual</option>
          </select>
        </div>
        <Campo
          etiqueta="Correo de contacto (opcional)"
          type="email"
          value={datos.correoContacto}
          onChange={(e) => cambiar("correoContacto")(e.target.value)}
          error={errores.correoContacto}
        />
      </div>

      <fieldset className="space-y-4 rounded-lg border border-slate-200 p-4">
        <legend className="px-1 font-semibold">Autorización del titular</legend>
        <div className="grid gap-4 md:grid-cols-2">
          <Campo
            etiqueta="Fecha de la autorización"
            type="date"
            value={datos.autorizacionFecha}
            onChange={(e) => cambiar("autorizacionFecha")(e.target.value)}
            error={errores.autorizacionFecha}
          />
          <Campo
            etiqueta="Forma de la autorización"
            placeholder="Escrita, verbal, mensaje…"
            value={datos.autorizacionForma}
            onChange={(e) => cambiar("autorizacionForma")(e.target.value)}
            error={errores.autorizacionForma}
          />
        </div>
        <Campo
          etiqueta="Alcance"
          value={datos.autorizacionAlcance}
          onChange={(e) => cambiar("autorizacionAlcance")(e.target.value)}
          error={errores.autorizacionAlcance}
        />
      </fieldset>

      {errorGeneral && (
        <p role="alert" className="error-campo">
          ⚠ {errorGeneral}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" className="boton-primario" disabled={guardando}>
          {guardando ? "Guardando…" : "Guardar"}
        </button>
        <button type="button" className="boton-secundario" onClick={alCancelar}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
