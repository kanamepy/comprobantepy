import type { Contribuyente } from "../api";

export function SelectorContribuyente({ contribuyente, lista, alElegir }: { contribuyente: Contribuyente | null; lista: Contribuyente[]; alElegir: (id: number) => void }) {
  return (
    <div>
      <label htmlFor="contribuyente-pagina" className="etiqueta">
        Contribuyente
      </label>
      <select id="contribuyente-pagina" className="campo md:w-80" value={contribuyente?.id ?? ""} onChange={(e) => alElegir(Number(e.target.value))}>
        {lista.map((c) => (
          <option key={c.id} value={c.id}>
            {c.nombre} ({c.tipoIdentificacion} {c.numeroIdentificacion}
            {c.dv !== null ? `-${c.dv}` : ""})
          </option>
        ))}
      </select>
    </div>
  );
}
