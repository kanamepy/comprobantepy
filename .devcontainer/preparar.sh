#!/usr/bin/env bash
# Se ejecuta una vez al crear el Dev Container.
set -euo pipefail
sudo chown node:node node_modules
if [ ! -f .env ]; then
  cp .env.example .env
  clave=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
  sed -i "s|^CLAVE_CIFRADO=$|CLAVE_CIFRADO=${clave}|" .env
  echo "Se creó .env con una CLAVE_CIFRADO nueva: guardala en un lugar seguro."
fi
npm install
echo "Esperando a PostgreSQL..."
for _ in $(seq 1 60); do
  node -e "const c=new (require('pg').Client)({connectionString:process.env.DATABASE_URL});c.connect().then(()=>c.end()).then(()=>process.exit(0),()=>process.exit(1))" && break
  sleep 2
done
npm run db:migrate
node -e "
const pg=require('pg');const c=new pg.Client({connectionString:process.env.DATABASE_URL});
c.connect().then(async()=>{const r=await c.query(\"SELECT 1 FROM pg_database WHERE datname='comprobantepy_test'\");
if(!r.rowCount){await c.query('CREATE DATABASE comprobantepy_test');console.log('Se creó la base de pruebas.');}await c.end();});"
echo
echo "Listo. Creá tu usuario:  npm run crear-usuario -- --email tu@correo.com --nombre \"Tu nombre\" --admin"
echo "Y después:               npm run dev"
