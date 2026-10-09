import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Las pruebas de integración usan TEST_DATABASE_URL; si no está definida se omiten.
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://sin-base-de-pruebas",
      NODE_ENV: "test",
      CLAVE_CIFRADO: Buffer.alloc(32, 1).toString("base64"),
    },
    fileParallelism: false,
  },
});
