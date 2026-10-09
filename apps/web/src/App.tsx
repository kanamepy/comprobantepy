import { Navigate, Route, Routes } from "react-router";
import { Marco } from "./componentes/Marco";
import { Cargar } from "./paginas/Cargar";
import { Comprobante } from "./paginas/Comprobante";
import { Comprobantes } from "./paginas/Comprobantes";
import { Configurar2fa } from "./paginas/Configurar2fa";
import { Contribuyentes } from "./paginas/Contribuyentes";
import { Exportar } from "./paginas/Exportar";
import { Inicio } from "./paginas/Inicio";
import { Login } from "./paginas/Login";
import { Mas } from "./paginas/Mas";
import { Proveedores } from "./paginas/Proveedores";
import { Reporte } from "./paginas/Reporte";
import { useSesion } from "./sesion";

export function App() {
  const { cargando, sesion } = useSesion();

  if (cargando) {
    return (
      <p role="status" className="p-6 text-slate-700">
        Cargando…
      </p>
    );
  }
  if (!sesion) return <Login />;
  if (sesion.usuario.requiereConfigurar2fa) return <Configurar2fa />;

  return (
    <Routes>
      <Route element={<Marco />}>
        <Route index element={<Inicio />} />
        <Route path="comprobantes" element={<Comprobantes />} />
        <Route path="comprobantes/:id" element={<Comprobante />} />
        <Route path="cargar" element={<Cargar />} />
        <Route path="proveedores" element={<Proveedores />} />
        <Route path="exportar" element={<Exportar />} />
        <Route path="reporte" element={<Reporte />} />
        <Route path="mas" element={<Mas />} />
        <Route path="contribuyentes" element={<Contribuyentes />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
