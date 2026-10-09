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
| Exportación a Marangatu: conciliación previa, generación del TXT/CSV en ZIP, descarga con verificación de huella | ✅ |
| Lotes: anulación antes de importar, envío, resultado de la DNIT, corrección y reenvío de rechazados | ✅ |
| Reporte tributario consolidado por naturaleza, destino y obligación; descarga en Excel e impresión a PDF | ✅ |
| Recepción por correo: buzón central Gmail, reenvío desde los correos de cada titular, conexión directa limitada a una etiqueta | ✅ (probado con un Gmail simulado) |
| Correos sin procesar dos veces, un registro aunque llegue por varios buzones, reenvíos de desconocidos a revisión, alertas si se pierde la conexión | ✅ |
| Carga manual de correos guardados (.eml) | ✅ |
| Lectura automática de fotos y PDF escaneados: OCR en español, QR de facturas electrónicas, aviso de fotos borrosas | ✅ |
| Fase 5: seguimiento y proyección del IRP-RSP | ⏳ próxima etapa |
| Fase 6: robustez y ampliaciones | ⏳ |

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
| `npm run worker` | Inicia la versión compilada del proceso trabajador (lectura de imágenes y correo). |
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

## Cómo exportar a Marangatu

1. Cargá y aprobá los comprobantes físicos del período (los electrónicos y virtuales no se exportan).
2. En **Exportar**, elegí el contribuyente y el mes (o el año si registra en forma anual), revisá la conciliación previa y generá el archivo.
3. Descargá el ZIP e importalo en Marangatu con las credenciales del titular.
4. Marcá el lote como **importado** y, cuando la DNIT informe el resultado en el Buzón Marandu, registralo: los comprobantes con error vuelven a "Observado" para corregirlos y reenviarlos en un lote nuevo.

> Antes de usarlo en serio, hacé una importación de prueba en Marangatu con un lote chico para confirmar el formato (criterio 27 de la especificación).

## Conectar Gmail (recepción por correo)

La aplicación lee el buzón central (`vgomez.factura@gmail.com`) con la API de Gmail. La contraseña del correo nunca pasa por la aplicación: Google pide autorización y entrega un permiso que se guarda cifrado. Hay que hacerlo **una sola vez**:

1. Entrá a <https://console.cloud.google.com> con la cuenta del buzón central y creá un proyecto (por ejemplo "Comprobantes").
2. En **APIs y servicios → Biblioteca**, buscá **Gmail API** y presioná **Habilitar**.
3. En **Google Auth Platform** (o "Pantalla de consentimiento de OAuth"): tipo de usuario **Externo**, nombre de la aplicación, tu correo de contacto. En **Público**, agregá `vgomez.factura@gmail.com` como usuario de prueba. En **Acceso a los datos**, agregá el permiso `https://www.googleapis.com/auth/gmail.modify` (leer y etiquetar).
4. En **Clientes** (o "Credenciales → Crear ID de cliente de OAuth"): tipo **Aplicación web**. En **URI de redireccionamiento autorizados** poné la dirección que muestra la pantalla Correo de la aplicación, por ejemplo `http://localhost:5173/api/correo/oauth/callback`.
5. Copiá el **ID de cliente** y el **secreto** en el archivo `.env` (`GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`) y reiniciá la aplicación.
6. En la aplicación: **Correo → Agregar buzón → Buzón central** y después **Conectar con Google**.

`npm run dev` ya incluye el proceso que revisa los buzones cada 5 minutos (`CORREO_INTERVALO_MINUTOS`). En producción se inicia aparte con `npm run worker`.

> **Importante (decisión D-05):** mientras el proyecto de Google esté en modo **"Testing"**, Google vence el permiso cada 7 días y la lectura se corta: la aplicación lo avisa con una alerta y basta con presionar **Volver a conectar**. Para evitarlo hay que **publicar** la aplicación en Google Auth Platform. Como el permiso de Gmail es de los que Google llama "restringidos", conviene revisar en la documentación de Google si para un uso familiar alcanza con la aplicación publicada sin verificar o si pide verificación adicional.

### Reenvío desde los correos de cada titular (recomendado)

Así la aplicación nunca accede al resto de sus mensajes:

1. En la aplicación: **Correo → Agregar buzón → Correo de un titular que reenvía al central**. Solo se aceptan reenvíos de las direcciones registradas; los de direcciones desconocidas quedan en revisión.
2. **En Gmail del titular:** Configuración → Ver todos los ajustes → **Reenvío y correo POP/IMAP → Agregar una dirección de reenvío** → `vgomez.factura@gmail.com`. Google envía un código de confirmación al buzón central: abrilo en Gmail y confirmalo. Después creá un **filtro** (por ejemplo `has:attachment filename:xml OR filename:pdf`) con la acción **Reenviar a** `vgomez.factura@gmail.com`.
3. **En Outlook o Hotmail:** Configuración → Correo → **Reglas** → nueva regla con la condición que corresponda y la acción **Reenviar a** `vgomez.factura@gmail.com`.

También se puede reenviar a mano un correo puntual, o guardarlo como archivo `.eml` y cargarlo desde **Cargar**.

## Lectura automática de fotos y PDF escaneados

Las fotos (desde la cámara o archivos) y los PDF escaneados se leen en segundo plano con OCR en español; si la imagen tiene el código QR de una factura electrónica, se toman sus datos (CDC, receptor y total) y el comprobante se marca como electrónico. Los datos leídos por OCR quedan resaltados en amarillo para revisarlos. Si una foto sale borrosa o con poca resolución, la aplicación lo avisa.

La lectura la hace el **proceso trabajador**: con `npm run dev` ya se inicia; en producción hay que ejecutar `npm run worker` además de `npm start`.

Para medir la exactitud con comprobantes reales (sección 21.3), poné en una carpeta las fotos o PDF y, por cada uno, un `.json` con el mismo nombre y los valores correctos, y ejecutá:

```bash
npm run medir-lectura -w @comprobantepy/api -- ruta/a/la/carpeta
```

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
- La lectura por OCR se probó con imágenes generadas (nítidas, borrosas, inclinadas y PDF escaneados). Con fotos reales tomadas con el celular la exactitud puede ser menor: conviene medirla con `npm run medir-lectura` y, si no alcanza los objetivos, evaluar un servicio de OCR de pago por uso (sección 21.4).
- La lectura de Gmail se probó con un Gmail simulado (no hay una cuenta real conectada en el entorno de desarrollo). La primera conexión real conviene hacerla con pocos correos.
- Las respuestas automáticas a los remitentes (sección 7.5) están desactivadas, como pide la especificación; se pueden agregar en la fase de ampliaciones. La aplicación nunca envía correos.
