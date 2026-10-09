import { useEffect, useState } from "react";
import { Link } from "react-router";
import { api, type FilaBandeja } from "../api";
import { useSesion } from "../sesion";

const GRUPOS = [
  { texto: "Faltan datos", estados: ["PENDIENTE_DATOS", "BORRADOR"] },
  { texto: "Sin contribuyente", estados: ["PENDIENTE_ASIGNACION_CONTRIBUYENTE"] },
  { texto: "Proveedor a confirmar", estados: ["PENDIENTE_CONFIRMACION_PROVEEDOR"] },
  { texto: "Posibles duplicados", estados: ["POSIBLE_DUPLICADO"] },
  { texto: "Listos para revisar", estados: ["PENDIENTE_DE_REVISION"] },
  { texto: "Confirmados (a aprobar)", estados: ["CONFIRMADO"] },
  { texto: "Observados", estados: ["OBSERVADO"] },
  { texto: "Aprobados", estados: ["APROBADO"] },
];

export function Inicio() {
  const { sesion, contribuyenteActivo } = useSesion();
  const [filas, setFilas] = useState<FilaBandeja[] | null>(null);
  const [proveedoresPendientes, setProveedoresPendientes] = useState(0);

  useEffect(() => {
    const parametros = new URLSearchParams({ limite: "500" });
    if (contribuyenteActivo !== "TODOS") parametros.set("contribuyenteId", String(contribuyenteActivo));
    api<{ comprobantes: FilaBandeja[] }>(`/comprobantes?${parametros}`).then((r) => setFilas(r.comprobantes), () => setFilas([]));
    api<unknown[]>("/proveedores?estado=PENDIENTE_DE_CONFIRMAR").then((r) => setProveedoresPendientes(r.length), () => undefined);
  }, [contribuyenteActivo]);

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
          <p>Todavía no hay contribuyentes registrados. Dá de alta al primero, con sus obligaciones, para empezar a cargar comprobantes.</p>
          {sesion.usuario.esAdministrador && (
            <Link to="/contribuyentes" className="boton-primario">
              Agregar contribuyente
            </Link>
          )}
        </section>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <Link to="/cargar" className="boton-primario min-h-14 text-lg">
              📷 Cargar comprobantes
            </Link>
            <Link to="/comprobantes" className="boton-secundario min-h-14 text-lg">
              🗂 Ir a la bandeja
            </Link>
          </div>
          <section aria-labelledby="titulo-resumen" className="space-y-2">
            <h2 id="titulo-resumen" className="text-lg font-semibold">
              Resumen
            </h2>
            {filas === null ? (
              <p role="status">Cargando…</p>
            ) : (
              <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {GRUPOS.map((g) => (
                  <li key={g.texto} className="tarjeta">
                    <p className="text-3xl font-bold">{filas.filter((f) => g.estados.includes(f.estadoFlujo)).length}</p>
                    <p className="text-slate-700">{g.texto}</p>
                  </li>
                ))}
              </ul>
            )}
            {proveedoresPendientes > 0 && (
              <p>
                🏪 Hay {proveedoresPendientes} proveedores por confirmar.{" "}
                <Link to="/proveedores" className="text-blue-800 underline">
                  Revisarlos
                </Link>
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
