import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, ErrorApi, type Contribuyente } from "../api";
import { Campo } from "../componentes/Campo";
import { Dialogo } from "../componentes/Dialogo";
import { Insignia } from "../componentes/Insignia";
import { useSesion } from "../sesion";

type PerfilUsuario = "AUXILIAR" | "FINANCIERO" | "CONSULTA";
interface Usuario {
  id: number;
  email: string;
  nombre: string;
  esAdministrador: boolean;
  totpActivo: boolean;
  bloqueado: boolean;
  perfiles: { contribuyenteId: number; perfil: PerfilUsuario }[];
}

const PERFILES: { valor: PerfilUsuario; texto: string; ayuda: string }[] = [
  { valor: "AUXILIAR", texto: "Auxiliar", ayuda: "Carga y corrige comprobantes" },
  { valor: "FINANCIERO", texto: "Financiero", ayuda: "Aprueba, exporta y gestiona el IRP-RSP (exige segundo factor)" },
  { valor: "CONSULTA", texto: "Consulta", ayuda: "Solo lectura de sus datos y archivos" },
];

/** Usuarios y perfiles por contribuyente (sección 5). Solo para el administrador. */
export function Usuarios() {
  const { sesion } = useSesion();
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [contribuyentes, setContribuyentes] = useState<Contribuyente[]>([]);
  const [mensaje, setMensaje] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const [editando, setEditando] = useState<Usuario | null>(null);
  const [restableciendo, setRestableciendo] = useState<Usuario | null>(null);

  const cargar = useCallback(async () => {
    const [u, c] = await Promise.all([api<Usuario[]>("/usuarios"), api<Contribuyente[]>("/contribuyentes")]);
    setUsuarios(u);
    setContribuyentes(c.filter((x) => x.estado === "ACTIVO"));
  }, []);
  useEffect(() => {
    void cargar().catch((e: Error) => setMensaje({ tipo: "error", texto: e.message }));
  }, [cargar]);

  async function ejecutar(accion: () => Promise<unknown>, texto: string) {
    try {
      await accion();
      setMensaje({ tipo: "ok", texto });
      await cargar();
    } catch (err) {
      setMensaje({ tipo: "error", texto: err instanceof Error ? err.message : "No se pudo completar" });
    }
  }

  if (!sesion?.usuario.esAdministrador) return <p role="alert">Solo el administrador puede gestionar usuarios.</p>;
  const nombreDe = (id: number) => contribuyentes.find((c) => c.id === id)?.nombre ?? `#${id}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-bold">Usuarios</h1>
        <button type="button" className="boton-primario" onClick={() => setNuevo(true)}>
          ＋ Nuevo usuario
        </button>
      </div>
      <p className="text-slate-700">
        Cada usuario puede tener varios perfiles por contribuyente. Por ejemplo, la usuaria principal es Financiero de todos y cada
        titular puede tener perfil Consulta solo sobre sus propios datos.
      </p>
      {mensaje && (
        <p role={mensaje.tipo === "error" ? "alert" : "status"} className={mensaje.tipo === "error" ? "error-campo" : "font-medium text-green-800"}>
          {mensaje.tipo === "error" ? "⚠" : "✔"} {mensaje.texto}
        </p>
      )}
      <ul className="grid gap-3 md:grid-cols-2">
        {usuarios.map((u) => (
          <li key={u.id} className={`tarjeta space-y-2 ${u.bloqueado ? "opacity-70" : ""}`}>
            <div className="flex flex-wrap items-start gap-2">
              <div className="mr-auto">
                <h2 className="font-semibold">{u.nombre}</h2>
                <p className="text-sm text-slate-700 break-all">{u.email}</p>
              </div>
              {u.esAdministrador && <Insignia tono="azul">Administrador</Insignia>}
              {u.bloqueado && <Insignia tono="rojo">Bloqueado</Insignia>}
              <Insignia tono={u.totpActivo ? "verde" : "gris"} icono="🔑">
                {u.totpActivo ? "Con segundo factor" : "Sin segundo factor"}
              </Insignia>
            </div>
            {u.perfiles.length === 0 ? (
              <p className="text-sm text-slate-600">Sin acceso a contribuyentes.</p>
            ) : (
              <ul className="text-sm">
                {[...new Set(u.perfiles.map((p) => p.contribuyenteId))].map((c) => (
                  <li key={c}>
                    👤 {nombreDe(c)}:{" "}
                    {u.perfiles
                      .filter((p) => p.contribuyenteId === c)
                      .map((p) => PERFILES.find((x) => x.valor === p.perfil)!.texto)
                      .join(", ")}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap gap-2">
              <button type="button" className="boton-secundario" onClick={() => setEditando(u)}>
                Perfiles
              </button>
              {u.id !== sesion.usuario.id && (
                <button type="button" className="boton-secundario" onClick={() => void ejecutar(() => api(`/usuarios/${u.id}`, { metodo: "PATCH", cuerpo: { bloqueado: !u.bloqueado } }), u.bloqueado ? "Usuario desbloqueado" : "Usuario bloqueado")}>
                  {u.bloqueado ? "Desbloquear" : "Bloquear"}
                </button>
              )}
              <button type="button" className="boton-secundario" onClick={() => setRestableciendo(u)}>
                Restablecer contraseña
              </button>
              {u.totpActivo && (
                <button
                  type="button"
                  className="boton-secundario"
                  onClick={() =>
                    window.confirm(`¿Restablecer el segundo factor de ${u.nombre}? Deberá configurarlo de nuevo al ingresar.`) &&
                    void ejecutar(() => api(`/usuarios/${u.id}/restablecer-2fa`, { cuerpo: {} }), "Segundo factor restablecido")
                  }
                >
                  Restablecer segundo factor
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {nuevo && (
        <NuevoUsuario
          alCerrar={() => setNuevo(false)}
          alGuardar={async (u) => {
            setNuevo(false);
            await cargar();
            setMensaje({ tipo: "ok", texto: "Usuario creado. Asignale perfiles." });
            setEditando({ ...u, totpActivo: false, bloqueado: false, perfiles: [] });
          }}
        />
      )}
      {editando && (
        <EditorPerfiles
          usuario={editando}
          contribuyentes={contribuyentes}
          alCerrar={() => setEditando(null)}
          alGuardar={async () => {
            setEditando(null);
            setMensaje({ tipo: "ok", texto: "Perfiles actualizados" });
            await cargar();
          }}
        />
      )}
      {restableciendo && (
        <Dialogo abierto titulo={`Nueva contraseña para ${restableciendo.nombre}`} alCerrar={() => setRestableciendo(null)}>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              const password = String(new FormData(e.currentTarget).get("password") ?? "");
              const u = restableciendo;
              setRestableciendo(null);
              void ejecutar(() => api(`/usuarios/${u.id}/restablecer-password`, { cuerpo: { password } }), "Contraseña restablecida; se cerraron sus sesiones");
            }}
          >
            <Campo etiqueta="Contraseña temporal (mínimo 10 caracteres)" name="password" type="text" minLength={10} required autoComplete="new-password" />
            <p className="text-sm text-slate-700">Comunicásela por un medio seguro y pedile que la cambie desde “Mi cuenta”.</p>
            <button type="submit" className="boton-primario">
              Guardar
            </button>
          </form>
        </Dialogo>
      )}
    </div>
  );
}

function NuevoUsuario({ alCerrar, alGuardar }: { alCerrar: () => void; alGuardar: (u: Usuario) => Promise<void> }) {
  const [datos, setDatos] = useState({ nombre: "", email: "", password: "", esAdministrador: false });
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  async function enviar(e: FormEvent) {
    e.preventDefault();
    try {
      await alGuardar(await api<Usuario>("/usuarios", { cuerpo: datos }));
    } catch (err) {
      if (err instanceof ErrorApi && err.detalles) setErrores(err.detalles as Record<string, string>);
      setError(err instanceof Error ? err.message : "No se pudo crear");
    }
  }
  return (
    <Dialogo abierto titulo="Nuevo usuario" alCerrar={alCerrar}>
      <form onSubmit={enviar} className="space-y-3" noValidate>
        <Campo etiqueta="Nombre" value={datos.nombre} onChange={(e) => setDatos({ ...datos, nombre: e.target.value })} error={errores.nombre} />
        <Campo etiqueta="Correo electrónico" type="email" value={datos.email} onChange={(e) => setDatos({ ...datos, email: e.target.value })} error={errores.email} />
        <Campo
          etiqueta="Contraseña temporal (mínimo 10 caracteres)"
          type="text"
          autoComplete="new-password"
          value={datos.password}
          onChange={(e) => setDatos({ ...datos, password: e.target.value })}
          error={errores.password}
        />
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" className="size-5" checked={datos.esAdministrador} onChange={(e) => setDatos({ ...datos, esAdministrador: e.target.checked })} />
          Administrador (gestiona usuarios y contribuyentes; exige segundo factor)
        </label>
        {error && <p role="alert" className="error-campo">⚠ {error}</p>}
        <div className="flex gap-2">
          <button type="submit" className="boton-primario">
            Crear
          </button>
          <button type="button" className="boton-secundario" onClick={alCerrar}>
            Cancelar
          </button>
        </div>
      </form>
    </Dialogo>
  );
}

function EditorPerfiles({
  usuario,
  contribuyentes,
  alCerrar,
  alGuardar,
}: {
  usuario: Usuario;
  contribuyentes: Contribuyente[];
  alCerrar: () => void;
  alGuardar: () => Promise<void>;
}) {
  const [marcados, setMarcados] = useState(new Set(usuario.perfiles.map((p) => `${p.contribuyenteId}:${p.perfil}`)));
  const [error, setError] = useState<string | null>(null);
  const alternar = (clave: string) =>
    setMarcados((anterior) => {
      const nuevo = new Set(anterior);
      if (nuevo.has(clave)) nuevo.delete(clave);
      else nuevo.add(clave);
      return nuevo;
    });

  return (
    <Dialogo abierto titulo={`Perfiles de ${usuario.nombre}`} alCerrar={alCerrar}>
      <div className="max-h-[60vh] space-y-3 overflow-y-auto">
        {contribuyentes.map((c) => (
          <fieldset key={c.id} className="rounded-lg border border-slate-200 p-3">
            <legend className="px-1 font-medium">{c.nombre}</legend>
            {PERFILES.map((p) => (
              <label key={p.valor} className="flex min-h-11 items-center gap-2">
                <input type="checkbox" className="size-5" checked={marcados.has(`${c.id}:${p.valor}`)} onChange={() => alternar(`${c.id}:${p.valor}`)} />
                <span>
                  {p.texto} <span className="text-sm text-slate-600">— {p.ayuda}</span>
                </span>
              </label>
            ))}
          </fieldset>
        ))}
      </div>
      {error && <p role="alert" className="error-campo">⚠ {error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          className="boton-primario"
          onClick={async () => {
            try {
              const perfiles = [...marcados].map((k) => {
                const [contribuyenteId, perfil] = k.split(":");
                return { contribuyenteId: Number(contribuyenteId), perfil };
              });
              await api(`/usuarios/${usuario.id}/perfiles`, { metodo: "PUT", cuerpo: { perfiles } });
              await alGuardar();
            } catch (err) {
              setError(err instanceof Error ? err.message : "No se pudo guardar");
            }
          }}
        >
          Guardar perfiles
        </button>
        <button type="button" className="boton-secundario" onClick={alCerrar}>
          Cancelar
        </button>
      </div>
    </Dialogo>
  );
}
