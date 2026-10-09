import { Navigate, Route, Routes } from "react-router";
import { Marco } from "./componentes/Marco";
import { Configurar2fa } from "./paginas/Configurar2fa";
import { Contribuyentes } from "./paginas/Contribuyentes";
import { Inicio } from "./paginas/Inicio";
import { Login } from "./paginas/Login";
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
        <Route path="contribuyentes" element={<Contribuyentes />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
