import { Link } from "react-router";
import { useSesion } from "../sesion";

/** Menú del celular para las secciones que no entran en la barra inferior. */
export function Mas() {
  const { sesion } = useSesion();
  const opciones = [
    { a: "/reporte", texto: "📊 Reporte tributario consolidado" },
    { a: "/irp", texto: "🧮 IRP-RSP: seguimiento y proyección" },
    { a: "/correo", texto: "✉ Correo" },
    { a: "/proveedores", texto: "🏪 Proveedores y timbrados" },
    { a: "/contribuyentes", texto: "👥 Contribuyentes" },
    ...(sesion?.usuario.esAdministrador ? [{ a: "/usuarios", texto: "🔐 Usuarios y perfiles" }] : []),
    { a: "/mi-cuenta", texto: "⚙ Mi cuenta" },
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
