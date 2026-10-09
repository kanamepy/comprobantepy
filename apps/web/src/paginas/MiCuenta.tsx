import { useState, type FormEvent } from "react";
import { api, ErrorApi } from "../api";
import { Campo } from "../componentes/Campo";
import { useSesion } from "../sesion";

export function MiCuenta() {
  const { sesion } = useSesion();
  const [datos, setDatos] = useState({ actual: "", nueva: "", repetir: "" });
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [mensaje, setMensaje] = useState<string | null>(null);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setMensaje(null);
    if (datos.nueva !== datos.repetir) {
      setErrores({ repetir: "Las contraseñas no coinciden" });
      return;
    }
    try {
      await api("/usuarios/yo/password", { cuerpo: { actual: datos.actual, nueva: datos.nueva } });
      setErrores({});
      setDatos({ actual: "", nueva: "", repetir: "" });
      setMensaje("Contraseña cambiada. Se cerraron tus otras sesiones abiertas.");
    } catch (err) {
      setErrores(err instanceof ErrorApi && err.detalles ? (err.detalles as Record<string, string>) : { nueva: err instanceof Error ? err.message : "Error" });
    }
  }

  return (
    <div className="max-w-md space-y-4">
      <h1 className="text-2xl font-bold">Mi cuenta</h1>
      <p>
        {sesion?.usuario.nombre} · {sesion?.usuario.email}
      </p>
      <form onSubmit={enviar} className="tarjeta space-y-3" noValidate>
        <h2 className="font-semibold">Cambiar contraseña</h2>
        <Campo etiqueta="Contraseña actual" type="password" autoComplete="current-password" value={datos.actual} onChange={(e) => setDatos({ ...datos, actual: e.target.value })} error={errores.actual} />
        <Campo etiqueta="Nueva contraseña (mínimo 10 caracteres)" type="password" autoComplete="new-password" value={datos.nueva} onChange={(e) => setDatos({ ...datos, nueva: e.target.value })} error={errores.nueva} />
        <Campo etiqueta="Repetir la nueva contraseña" type="password" autoComplete="new-password" value={datos.repetir} onChange={(e) => setDatos({ ...datos, repetir: e.target.value })} error={errores.repetir} />
        {mensaje && <p role="status" className="font-medium text-green-800">✔ {mensaje}</p>}
        <button type="submit" className="boton-primario">
          Cambiar contraseña
        </button>
      </form>
    </div>
  );
}
