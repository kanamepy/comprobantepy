import type { ReactNode } from "react";
import { ICONO_TONO } from "../formato";

const CLASES = {
  verde: "bg-green-100 text-green-900 border-green-300",
  azul: "bg-blue-100 text-blue-900 border-blue-300",
  ambar: "bg-amber-100 text-amber-900 border-amber-300",
  rojo: "bg-red-100 text-red-900 border-red-300",
  gris: "bg-slate-100 text-slate-800 border-slate-300",
} as const;

/** Estado con texto e ícono, nunca solo color (sección 16.4). */
export function Insignia({ tono, children, icono }: { tono: keyof typeof CLASES; children: ReactNode; icono?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-sm font-medium ${CLASES[tono]}`}>
      <span aria-hidden="true">{icono ?? ICONO_TONO[tono]}</span>
      {children}
    </span>
  );
}
