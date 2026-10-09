import { useEffect, useState } from "react";
import { api, type Contribuyente } from "./api";
import { useSesion } from "./sesion";

/**
 * Lotes, reportes y cierres son siempre de un solo contribuyente (sección 2.4).
 * Usa el contribuyente activo; si está en "Todos", deja elegir uno en la página.
 */
export function useContribuyenteElegido() {
  const { contribuyenteActivo, elegirContribuyente } = useSesion();
  const [lista, setLista] = useState<Contribuyente[]>([]);

  useEffect(() => {
    api<Contribuyente[]>("/contribuyentes").then((l) => setLista(l.filter((c) => c.estado === "ACTIVO")), () => setLista([]));
  }, []);

  const id = contribuyenteActivo === "TODOS" ? (lista[0]?.id ?? null) : contribuyenteActivo;
  const contribuyente = lista.find((c) => c.id === id) ?? null;
  return { contribuyente, lista, elegir: (nuevo: number) => elegirContribuyente(nuevo) };
}
