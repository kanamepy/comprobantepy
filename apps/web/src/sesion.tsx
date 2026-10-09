import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, ErrorApi, type RespuestaYo } from "./api";

/** "TODOS" muestra las bandejas de todos los contribuyentes (sección 2.4). */
export type ContribuyenteActivo = number | "TODOS";

interface EstadoSesion {
  cargando: boolean;
  sesion: RespuestaYo | null;
  contribuyenteActivo: ContribuyenteActivo;
  elegirContribuyente: (id: ContribuyenteActivo) => void;
  establecerSesion: (sesion: RespuestaYo | null) => void;
  recargar: () => Promise<void>;
  salir: () => Promise<void>;
}

const ContextoSesion = createContext<EstadoSesion | null>(null);
const CLAVE_ACTIVO = "contribuyenteActivo";

function leerActivoGuardado(): ContribuyenteActivo {
  try {
    const valor = localStorage.getItem(CLAVE_ACTIVO);
    if (valor && valor !== "TODOS" && !Number.isNaN(Number(valor))) return Number(valor);
  } catch {
    // Almacenamiento no disponible (modo privado): se usa el valor por defecto.
  }
  return "TODOS";
}

export function ProveedorSesion({ children }: { children: ReactNode }) {
  const [cargando, setCargando] = useState(true);
  const [sesion, setSesion] = useState<RespuestaYo | null>(null);
  const [contribuyenteActivo, setActivo] = useState<ContribuyenteActivo>(leerActivoGuardado);

  const recargar = useCallback(async () => {
    try {
      setSesion(await api<RespuestaYo>("/auth/yo"));
    } catch (error) {
      if (!(error instanceof ErrorApi) || error.estado !== 401) console.error(error);
      setSesion(null);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  // Si el contribuyente guardado ya no es visible, volver a "Todos".
  useEffect(() => {
    if (sesion && contribuyenteActivo !== "TODOS" && !sesion.contribuyentes.some((c) => c.id === contribuyenteActivo)) {
      setActivo("TODOS");
    }
  }, [sesion, contribuyenteActivo]);

  const elegirContribuyente = (id: ContribuyenteActivo) => {
    setActivo(id);
    try {
      localStorage.setItem(CLAVE_ACTIVO, String(id));
    } catch {
      // Sin almacenamiento: la elección dura mientras la página esté abierta.
    }
  };

  const salir = async () => {
    await api("/auth/logout", { cuerpo: {} }).catch(() => undefined);
    setSesion(null);
  };

  return (
    <ContextoSesion.Provider
      value={{ cargando, sesion, contribuyenteActivo, elegirContribuyente, establecerSesion: setSesion, recargar, salir }}
    >
      {children}
    </ContextoSesion.Provider>
  );
}

export function useSesion() {
  const contexto = useContext(ContextoSesion);
  if (!contexto) throw new Error("useSesion debe usarse dentro de ProveedorSesion");
  return contexto;
}
