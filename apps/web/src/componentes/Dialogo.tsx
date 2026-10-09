import { useEffect, useRef, type ReactNode } from "react";

/** Diálogo modal accesible basado en <dialog>. */
export function Dialogo({ abierto, titulo, alCerrar, children }: { abierto: boolean; titulo: string; alCerrar: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialogo = ref.current;
    if (!dialogo) return;
    if (abierto && !dialogo.open) dialogo.showModal();
    if (!abierto && dialogo.open) dialogo.close();
  }, [abierto]);
  return (
    <dialog
      ref={ref}
      onClose={alCerrar}
      className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-xl p-0 shadow-xl backdrop:bg-black/40"
      aria-labelledby="titulo-dialogo"
    >
      <div className="space-y-4 p-5">
        <div className="flex items-start gap-2">
          <h2 id="titulo-dialogo" className="mr-auto text-lg font-semibold">
            {titulo}
          </h2>
          <button type="button" className="boton text-slate-700 hover:bg-slate-100" onClick={alCerrar} aria-label="Cerrar">
            ✕
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

/** Pide un motivo obligatorio antes de ejecutar una acción (anular, observar, rechazar…). */
export function DialogoMotivo({
  abierto,
  titulo,
  textoBoton,
  alCerrar,
  alConfirmar,
  obligatorio = true,
}: {
  abierto: boolean;
  titulo: string;
  textoBoton: string;
  alCerrar: () => void;
  alConfirmar: (motivo: string) => void;
  obligatorio?: boolean;
}) {
  return (
    <Dialogo abierto={abierto} titulo={titulo} alCerrar={alCerrar}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const motivo = String(new FormData(e.currentTarget).get("motivo") ?? "").trim();
          if (obligatorio && !motivo) return;
          alConfirmar(motivo);
        }}
      >
        <div>
          <label htmlFor="motivo" className="etiqueta">
            Motivo {obligatorio ? "(obligatorio)" : "(opcional)"}
          </label>
          <textarea id="motivo" name="motivo" className="campo min-h-24 py-2" required={obligatorio} autoFocus />
        </div>
        <div className="flex gap-2">
          <button type="submit" className="boton-primario">
            {textoBoton}
          </button>
          <button type="button" className="boton-secundario" onClick={alCerrar}>
            Cancelar
          </button>
        </div>
      </form>
    </Dialogo>
  );
}
