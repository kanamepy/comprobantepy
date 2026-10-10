import QRCode from "qrcode";
import { useEffect, useState, type FormEvent } from "react";
import { api, type RespuestaYo } from "../api";
import { Campo } from "../componentes/Campo";
import { useSesion } from "../sesion";

/** Alta obligatoria del segundo factor para Administrador y Financiero (sección 21.1). */
export function Configurar2fa() {
  const { establecerSesion, salir } = useSesion();
  const [secreto, setSecreto] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [codigo, setCodigo] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    api<{ secreto: string; uri: string }>("/auth/totp/iniciar", { cuerpo: {} })
      .then(async ({ secreto: nuevo, uri }) => {
        if (cancelado) return;
        setSecreto(nuevo);
        setQr(await QRCode.toDataURL(uri, { width: 240, margin: 1 }));
      })
      .catch((err: Error) => setError(err.message));
    return () => {
      cancelado = true;
    };
  }, []);

  async function confirmar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      establecerSesion(await api<RespuestaYo>("/auth/totp/confirmar", { cuerpo: { codigo } }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo confirmar");
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-lavanda p-4">
      <form onSubmit={confirmar} className="tarjeta w-full max-w-md space-y-4">
        <h1 className="text-2xl font-bold text-blue-800">Configurá el segundo factor</h1>
        <p>
          Por seguridad, tu perfil requiere un código adicional al iniciar sesión. Escaneá el código QR con una
          aplicación de autenticación (Google Authenticator, Microsoft Authenticator, Authy u otra).
        </p>
        {qr && <img src={qr} alt="Código QR para la aplicación de autenticación" className="mx-auto" width={240} height={240} />}
        {secreto && (
          <p className="text-sm">
            Si no podés escanearlo, ingresá esta clave a mano:{" "}
            <code className="rounded bg-slate-100 px-1 break-all">{secreto}</code>
          </p>
        )}
        <Campo
          etiqueta="Código de 6 dígitos"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={codigo}
          onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ""))}
          error={error ?? undefined}
        />
        <div className="flex gap-2">
          <button type="submit" className="boton-primario flex-1" disabled={codigo.length !== 6}>
            Confirmar
          </button>
          <button type="button" className="boton-secundario" onClick={() => void salir()}>
            Salir
          </button>
        </div>
      </form>
    </main>
  );
}
