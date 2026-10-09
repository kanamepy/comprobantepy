import { Link } from "react-router";
import { useSesion } from "../sesion";

export function Inicio() {
  const { sesion, contribuyenteActivo } = useSesion();
  if (!sesion) return null;
  const activo =
    contribuyenteActivo === "TODOS"
      ? "todos los contribuyentes"
      : (sesion.contribuyentes.find((c) => c.id === contribuyenteActivo)?.nombre ?? "—");

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Hola, {sesion.usuario.nombre}</h1>
      <p>
        Estás viendo: <strong>{activo}</strong>
      </p>

      {sesion.contribuyentes.length === 0 ? (
        <section className="tarjeta space-y-3">
          <h2 className="text-lg font-semibold">Primer paso</h2>
          <p>Todavía no hay contribuyentes registrados. Dá de alta al primero para empezar a cargar comprobantes.</p>
          {sesion.usuario.esAdministrador && (
            <Link to="/contribuyentes" className="boton-primario">
              Agregar contribuyente
            </Link>
          )}
        </section>
      ) : (
        <section className="tarjeta space-y-2">
          <h2 className="text-lg font-semibold">Bandeja de comprobantes</h2>
          <p className="text-slate-700">
            La carga y revisión de comprobantes se habilita en la siguiente etapa (Fase 1 de la especificación).
          </p>
        </section>
      )}
    </div>
  );
}
