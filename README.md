# ComprobantePy

Aplicación web para recibir, validar y registrar comprobantes de compras y egresos de varios contribuyentes de una familia, y generar los archivos de importación para **Marangatu** (DNIT, Paraguay).

La especificación funcional completa es la versión 4.6 (`Especificacion_Funcional_Unificada_Comprobantes_Marangatu_v4.md`). Las secciones citadas en el código (por ejemplo "sección 18.4") se refieren a ese documento.

## Estado actual

| Parte | Estado |
|---|---|
| Inicio de sesión con segundo factor (TOTP) obligatorio para administrador y financiero | ✅ |
| Contribuyentes con autorización del titular, obligaciones con vigencia y actividades | ✅ |
| Carga de comprobantes: varios archivos a la vez, foto con la cámara del celular o carga manual | ✅ |
| Lectura automática de XML SIFEN y de PDF con texto (incluido el KuDE con CDC) | ✅ |
| Un único registro aunque el comprobante llegue como XML y PDF; reprocesar no duplica | ✅ |
| Asignación automática al contribuyente receptor; bloqueo de asignarlo a otro | ✅ |
| Naturaleza fiscal (físico, electrónico, virtual), destino Compras/Egresos y elegibilidad Marangatu | ✅ |
| Proveedores a confirmar, validación del RUC y verificación manual de timbrados con evidencia | ✅ |
| Duplicados exactos bloqueados y posibles duplicados marcados para revisión | ✅ |
| Bandeja en tarjetas (celular) o tabla (computadora), selección y acciones masivas | ✅ |
| Imputación múltiple a obligaciones y actividades, con sugerencia según el proveedor | ✅ |
| Estados de flujo (confirmar, aprobar, observar, rechazar, anular con motivo) e historial | ✅ |
| Archivos originales guardados cifrados; log de auditoría inmutable | ✅ |
| Fase 2: lotes de exportación a Marangatu desde la interfaz (las reglas ya están listas) | ⏳ próxima etapa |
| Fases 3 a 6: correo, OCR de fotos y PDF escaneados, tablero del IRP-RSP | ⏳ |

## Tecnologías

- **Frontend:** React + Vite + Tailwind CSS, instalable como PWA (`apps/web`).
- **Backend:** Node.js + Fastify (`apps/api`).
- **Base de datos:** PostgreSQL, con Drizzle ORM y migraciones versionadas (`apps/api/migraciones`).
- **Reglas compartidas** entre el navegador y el servidor: TypeScript + Zod (`packages/shared`).
- **Pruebas:** Vitest.

```
comprobantepy/
├── apps/web/          React + Vite (PWA)
├── apps/api/          API Fastify, esquema de la base y migraciones
├── packages/shared/   reglas tributarias y validaciones compartidas
├── datos/archivos/    archivos originales cifrados (se crea solo; no se sube a GitHub)
└── docker-compose.yml PostgreSQL para desarrollo
```

---

## Cómo ejecutarlo en tu PC

### 1. Instalar los programas necesarios (una sola vez)

| Programa | Para qué | Dónde |
|---|---|---|
| **Node.js 22 LTS** o superior | Ejecuta la aplicación | <https://nodejs.org> (descargar la versión LTS) |
| **Docker Desktop** | Levanta PostgreSQL sin instalarlo a mano | <https://www.docker.com/products/docker-desktop/> |
| **Git** | Descarga el proyecto | <https://git-scm.com> |

Para comprobar que quedaron instalados, abrí una terminal (en Windows: PowerShell) y ejecutá:

```bash
node -v      # debe mostrar v22 o superior
docker -v
git --version
```

> **Sin Docker:** también podés instalar PostgreSQL 16 directamente (<https://www.postgresql.org/download/>), crear un usuario y una base `comprobantepy`, y poner los datos en `DATABASE_URL` (paso 3).

### 2. Descargar el proyecto

```bash
git clone https://github.com/kanamepy/comprobantepy.git
cd comprobantepy
```

### 3. Crear el archivo de configuración

Copiá el archivo de ejemplo:

```bash
# Windows (PowerShell)
copy .env.example .env

# Mac / Linux
cp .env.example .env
```

Generá la clave de cifrado y pegala en `CLAVE_CIFRADO` dentro de `.env`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

> Guardá esa clave en un lugar seguro. Si se pierde, no se pueden recuperar los datos cifrados (por ejemplo, el segundo factor de los usuarios).

### 4. Levantar la base de datos

Con Docker Desktop abierto:

```bash
docker compose up -d
```

### 5. Instalar dependencias y crear las tablas

```bash
npm install
npm run db:migrate
```

### 6. Crear tu usuario administrador

```bash
npm run crear-usuario -- --email tu-correo@ejemplo.com --nombre "Tu nombre" --admin
```

Te va a pedir una contraseña de al menos 10 caracteres.

### 7. Iniciar la aplicación

```bash
npm run dev
```

Abrí **<http://localhost:5173>** en el navegador e iniciá sesión. La primera vez se te pide configurar el segundo factor: escaneá el código QR con Google Authenticator, Microsoft Authenticator, Authy u otra aplicación similar.

Para detener la aplicación: `Ctrl + C` en la terminal. Para detener la base de datos: `docker compose down` (los datos se conservan).

---

## Comandos útiles

| Comando | Qué hace |
|---|---|
| `npm run dev` | Inicia la aplicación en modo desarrollo (frontend en el puerto 5173, API en el 3000). |
| `npm test` | Ejecuta las pruebas. |
| `npm run typecheck` | Verifica los tipos de TypeScript. |
| `npm run build` | Compila todo para producción. |
| `npm start` | Inicia la versión compilada (la API también sirve el frontend en el puerto 3000). |
| `npm run db:generate` | Crea una nueva migración después de cambiar `apps/api/src/db/esquema.ts`. |
| `npm run db:migrate` | Aplica las migraciones pendientes. |

### Pruebas de integración con la base de datos

Las pruebas de la API que usan PostgreSQL se ejecutan solo si definís `TEST_DATABASE_URL`, apuntando a una base **exclusiva para pruebas**, porque se borra en cada ejecución:

```bash
# Mac / Linux
TEST_DATABASE_URL=postgres://comprobantepy:comprobantepy@localhost:5432/comprobantepy_test npm test

# Windows (PowerShell)
$env:TEST_DATABASE_URL="postgres://comprobantepy:comprobantepy@localhost:5432/comprobantepy_test"; npm test
```

La base de pruebas se crea una vez con:

```bash
docker compose exec postgres createdb -U comprobantepy comprobantepy_test
```

---

## Respaldo

Para no perder información hay que respaldar **las dos cosas**: la base de datos PostgreSQL y la carpeta `datos/archivos` (o la indicada en `CARPETA_ARCHIVOS`). También guardá la `CLAVE_CIFRADO`: sin ella los archivos no se pueden abrir.

## Puntos a confirmar antes de producción

Estos puntos están marcados **[A CONFIRMAR]** en la especificación. En el código quedaron como parámetros configurables:

- Obligación de registro 955 (mensual) o 956 (anual) de cada contribuyente (D-06).
- Fin de línea y delimitador del archivo de importación (D-10): por defecto TXT con tabulaciones y salto de línea `\n`. Hay que confirmarlo con una importación real de prueba en Marangatu.
- Regla de redondeo del IRP-RSP y tipo de cambio para moneda extranjera (D-08).
- Vigencia de la Tabla 4 de tipos de comprobante (junio 2021).
- Rasgos para reconocer un comprobante virtual (D-03): hoy se detecta por la leyenda "comprobante virtual", por marcar al proveedor como emisor virtual o eligiéndolo a mano.
- Mecanismo para verificar timbrados y documentos electrónicos ante la DNIT/SIFEN (D-04): mientras tanto, verificación manual con evidencia.

## Notas técnicas

- La separación por contribuyente se aplica en la capa de acceso a datos de la API. La segunda barrera en la base (Row Level Security con un usuario de base sin privilegios) se agrega en la fase de robustez.
- La verificación de la firma digital del XML y el antivirus se agregan en fases posteriores.
