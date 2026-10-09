# Imagen de producción: API + aplicación web + worker (el mismo código, otro comando).
# Construir:  docker compose -f docker-compose.prod.yml build

FROM node:22-bookworm-slim AS compilacion
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
# Cliente de PostgreSQL 16 (pg_dump / pg_restore) para los respaldos y una fuente para dibujar
# las páginas de PDF que se leen con OCR.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client-16 fonts-dejavu-core \
 && apt-get purge -y curl gnupg && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
    CARPETA_ARCHIVOS=/app/datos/archivos \
    CARPETA_RESPALDOS=/respaldos
COPY --from=compilacion /app/package.json ./
COPY --from=compilacion /app/node_modules ./node_modules
COPY --from=compilacion /app/packages/shared/package.json ./packages/shared/
COPY --from=compilacion /app/packages/shared/dist ./packages/shared/dist
COPY --from=compilacion /app/apps/api/package.json ./apps/api/
COPY --from=compilacion /app/apps/api/dist ./apps/api/dist
COPY --from=compilacion /app/apps/api/migraciones ./apps/api/migraciones
COPY --from=compilacion /app/apps/web/dist ./apps/web/dist
RUN mkdir -p /app/datos /respaldos && chown -R node:node /app/datos /respaldos
USER node
EXPOSE 3000
# Aplica las migraciones pendientes y arranca la API.
CMD ["sh", "-c", "node apps/api/dist/db/migrar.js && node apps/api/dist/server.js"]
