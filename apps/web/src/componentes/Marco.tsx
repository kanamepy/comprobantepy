import { NavLink, Outlet } from "react-router";
import { useSesion } from "../sesion";

const enlaces = [
  { a: "/", texto: "Inicio", icono: "🏠" },
  { a: "/comprobantes", texto: "Bandeja", icono: "🗂" },
  { a: "/cargar", texto: "Cargar", icono: "📷" },
  { a: "/exportar", texto: "Exportar", icono: "⬇" },
  { a: "/reporte", texto: "Reporte", icono: "📊" },
  { a: "/proveedores", texto: "Proveedores", icono: "🏪" },
  { a: "/contribuyentes", texto: "Contribuyentes", icono: "👥" },
];

/** En el celular entran cinco accesos; el resto va a "Más". */
const enlacesMovil = [...enlaces.slice(0, 4), { a: "/mas", texto: "Más", icono: "☰" }];

/** Estructura común: contribuyente activo siempre visible y navegación inferior en el celular (secciones 2.4 y 16.1). */
export function Marco() {
  const { sesion, contribuyenteActivo, elegirContribuyente, salir } = useSesion();
  if (!sesion) return null;
  const activos = sesion.contribuyentes.filter((c) => c.estado === "ACTIVO");

  return (
    <div className="min-h-dvh bg-slate-50 pb-20 text-slate-900 md:pb-0">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white print:hidden">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-2">
          <span className="mr-auto text-lg font-bold text-blue-800">Comprobantes</span>
          <label className="order-last flex basis-full items-center gap-2 md:order-none md:basis-auto">
            <span className="sr-only text-sm font-medium lg:not-sr-only">Contribuyente:</span>
            <select
              aria-label="Contribuyente activo"
              className="campo md:w-auto"
              value={String(contribuyenteActivo)}
              onChange={(e) => elegirContribuyente(e.target.value === "TODOS" ? "TODOS" : Number(e.target.value))}
            >
              <option value="TODOS">Todos los contribuyentes</option>
              {activos.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="boton-secundario" onClick={() => void salir()}>
            Salir
          </button>
        </div>
        <nav className="mx-auto hidden max-w-6xl gap-1 px-4 pb-2 md:flex" aria-label="Principal">
          {enlaces.map((e) => (
            <NavLink
              key={e.a}
              to={e.a}
              end={e.a === "/"}
              className={({ isActive }) => `boton ${isActive ? "bg-blue-100 text-blue-900" : "text-slate-700 hover:bg-slate-100"}`}
            >
              {e.texto}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>

      <nav
        className="fixed inset-x-0 bottom-0 z-10 flex border-t border-slate-200 bg-white md:hidden print:hidden"
        aria-label="Principal"
      >
        {enlacesMovil.map((e) => (
          <NavLink
            key={e.a}
            to={e.a}
            end={e.a === "/"}
            className={({ isActive }) =>
              `flex min-h-14 flex-1 flex-col items-center justify-center text-xs ${isActive ? "font-bold text-blue-800" : "text-slate-700"}`
            }
          >
            <span aria-hidden="true">{e.icono}</span>
            {e.texto}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
