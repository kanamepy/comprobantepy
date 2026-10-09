#!/bin/sh
# Se ejecuta una sola vez, al crear el volumen de datos de PostgreSQL.
# La aplicación usa un usuario SIN privilegios de administrador: así la segunda barrera
# de aislamiento por contribuyente (RLS) también la controla la base de datos.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres -v clave="${APP_DB_PASSWORD:-comprobantepy}" <<'SQL'
CREATE ROLE comprobantepy LOGIN NOSUPERUSER NOBYPASSRLS CREATEDB PASSWORD :'clave';
CREATE DATABASE comprobantepy OWNER comprobantepy;
SQL
