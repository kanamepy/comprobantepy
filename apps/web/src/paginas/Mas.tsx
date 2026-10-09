import { Link } from "react-router";

/** Menú del celular para las secciones que no entran en la barra inferior. */
export function Mas() {
  const opciones = [
    { a: "/reporte", texto: "📊 Reporte tributario consolidado" },
    { a: "/proveedores", texto: "🏪 Proveedores y timbrados" },
    { a: "/contribuyentes", texto: "👥 Contribuyentes" },
  ];
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Más opciones</h1>
      <ul className="grid gap-2">
        {opciones.map((o) => (
          <li key={o.a}>
            <Link to={o.a} className="boton-secundario w-full justify-start text-lg">
              {o.texto}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
