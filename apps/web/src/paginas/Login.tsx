import { useState, type FormEvent } from "react";
import { api, ErrorApi, type RespuestaYo } from "../api";
import { Campo } from "../componentes/Campo";
import { useSesion } from "../sesion";

export function Login() {
  const { establecerSesion } = useSesion();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [codigo, setCodigo] = useState("");
  const [pedirCodigo, setPedirCodigo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      const respuesta = await api<RespuestaYo>("/auth/login", {
        cuerpo: { email, password, codigoTotp: pedirCodigo ? codigo : undefined },
      });
      establecerSesion(respuesta);
    } catch (err) {
      if (err instanceof ErrorApi && err.codigo === "REQUIERE_TOTP") {
        setPedirCodigo(true);
      } else {
        setError(err instanceof Error ? err.message : "No se pudo iniciar sesión");
      }
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-lavanda p-4">
      <form onSubmit={enviar} className="tarjeta w-full max-w-sm space-y-4" noValidate>
        <p className="text-sm font-bold tracking-[0.15em] text-blue-700">COMPROBANTES · MARANGATU</p>
        <h1 className="text-3xl font-bold text-slate-900">
          Comprobante<span className="text-blue-700">Py</span>
        </h1>
        <Campo
          etiqueta="Correo electrónico"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          disabled={pedirCodigo}
        />
        <Campo
          etiqueta="Contraseña"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          disabled={pedirCodigo}
        />
        {pedirCodigo && (
          <Campo
            etiqueta="Código de verificación"
            ayuda="Los 6 dígitos de tu aplicación de autenticación."
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={codigo}
            onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ""))}
            autoFocus
          />
        )}
        {error && (
          <p role="alert" className="error-campo">
            ⚠ {error}
          </p>
        )}
        <button type="submit" className="boton-primario w-full" disabled={enviando}>
          {enviando ? "Ingresando…" : pedirCodigo ? "Verificar" : "Ingresar"}
        </button>
      </form>
    </main>
  );
}
