import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icono.svg"],
      manifest: {
        name: "Comprobantes Marangatu",
        short_name: "Comprobantes",
        description: "Registro de comprobantes y exportación a Marangatu",
        lang: "es-PY",
        theme_color: "#1d4ed8",
        background_color: "#ffffff",
        display: "standalone",
        start_url: "/",
        icons: [{ src: "icono.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }],
      },
      workbox: {
        // Nunca guardar en caché las respuestas de la API: contienen datos tributarios.
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  resolve: {
    // En desarrollo se usan las fuentes del paquete compartido directamente.
    alias: {
      "@comprobantepy/shared": fileURLToPath(new URL("../../packages/shared/src/index.ts", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:3000" },
  },
});
