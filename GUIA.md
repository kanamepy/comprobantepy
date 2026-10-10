# Guía completa de ComprobantePy

Esta guía explica **todo lo necesario** para instalar, probar, usar, respaldar y publicar la aplicación. Está pensada para alguien que no recuerda bien cómo funciona el programa: seguila en orden y copiá los comandos tal cual.

> **Cómo leer los comandos.** Todo lo que está en un recuadro gris es un comando: se copia, se pega en la **terminal** y se presiona Enter. En VS Code la terminal se abre con el menú **Terminal → Nueva terminal** y aparece abajo. Las líneas que empiezan con `#` son comentarios: no hace falta copiarlas.

> **Tu caso: Windows de 64 bits, uso interno en la casa.** No hace falta publicar nada en internet: la aplicación funciona en tu PC y se puede usar desde los celulares de la casa por wifi. La publicación ([sección 11](#11-publicar-la-aplicación-en-internet)) es opcional, para más adelante.

> **Si algo no funciona:** doble clic en `Diagnostico.cmd` y compartí el archivo `diagnostico.txt` que genera. **Para traer mejoras:** doble clic en `Actualizar.cmd`.

> **Implementación paso a paso con casillas de verificación:** [docs/PASO_A_PASO.md](docs/PASO_A_PASO.md), y en Word: `docs/Implementacion_y_verificacion_ComprobantePy.docx`.

## Camino más corto: con doble clic (casi sin escribir)

En la carpeta del proyecto hay cuatro archivos que se abren con **doble clic** desde el Explorador de Windows:

| Archivo | Cuándo usarlo | Qué hace |
|---|---|---|
| **`Preparar.cmd`** | Una sola vez, al principio (o si algo se rompió) | Verifica e instala Node y Docker, crea la configuración y la clave, la base de datos y las tablas, y te ayuda a crear tu usuario |
| **`Iniciar.cmd`** | Cada vez que quieras usar la aplicación | Abre Docker si está cerrado, enciende todo y abre el navegador en <http://localhost:5173>. **Para apagar, cerrá esa ventana negra** |
| **`Respaldar.cmd`** | Una vez por semana (o antes de cambios grandes) | Hace un respaldo y comprueba que se pueda restaurar |
| **`Pruebas.cmd`** | Para verificar que todo funciona después de actualizar | Corre las pruebas automáticas |

Pasos mínimos:

1. Instalá **Node.js** y **Docker Desktop** ([sección 2](#2-programas-que-hay-que-instalar-en-la-pc)); `Preparar.cmd` también ofrece instalarlos.
2. Descargá el proyecto ([sección 3](#3-descargar-el-proyecto-sin-tocar-nada-de-github)). Alternativa sin comandos: en la página de GitHub, botón verde **Code → Download ZIP**, y descomprimilo en `C:\Proyectos\comprobantepy-prueba`.
3. Doble clic en **`Preparar.cmd`** y respondé lo que pregunta.
4. Doble clic en **`Iniciar.cmd`**.

> Si Windows muestra "Windows protegió su PC" al abrir un `.cmd`: **Más información → Ejecutar de todas formas** (aparece porque el archivo vino de internet).

Si algo de esto falla, las secciones siguientes explican lo mismo paso a paso, con **alternativas** para cada caso.

---

## Índice

1. [Qué es la aplicación y cómo está armada](#1-qué-es-la-aplicación-y-cómo-está-armada)
2. [Programas que hay que instalar en la PC](#2-programas-que-hay-que-instalar-en-la-pc)
3. [Descargar el proyecto sin tocar nada de GitHub](#3-descargar-el-proyecto-sin-tocar-nada-de-github)
4. [Preparar el proyecto (una sola vez)](#4-preparar-el-proyecto-una-sola-vez)
5. [Iniciar y detener la aplicación todos los días](#5-iniciar-y-detener-la-aplicación-todos-los-días)
6. [Primer ingreso y configuración inicial](#6-primer-ingreso-y-configuración-inicial)
7. [Plan de pruebas paso a paso](#7-plan-de-pruebas-paso-a-paso)
8. [Pruebas automáticas](#8-pruebas-automáticas)
9. [Respaldos y restauración](#9-respaldos-y-restauración)
10. [Conectar Gmail](#10-conectar-gmail)
11. [Publicar la aplicación en internet](#11-publicar-la-aplicación-en-internet)
12. [Problemas comunes y cómo resolverlos](#12-problemas-comunes-y-cómo-resolverlos)
13. [Referencia rápida de comandos](#13-referencia-rápida-de-comandos)
14. [Referencia del archivo .env](#14-referencia-del-archivo-env)
15. [Glosario: estados y perfiles](#15-glosario-estados-y-perfiles)
16. [Puntos pendientes de confirmar](#16-puntos-pendientes-de-confirmar)

---

## 1. Qué es la aplicación y cómo está armada

ComprobantePy recibe comprobantes de compras y gastos (fotos, PDF, XML de facturas electrónicas, correos), lee sus datos, los valida, los organiza por contribuyente de la familia y genera el archivo para importar en **Marangatu** (DNIT). También lleva el seguimiento del **IRP-RSP**.

Funciona como una página web: se abre en el navegador (de la PC o del celular). Por dentro tiene cuatro partes que se inician juntas:

| Parte | Qué hace | Dónde está |
|---|---|---|
| **Base de datos** (PostgreSQL) | Guarda todo: usuarios, contribuyentes, comprobantes, lotes | Corre dentro de Docker |
| **API** (servidor) | La lógica: validaciones, permisos, exportación | `apps/api` |
| **Web** (lo que ves) | Las pantallas | `apps/web` |
| **Trabajador** (worker) | Lee fotos con OCR, revisa el correo, hace respaldos diarios | `apps/api/src/worker.ts` |

Otras carpetas y archivos importantes:

| Carpeta / archivo | Para qué sirve |
|---|---|
| `packages/shared` | Reglas comunes (RUC, Marangatu, IRP-RSP, estados) |
| `apps/api/migraciones` | Definición de las tablas de la base |
| `datos/archivos` | Los archivos originales recibidos, **cifrados** (no se sube a GitHub) |
| `datos/respaldos` | Respaldos creados con `npm run respaldo` (no se sube a GitHub) |
| `.env` | Configuración y claves de **tu** PC (no se sube a GitHub) |
| `scripts/preparar.ps1` | Prepara todo automáticamente en Windows |
| `.devcontainer/` | Entorno completo dentro de Docker para VS Code |
| `docker-compose.yml` | Base de datos (y antivirus opcional) para la PC |
| `docker-compose.prod.yml`, `Dockerfile` | Para publicar en un servidor |
| `README.md` | Resumen técnico |
| `GUIA.md` | Esta guía |

---

## 2. Programas que hay que instalar en la PC

Se instalan **una sola vez**. Ya tenés **Git** y **VS Code**.

| Programa | Para qué | Dónde se descarga |
|---|---|---|
| **Git** | Descargar el proyecto | <https://git-scm.com> (ya lo tenés) |
| **VS Code** | Ver el código y usar la terminal | <https://code.visualstudio.com> (ya lo tenés) |
| **Node.js 22 o superior** (versión LTS) | Ejecutar la aplicación | <https://nodejs.org> |
| **Docker Desktop** | Ejecutar la base de datos sin instalarla a mano | <https://www.docker.com/products/docker-desktop/> |

### Antes de instalar Docker: comprobar la virtualización

Docker necesita que la **virtualización** del procesador esté activada:

1. Abrí el **Administrador de tareas** (`Ctrl + Shift + Esc`).
2. Pestaña **Rendimiento → CPU**.
3. Abajo a la derecha tiene que decir **Virtualización: Habilitado**.

**Si dice "Deshabilitado":** hay que activarla en la BIOS.

1. Reiniciá la PC y, apenas aparece el logo, presioná varias veces la tecla de la BIOS. En notebooks **Acer** suele ser **F2**.
2. Buscá la opción **Intel Virtualization Technology** (o "VT-x"), normalmente en la pestaña **Advanced** o **Main**, y ponela en **Enabled**.
3. Guardá y salí con **F10 → Yes**.

Si no encontrás la opción, pedile ayuda a alguien con conocimientos técnicos: es un cambio seguro y no borra nada.

### Instalación rápida con winget (Windows 10/11)

Abrí **PowerShell como administrador** (clic derecho en el botón Inicio → "Terminal (administrador)") y ejecutá:

```powershell
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Docker.DockerDesktop -e
```

**Si `winget` no funciona** ("no se reconoce"): instalá **App Installer** desde Microsoft Store, o descargá los instaladores a mano:

- Node.js: <https://nodejs.org> → botón **LTS** → **Windows Installer (.msi) 64-bit** → siguiente, siguiente, finalizar (dejá marcada la opción "Add to PATH").
- Docker Desktop: <https://www.docker.com/products/docker-desktop/> → **Download for Windows – AMD64** → instalar con la opción **Use WSL 2** marcada → reiniciar la PC.

- Docker Desktop usa **WSL 2**. Si Windows lo pide, aceptá y **reiniciá la PC**. Si no se instala solo: `wsl --install` en PowerShell como administrador y reiniciá.
- Después de instalar, abrí **Docker Desktop** una vez y esperá a que abajo a la izquierda diga **Engine running** (motor funcionando). Podés marcar "Start Docker Desktop when you sign in" para que arranque solo.
- **Cerrá y volvé a abrir VS Code** para que reconozca los programas nuevos.

### Comprobar que todo está instalado

En la terminal de VS Code:

```powershell
node -v          # debe mostrar v22.x o superior
npm -v           # cualquier número
docker -v        # cualquier número
docker info      # no debe dar error (si da error, Docker Desktop no está abierto)
git --version
```

### Extensiones de VS Code recomendadas

Al abrir el proyecto, VS Code ofrece instalarlas (abajo a la derecha). Aceptá:

- **Dev Containers** (para la opción B del paso 4)
- **Docker**
- **Vitest** (para ver y correr las pruebas)
- **Tailwind CSS IntelliSense**

---

## 3. Descargar el proyecto sin tocar nada de GitHub

Descargar o probar **nunca cambia nada en GitHub**: solo cambia GitHub si hacés `git push`, y para probar no hace falta. Igual, lo más tranquilo es usar una **carpeta aparte** para pruebas.

En la terminal de VS Code:

```powershell
cd C:\
mkdir Proyectos
cd Proyectos
git clone -b claude/serene-knuth-9f54ys https://github.com/kanamepy/comprobantepy.git comprobantepy-prueba
```

> Si ya uniste la rama a `main` (ver [11.1](#111-unir-el-trabajo-a-la-rama-principal-main)), usá `git clone https://github.com/kanamepy/comprobantepy.git comprobantepy-prueba` (sin `-b ...`).

Después: **Archivo → Abrir carpeta… → `C:\Proyectos\comprobantepy-prueba`**. Si VS Code pregunta "¿Confía en los autores?", respondé que sí.

**Si `git clone` falla:**

- *"Repository not found" o pide usuario y contraseña:* el repositorio es privado. Alternativa: en VS Code, `F1` → **Git: Clone** → **Clone from GitHub** → iniciá sesión con tu cuenta → elegí `kanamepy/comprobantepy`. Después, abajo a la izquierda, clic en el nombre de la rama → elegí `origin/claude/serene-knuth-9f54ys`.
- *Alternativa sin Git:* en <https://github.com/kanamepy/comprobantepy>, elegí la rama `claude/serene-knuth-9f54ys` (botón de ramas arriba a la izquierda) → botón verde **Code → Download ZIP** → descomprimir en `C:\Proyectos\`. (Así no vas a poder usar `git pull` para actualizar; tendrías que volver a descargar.)
- *"mkdir: ya existe":* la carpeta ya estaba creada; seguí con el siguiente comando.

Para **actualizar** esa carpeta con cambios nuevos de GitHub más adelante:

```powershell
git pull
npm install
npm run db:migrate
```

---

## 4. Preparar el proyecto (una sola vez)

Hay tres formas. Elegí **una**. La **A** es la recomendada en Windows.

### Opción A — Script automático (recomendada)

**Forma 1 (sin escribir):** doble clic en **`Preparar.cmd`** en la carpeta del proyecto.

**Forma 2:** en la terminal de VS Code, dentro de la carpeta del proyecto:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\preparar.ps1
```

**Forma 3:** menú **Terminal → Ejecutar tarea… → "Preparar el proyecto (primera vez)"**.

Si una forma no funciona, probá la siguiente. Si ninguna funciona, usá la **Opción C** (manual), que hace lo mismo comando por comando.

El script hace todo esto y avisa en cada paso:

1. Verifica Node.js y Docker (si faltan, ofrece instalarlos).
2. Crea el archivo `.env` con una **clave de cifrado nueva**.
3. Levanta la base de datos, instala las dependencias y crea las tablas.
4. Crea la base para las pruebas automáticas.
5. Ofrece crear tu **usuario administrador** (correo, nombre y contraseña de al menos 10 caracteres).

Se puede ejecutar de nuevo cuando quieras: lo que ya está hecho se saltea.

> ⚠️ **Muy importante:** abrí el archivo `.env`, copiá la línea `CLAVE_CIFRADO=...` y guardala en un lugar seguro (gestor de contraseñas, papel en un lugar seguro). **Si se pierde, no se pueden abrir los archivos guardados ni los respaldos.**

### Opción B — Dev Container (todo dentro de Docker)

En la PC solo hacen falta Docker Desktop, VS Code y la extensión **Dev Containers**; Node y PostgreSQL corren dentro de Docker.

1. Abrí la carpeta del proyecto en VS Code.
2. Presioná `F1`, escribí **Dev Containers: Reopen in Container** y Enter.
3. La primera vez tarda varios minutos (descarga e instala todo). Al terminar dice "Listo".
4. En la terminal (que ahora es Linux, dentro del contenedor):

   ```bash
   npm run crear-usuario -- --email tu@correo.com --nombre "Tu nombre" --admin
   npm run dev
   ```

5. VS Code abre el navegador solo en <http://localhost:5173>.

> En el Dev Container la base de datos es otra (separada de la de la opción A). Para volver a la PC normal: `F1` → **Dev Containers: Reopen Folder Locally**.

### Opción C — Manual, comando por comando

```powershell
# 1. Configuración
Copy-Item .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# Abrí .env y pegá el resultado después de CLAVE_CIFRADO=  (y guardalo aparte)

# 2. Base de datos (Docker Desktop abierto)
docker compose up -d

# 3. Dependencias y tablas
npm install
npm run db:migrate

# 4. Base para las pruebas automáticas (opcional)
docker compose exec postgres createdb -U comprobantepy comprobantepy_test

# 5. Tu usuario administrador (pide una contraseña de 10+ caracteres)
npm run crear-usuario -- --email tu@correo.com --nombre "Tu nombre" --admin
```

En **Mac o Linux** es igual, salvo el paso 1: `cp .env.example .env`.

---

## 5. Iniciar y detener la aplicación todos los días

**Forma 1 (sin escribir):** doble clic en **`Iniciar.cmd`**. Abre Docker si hace falta, enciende todo y abre el navegador. Para apagar, cerrá la ventana negra.

**Forma 2 (desde VS Code):**

1. Abrí **Docker Desktop** y esperá **Engine running**.
2. En VS Code, abrí la carpeta del proyecto y en la terminal:

   ```powershell
   docker compose up -d
   npm run dev
   ```

   (o **Terminal → Ejecutar tarea… → "Iniciar la aplicación"**)

3. Abrí **<http://localhost:5173>** en el navegador.

Mientras `npm run dev` está corriendo, la terminal queda ocupada mostrando mensajes: es normal. Se inician juntas la API, la web y el trabajador (OCR y correo).

**Si `npm run dev` da error de "ejecución de scripts deshabilitada":** usá `npm.cmd run dev` (lo mismo con cualquier comando `npm`: escribí `npm.cmd` en vez de `npm`). Alternativa permanente, una sola vez en PowerShell: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` y respondé **S**.

**Si la página no abre:** esperá 20 segundos y recargá (F5). Verificá que la terminal no muestre errores en rojo. Si dice que el puerto está ocupado, cerrá las otras terminales o reiniciá la PC.

**Para detener:** clic en la terminal y `Ctrl + C`. Para apagar también la base de datos: `docker compose down` (los datos **se conservan**).

> ⚠️ **Nunca** ejecutes `docker compose down -v` salvo que quieras **borrar toda la base de datos**: la `-v` elimina los datos.

### Usarla desde el celular en la casa

Con la PC y el celular en el mismo wifi:

1. En la PC, averiguá su IP: `ipconfig` (buscá "Dirección IPv4", por ejemplo `192.168.1.20`).
2. Detené la aplicación y en su lugar compilala e iniciala en modo producción:

   ```powershell
   npm run build
   npm start          # en otra terminal: npm run worker
   ```

3. En el celular abrí `http://192.168.1.20:3000`. Si no abre, Windows puede estar bloqueando el puerto: permití "Node.js" en el Firewall de Windows (redes privadas).

---

## 6. Primer ingreso y configuración inicial

1. **Iniciar sesión** con el correo y la contraseña del administrador.
2. **Segundo factor (2FA):** la primera vez aparece un código QR. Escanealo con **Google Authenticator**, **Microsoft Authenticator** o **Authy** en el celular y escribí el código de 6 dígitos. Desde entonces, cada ingreso pide ese código. Guardá también el texto del secreto que aparece debajo del QR por si cambiás de celular.
3. **Contribuyentes** → **＋ Agregar** por cada miembro de la familia:
   - Nombre completo, **RUC con dígito verificador** (por ejemplo `1234567-9`).
   - **Obligación de registro:** 955 (mensual) o 956 (anual). Confirmalo con el contador.
   - Datos de la **autorización** del titular (fecha, forma, alcance).
   - Dentro del contribuyente, en **Obligaciones y actividades**: agregá sus obligaciones (IVA, IRP-RSP, etc.) con la fecha "desde", y sus actividades si corresponde.
4. **Usuarios** (menú, solo administrador) → crear los usuarios de la familia y darles un **perfil por contribuyente**:
   - **Consulta:** solo mira.
   - **Auxiliar:** carga y confirma comprobantes.
   - **Financiero:** además aprueba, exporta a Marangatu y maneja el IRP-RSP. **Requiere 2FA.**
   - **Administrador:** gestiona usuarios y contribuyentes. **Requiere 2FA.**
5. **Mi cuenta:** cada usuario puede cambiar su contraseña.
6. **Selector "Contribuyente"** (arriba): filtra todas las pantallas (bandeja, proveedores, correo) por la persona elegida, o "Todos".

---

## 7. Plan de pruebas paso a paso

Hacé estas pruebas con comprobantes **reales**. Anotá en una lista todo lo que esté mal leído, no se entienda o no funcione (con captura de pantalla si se puede).

### Prueba 1 — Carga y lectura

1. **Cargar** → elegí 3 o 4 archivos a la vez: un **XML** de factura electrónica, el **PDF (KuDE)** de esa misma factura, un **PDF de factura física** y una **foto** (en el celular, el botón abre la cámara).
2. ✅ Esperado: el XML y su PDF quedan como **un solo** comprobante; la foto muestra "Leyendo…" y en unos segundos se completan los datos.
3. Abrí cada comprobante desde la **Bandeja**: los campos leídos por OCR aparecen resaltados en **amarillo** para revisar. Corregí lo que esté mal y **Guardar**.
4. Probá cargar **el mismo archivo otra vez**. ✅ Esperado: no se duplica ("ya registrado").

### Prueba 2 — Asignación y validaciones

1. Un comprobante emitido al RUC de un contribuyente se asigna **solo** a esa persona.
2. Escribí un RUC inválido en un proveedor o contribuyente. ✅ Esperado: lo rechaza (dígito verificador).
3. Revisá el recuadro **"Para revisar"**: errores (✖), datos faltantes (✎) y advertencias.
4. **Proveedores:** confirmá los proveedores nuevos y registrá la **verificación del timbrado** (consulta pública de la DNIT, con captura como evidencia).

### Prueba 3 — Imputación y flujo

1. En el comprobante, **Obligaciones y actividades** → imputalo (por ejemplo, 100 % IVA).
2. Cuando no le falta nada queda **Pendiente de revisión**: botones **Confirmar** y después **Aprobar** (Financiero). Probá también **Observar** (después corregí y usá **Enviar a revisión**), **Rechazar** y **Anular** (piden motivo).
3. ✅ Esperado: cada paso queda en el **Historial** con fecha y usuario.

### Prueba 4 — Exportación a Marangatu (la más importante)

1. **Exportar** → elegí contribuyente y período (mes, o año si es 956).
2. Revisá la **conciliación previa** (qué entra y qué no, y por qué).
3. **Generar** y **descargar** el ZIP.
4. **Importalo en Marangatu** con el usuario del titular, con un lote chico (2 o 3 comprobantes físicos).
5. En la aplicación, marcá el lote como **importado** y después registrá el **resultado de la DNIT** (aceptado o rechazado, del Buzón Marandu).
6. ✅ Esperado: los rechazados vuelven a "Observado" para corregirlos y reenviarlos.
7. **Si Marangatu rechaza el archivo por formato**, anotá el mensaje exacto: se ajusta el delimitador o el fin de línea (ver [16](#16-puntos-pendientes-de-confirmar)).

### Prueba 5 — Correcciones posteriores

1. En un comprobante **aceptado por la DNIT**, como Financiero: **Nueva versión (corregir)** → motivo.
2. ✅ Esperado: se abre la versión 2 para corregir y volver a aprobar; la versión 1 queda como historial con un aviso amarillo.
3. En un comprobante **electrónico**: **Verificación en SIFEN** → consultá el CDC en e-Kuatia y registrá el resultado (con captura opcional).

### Prueba 6 — Reportes e IRP-RSP

1. **Reporte:** elegí contribuyente y período; compará los totales con tus cuentas. Probá **descargar Excel** e **Imprimir**.
2. **IRP-RSP:** cargá ingresos, saldo anterior y retenciones; en **Egresos** confirmá el tratamiento de cada gasto (deducible / parcial / no deducible). Revisá el **Resumen** (escenarios confirmado y proyectado). Probá **Cerrar mes**. Revisá **Tasas y tramos** con el contador.

### Prueba 7 — Usuarios y permisos

1. Creá un usuario con perfil **Consulta** para un contribuyente. Ingresá con él (en otra ventana privada del navegador).
2. ✅ Esperado: solo ve ese contribuyente y no puede modificar nada.

### Prueba 8 — Respaldo

1. `npm run respaldo` y después `npm run respaldo -- probar`.
2. ✅ Esperado: termina con "✔ El respaldo se puede restaurar." (ver [9](#9-respaldos-y-restauración)).

### Prueba 9 — Correo (opcional, requiere configurar Gmail)

Ver [10](#10-conectar-gmail). Reenviá un correo con una factura adjunta al buzón central y esperá unos minutos: aparece en **Correo** y el comprobante en la **Bandeja**.

---

## 8. Pruebas automáticas

Son unas 177 pruebas que verifican las reglas del programa. Conviene correrlas después de cualquier cambio o actualización.

**Sin escribir:** doble clic en **`Pruebas.cmd`**.

**Desde VS Code:** **Terminal → Ejecutar tarea… → "Pruebas automáticas"**.

**Por comando** (Windows PowerShell):

```powershell
$env:TEST_DATABASE_URL="postgres://comprobantepy:comprobantepy@localhost:5432/comprobantepy_test"; npm test
```

Mac / Linux:

```bash
TEST_DATABASE_URL=postgres://comprobantepy:comprobantepy@localhost:5432/comprobantepy_test npm test
```

En el **Dev Container** basta con `npm test`.

✅ Resultado esperado al final: `Tests 85 passed` (reglas compartidas) y `Tests 92 passed` (API). La base `comprobantepy_test` se borra y se rehace en cada ejecución: **nunca** pongas ahí la base real.

Otros chequeos:

```powershell
npm run typecheck     # revisa errores de tipos en el código
npm run build         # compila todo; si no da error, está listo para producción
```

---

## 9. Respaldos y restauración

Hay que respaldar **dos cosas**: la base de datos y los archivos originales. **Sin escribir:** doble clic en **`Respaldar.cmd`** (crea el respaldo y lo comprueba).

Por comando:

```powershell
npm run respaldo
```

Crea `datos\respaldos\respaldo-AAAAMMDD-HHMMSS\` con:

- `base.dump` — la base de datos,
- `archivos\` — los archivos originales (cifrados),
- `manifiesto.json` — resumen.

Conserva los últimos 14 (cambialo con `RESPALDOS_CONSERVAR` en `.env`).

**Probar que un respaldo sirve** (no toca la base en uso; la restaura en una base temporal y la borra):

```powershell
npm run respaldo -- probar
npm run respaldo -- listar      # ver los respaldos que hay
```

**Respaldo automático diario:** en `.env` poné `RESPALDO_DIARIO_HORA=2` (2 de la mañana). Lo hace el trabajador, así que la aplicación tiene que estar encendida a esa hora.

**Reglas de oro:**

1. Copiá la carpeta `datos\respaldos` a un **disco externo o a la nube** (Google Drive, OneDrive) al menos una vez por semana.
2. Guardá la `CLAVE_CIFRADO` **aparte**, nunca junto al respaldo.
3. Probá un respaldo (`npm run respaldo -- probar`) una vez por mes.

### Restaurar un respaldo (por ejemplo, en una PC nueva)

1. Prepará el proyecto (paso 4) **sin crear usuario** y **sin** `npm run db:migrate`. Poné en `.env` la **misma `CLAVE_CIFRADO`** de antes.
2. Con la base vacía recién creada (`docker compose up -d`):

   ```powershell
   Get-Content -Encoding Byte -ReadCount 0 "datos\respaldos\respaldo-AAAAMMDD-HHMMSS\base.dump" | docker compose exec -T postgres pg_restore --no-owner --enable-row-security -U comprobantepy -d comprobantepy
   ```

   (En Mac/Linux: `docker compose exec -T postgres pg_restore --no-owner --enable-row-security -U comprobantepy -d comprobantepy < datos/respaldos/respaldo-AAAAMMDD-HHMMSS/base.dump`)

   Si PowerShell da problemas con ese comando, usá este alternativo, que copia el archivo dentro del contenedor:

   ```powershell
   docker compose cp "datos\respaldos\respaldo-AAAAMMDD-HHMMSS\base.dump" postgres:/tmp/base.dump
   docker compose exec postgres pg_restore --no-owner --enable-row-security -U comprobantepy -d comprobantepy /tmp/base.dump
   ```

3. Copiá la carpeta `archivos` del respaldo a `datos\archivos`.
4. `npm run db:migrate` (aplica cambios si el respaldo era de una versión anterior) y `npm run dev`.

---

## 10. Conectar Gmail

Es **opcional**: sin Gmail se puede cargar todo a mano o subir correos guardados (`.eml`). Los pasos detallados con capturas de Google están en el `README.md`, sección "Conectar Gmail". Resumen:

1. En <https://console.cloud.google.com>, con la cuenta del **buzón central**: crear proyecto → habilitar **Gmail API**.
2. **Pantalla de consentimiento** (Google Auth Platform): tipo Externo; agregar el buzón central como **usuario de prueba**; permiso `https://www.googleapis.com/auth/gmail.modify`.
3. **Credenciales → ID de cliente OAuth** tipo **Aplicación web**, con URI de redireccionamiento:
   - en la PC: `http://localhost:5173/api/correo/oauth/callback`
   - publicada: `https://TU-DOMINIO/api/correo/oauth/callback`
4. Copiar **ID de cliente** y **secreto** a `.env` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) y reiniciar la aplicación.
5. En la aplicación: **Correo → Agregar buzón → Buzón central → Conectar con Google**.
6. Para cada titular: **Correo → Agregar buzón → Correo de un titular que reenvía**, y en su Gmail/Outlook crear el **reenvío automático** (con filtro) al buzón central.

> Mientras el proyecto de Google esté en modo **Testing**, el permiso vence cada **7 días**: la aplicación muestra una alerta y se resuelve con **Volver a conectar**.

---

## 11. Publicar la aplicación en internet

> **Guía detallada con dominio .com.py (NIC.py / CNC), DigitalOcean, datos que piden y casillas de verificación:** [docs/PUBLICAR_EN_INTERNET.md](docs/PUBLICAR_EN_INTERNET.md), y en Word: `docs/Publicar_en_internet_ComprobantePy.docx`.

> **Opcional.** Para uso interno en la casa no hace falta: alcanza con la PC encendida y `Iniciar.cmd` (y los celulares por wifi, ver [sección 5](#5-iniciar-y-detener-la-aplicación-todos-los-días)). Publicar sirve si querés entrar desde fuera de la casa; implica pagar un servidor y un dominio.

### 11.1 Unir el trabajo a la rama principal (main)

Todo el trabajo está en la rama `claude/serene-knuth-9f54ys`. Para pasarlo a `main` desde la página de GitHub:

1. Entrá a <https://github.com/kanamepy/comprobantepy>.
2. Pestaña **Pull requests → New pull request**.
3. **base:** `main` ← **compare:** `claude/serene-knuth-9f54ys` → **Create pull request** → título, por ejemplo "Aplicación completa" → **Create pull request**.
4. Revisá y presioná **Merge pull request → Confirm merge**.

Desde entonces, el servidor se instala desde `main`.

### 11.2 Qué se necesita

| Qué | Detalle | Costo aproximado |
|---|---|---|
| **Servidor (VPS) Linux** | Ubuntu 24.04, 2 GB de RAM (4 GB si usás antivirus), 25 GB de disco. Por ejemplo DigitalOcean, Hetzner, Vultr, Contabo. | 5 a 12 USD/mes |
| **Dominio** | Por ejemplo `comprobantes.tufamilia.com.py` o un `.com`. Se puede usar un subdominio de un dominio que ya tengas. | 10 a 40 USD/año |

### 11.3 Paso a paso en el servidor

**1. Apuntar el dominio al servidor.** En el panel de tu dominio, creá un registro **DNS tipo A**: nombre `comprobantes` (o `@`), valor = **IP del servidor**. Puede tardar de minutos a horas en propagarse.

**2. Conectarse al servidor** desde la terminal de VS Code (te pide la contraseña que te dio el proveedor):

```powershell
ssh root@IP_DEL_SERVIDOR
```

**3. Instalar Docker y preparar el firewall** (ya dentro del servidor):

```bash
apt update && apt upgrade -y
curl -fsSL https://get.docker.com | sh
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw --force enable
```

**4. Descargar el proyecto:**

```bash
cd /opt
git clone https://github.com/kanamepy/comprobantepy.git
cd comprobantepy
```

(Si el repositorio es **privado**, GitHub pide usuario y un **token**: en GitHub → Settings → Developer settings → Personal access tokens → generá uno con permiso de lectura del repositorio y usalo como contraseña.)

**5. Crear la configuración:**

```bash
cp .env.prod.example .env
# Generar contraseñas y clave (copiá cada resultado):
openssl rand -base64 24 | tr '+/' '-_'     # para POSTGRES_ADMIN_PASSWORD
openssl rand -base64 24 | tr '+/' '-_'     # para APP_DB_PASSWORD
openssl rand -base64 32                     # para CLAVE_CIFRADO
nano .env
```

En `nano` completá: `DOMINIO`, `URL_PUBLICA` (con `https://`), `POSTGRES_ADMIN_PASSWORD`, `APP_DB_PASSWORD`, `CLAVE_CIFRADO` y, si usás Gmail, `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`. Guardar: `Ctrl + O`, Enter; salir: `Ctrl + X`.

> ⚠️ Guardá una copia de `.env` (sobre todo `CLAVE_CIFRADO`) en tu gestor de contraseñas.

**6. Construir e iniciar** (la primera vez tarda 5 a 10 minutos):

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Con antivirus:

```bash
docker compose -f docker-compose.prod.yml --profile antivirus up -d --build
```

(y en `.env`: `CLAMAV_HOST=clamav`)

**7. Ver que todo esté funcionando:**

```bash
docker compose -f docker-compose.prod.yml ps                 # todos "running" / "Up"
docker compose -f docker-compose.prod.yml logs -f app        # mensajes (salir con Ctrl + C)
```

**8. Crear el usuario administrador:**

```bash
docker compose -f docker-compose.prod.yml exec app node apps/api/dist/scripts/crear-usuario.js --email tu@correo.com --nombre "Tu nombre" --admin
```

**9. Abrir** `https://TU-DOMINIO` en el navegador (el candado HTTPS lo obtiene Caddy solo en un minuto). Ingresá y configurá el 2FA.

**10. Gmail** (si lo usás): agregá `https://TU-DOMINIO/api/correo/oauth/callback` en las credenciales de Google y conectá el buzón desde la aplicación.

### 11.4 Mantenimiento del servidor

**Actualizar a una versión nueva** (las migraciones se aplican solas):

```bash
cd /opt/comprobantepy
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

**Respaldos:** el trabajador hace uno por día a la hora de `RESPALDO_DIARIO_HORA`. Para probarlo y bajarlo a tu PC:

```bash
# En el servidor: probar el último respaldo
docker compose -f docker-compose.prod.yml exec worker node apps/api/dist/scripts/respaldo.js probar
# Crear uno en este momento
docker compose -f docker-compose.prod.yml exec worker node apps/api/dist/scripts/respaldo.js
# Copiar los respaldos del contenedor a una carpeta del servidor
docker compose -f docker-compose.prod.yml cp worker:/respaldos ./respaldos
```

```powershell
# En tu PC (PowerShell): bajar esa carpeta del servidor
scp -r root@IP_DEL_SERVIDOR:/opt/comprobantepy/respaldos C:\Respaldos\comprobantepy
```

**Otros comandos útiles en el servidor:**

```bash
docker compose -f docker-compose.prod.yml restart          # reiniciar todo
docker compose -f docker-compose.prod.yml stop             # detener (los datos se conservan)
docker compose -f docker-compose.prod.yml logs --tail 100 worker   # ver el trabajador
df -h                                                      # espacio en disco
```

### 11.5 Lista de control de seguridad antes de usarlo en serio

- [ ] HTTPS funciona (candado en el navegador).
- [ ] Todos los usuarios Administrador y Financiero tienen 2FA.
- [ ] `CLAVE_CIFRADO` y `.env` guardados fuera del servidor.
- [ ] Respaldo diario activado y probado; copia fuera del servidor.
- [ ] La base de datos **no** está expuesta a internet (en `docker-compose.prod.yml` no tiene `ports`; no lo cambies).
- [ ] Firewall activo (`ufw status` muestra solo 22, 80 y 443).
- [ ] Importación de prueba en Marangatu confirmada.

---

## 12. Problemas comunes y cómo resolverlos

| Problema | Causa probable | Solución |
|---|---|---|
| `node no se reconoce como comando` | Node no instalado, o VS Code abierto desde antes | Instalá Node 22 y **cerrá y abrí VS Code** |
| `docker: error during connect` o `Cannot connect to the Docker daemon` | Docker Desktop cerrado | Abrí Docker Desktop y esperá "Engine running" |
| Docker Desktop dice "Virtualization support not detected" | Virtualización desactivada en la BIOS | Ver "Antes de instalar Docker: comprobar la virtualización" en la [sección 2](#2-programas-que-hay-que-instalar-en-la-pc) |
| Docker Desktop pide WSL o no arranca | Falta WSL 2 | PowerShell como administrador: `wsl --install`, reiniciar |
| `port is already allocated` / `5432` ocupado | Ya hay otro PostgreSQL instalado en la PC | Detené ese PostgreSQL (Servicios de Windows) o cambiá el puerto en `docker-compose.yml` (`"5433:5432"`) y en `.env` (`localhost:5433`) |
| `3000` o `5173` ocupado | Quedó abierta otra instancia | Cerrá las otras terminales con `Ctrl + C`, o reiniciá VS Code |
| `No se puede cargar el archivo ... porque la ejecución de scripts está deshabilitada` | Política de PowerShell | Usá `powershell -ExecutionPolicy Bypass -File scripts\preparar.ps1`, o `npm.cmd` en lugar de `npm` |
| `Falta la variable de entorno DATABASE_URL` | No existe `.env` | `Copy-Item .env.example .env` y completalo |
| `password authentication failed` | La base se creó con otra configuración | Si no tiene datos importantes: `docker compose down -v` (**borra la base**) y `docker compose up -d`, `npm run db:migrate` |
| Al iniciar avisa "se conecta con un usuario administrador" | Base creada con una versión anterior del proyecto | Funciona, pero sin la segunda barrera de seguridad. Hacé un respaldo, `docker compose down -v`, `docker compose up -d` y restaurá (ver [9](#9-respaldos-y-restauración)) |
| La foto queda "Leyendo…" para siempre | El trabajador no está corriendo | Con `npm run dev` se inicia solo; en producción hace falta `npm run worker` |
| Perdí el celular con el 2FA | — | Otro administrador: **Usuarios → Restablecer 2FA**. Si sos el único administrador, ver abajo |
| Olvidé la contraseña | — | Otro administrador: **Usuarios → Restablecer contraseña**. Si sos el único: creá otro administrador con `npm run crear-usuario` y desde él restablecé la tuya |
| Error al instalar dependencias (`npm install`) | Conexión, antivirus de Windows, carpeta en OneDrive | Probá de nuevo; evitá carpetas sincronizadas con OneDrive (usá `C:\Proyectos`) |
| Gmail dejó de leer | Permiso vencido (modo Testing, cada 7 días) | **Correo → Volver a conectar** |
| Archivos rechazados con "antivirus no disponible" | ClamAV configurado pero apagado | `docker compose --profile antivirus up -d`, o quitá `CLAMAV_HOST` del `.env` |

**Único administrador sin acceso al 2FA:** con la aplicación detenida y Docker abierto:

```powershell
docker compose exec postgres psql -U comprobantepy -d comprobantepy -c "UPDATE usuarios SET totp_activo = false, totp_secreto_cifrado = NULL WHERE lower(email) = 'tu@correo.com';"
```

Al ingresar de nuevo te pide configurar el 2FA otra vez. En el servidor, el mismo comando empieza con `docker compose -f docker-compose.prod.yml exec postgres ...`.

**Ver qué está pasando:** los mensajes de error aparecen en la terminal donde corre `npm run dev`. En el servidor: `docker compose -f docker-compose.prod.yml logs --tail 200 app`.

---

## 13. Referencia rápida de comandos

### En la PC (carpeta del proyecto)

| Comando | Qué hace |
|---|---|
| Doble clic `Preparar.cmd` / `Iniciar.cmd` / `Respaldar.cmd` / `Pruebas.cmd` | Preparar, iniciar, respaldar y probar sin escribir |
| `powershell -ExecutionPolicy Bypass -File scripts\preparar.ps1` | Prepara todo (primera vez o para reparar) |
| `docker compose up -d` | Enciende la base de datos |
| `docker compose down` | Apaga la base (los datos quedan) |
| `docker compose --profile antivirus up -d` | Enciende base + antivirus |
| `npm install` | Instala/actualiza dependencias |
| `npm run db:migrate` | Crea/actualiza las tablas |
| `npm run crear-usuario -- --email X --nombre "Y" --admin` | Crea un administrador (sin `--admin`: usuario común) |
| `npm run dev` | Inicia la aplicación para usar/probar (<http://localhost:5173>) |
| `npm run build` | Compila para producción |
| `npm start` | Inicia la versión compilada (<http://localhost:3000>) |
| `npm run worker` | Inicia el trabajador de la versión compilada |
| `npm test` | Pruebas automáticas (con `TEST_DATABASE_URL`, ver [8](#8-pruebas-automáticas)) |
| `npm run typecheck` | Revisa errores de tipos |
| `npm run respaldo` | Crea un respaldo |
| `npm run respaldo -- probar` | Prueba restaurar el último respaldo |
| `npm run respaldo -- listar` | Lista los respaldos |
| `npm run medir-lectura -w @comprobantepy/api -- carpeta` | Mide la exactitud del OCR con fotos reales (ver README) |
| `git pull` | Trae los últimos cambios de GitHub |
| `git status` | Muestra qué cambió en tu carpeta |

### En el servidor (carpeta `/opt/comprobantepy`)

| Comando | Qué hace |
|---|---|
| `docker compose -f docker-compose.prod.yml up -d --build` | Construye e inicia / actualiza |
| `docker compose -f docker-compose.prod.yml ps` | Estado de los servicios |
| `docker compose -f docker-compose.prod.yml logs -f app` | Mensajes de la aplicación |
| `docker compose -f docker-compose.prod.yml restart` | Reinicia |
| `docker compose -f docker-compose.prod.yml exec app node apps/api/dist/scripts/crear-usuario.js --email X --nombre "Y" --admin` | Crea un administrador |
| `docker compose -f docker-compose.prod.yml exec worker node apps/api/dist/scripts/respaldo.js` | Respaldo ahora |
| `docker compose -f docker-compose.prod.yml exec worker node apps/api/dist/scripts/respaldo.js probar` | Prueba el último respaldo |
| `docker compose -f docker-compose.prod.yml cp worker:/respaldos ./respaldos` | Saca los respaldos del contenedor |

---

## 14. Referencia del archivo .env

| Variable | Para qué | Ejemplo / valor por defecto |
|---|---|---|
| `DATABASE_URL` | Conexión a la base | `postgres://comprobantepy:comprobantepy@localhost:5432/comprobantepy` |
| `CLAVE_CIFRADO` | Cifra archivos y secretos. **No perder, no cambiar** | 44 caracteres en base64 |
| `PORT` | Puerto de la API | `3000` |
| `NODE_ENV` | `development` en la PC, `production` en el servidor | `development` |
| `URL_PUBLICA` | Dirección con la que se entra a la aplicación | `http://localhost:5173` (PC) / `https://tu-dominio` |
| `SESION_HORAS` | Horas hasta que pide ingresar de nuevo | `12` |
| `TAMANO_MAXIMO_ARCHIVO_MB` | Tamaño máximo por archivo | `20` |
| `CARPETA_ARCHIVOS` | Dónde se guardan los archivos | `datos/archivos` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Conexión con Gmail | vacío = sin Gmail |
| `CORREO_INTERVALO_MINUTOS` | Cada cuánto se revisa el correo | `5` |
| `CLAMAV_HOST` / `CLAMAV_PORT` | Antivirus | vacío = sin antivirus; `localhost` (PC) / `clamav` (servidor); `3310` |
| `CARPETA_RESPALDOS` | Dónde se guardan los respaldos | `datos/respaldos` |
| `RESPALDO_DIARIO_HORA` | Hora del respaldo automático (0–23) | vacío = desactivado |
| `RESPALDOS_CONSERVAR` | Cuántos respaldos guardar | `14` |
| Solo servidor: `DOMINIO`, `POSTGRES_ADMIN_PASSWORD`, `APP_DB_PASSWORD` | Dominio y contraseñas de la base | ver `.env.prod.example` |

Después de cambiar el `.env`, **reiniciá** la aplicación (`Ctrl + C` y `npm run dev`; en el servidor `docker compose -f docker-compose.prod.yml up -d`).

---

## 15. Glosario: estados y perfiles

**Estados de un comprobante (flujo):**

| Estado | Significa |
|---|---|
| Faltan datos | Falta algún dato obligatorio |
| Falta asignar contribuyente | No se sabe a quién corresponde |
| Proveedor a confirmar | El emisor es nuevo y hay que confirmarlo |
| Posible duplicado | Se parece a otro ya cargado |
| Pendiente de revisión | Completo y listo para que alguien lo confirme |
| Confirmado | Revisado por un auxiliar o financiero |
| Aprobado | Aprobado por el financiero: si es físico, puede exportarse |
| Observado | Tiene algo para corregir (por ejemplo, rechazado por la DNIT) |
| Rechazado | No corresponde registrarlo |
| Anulado | Dado de baja (con motivo); no cuenta |

Los cinco primeros los calcula el sistema solo; los demás se alcanzan con los botones. Que un comprobante se haya exportado se ve aparte, en su **estado en Marangatu**.

**Naturaleza:** *Físico* (factura de papel con timbrado; **se exporta** a Marangatu), *Electrónico* (SIFEN, con CDC; **no se exporta**, ya lo informa el emisor), *Virtual* (no se exporta).

**Estado en Marangatu:** incluido en lote → enviado → aceptado o rechazado por la DNIT. Un comprobante aceptado solo se corrige con **Nueva versión**.

**Perfiles:** Consulta (mira), Auxiliar (carga y confirma), Financiero (aprueba, exporta, IRP-RSP; con 2FA), Administrador (usuarios y contribuyentes; con 2FA). Los perfiles se asignan **por contribuyente**.

---

## 16. Puntos pendientes de confirmar

Antes de usarlo en serio, confirmá con el contador o con una prueba real:

1. **Formato del archivo de Marangatu** (delimitador y fin de línea): se confirma con la importación de prueba (Prueba 4). Hoy: TXT con tabulaciones y salto de línea `\n`.
2. **Obligación 955 o 956** de cada contribuyente.
3. **Tasas y tramos del IRP-RSP**, redondeo y tipo de cambio para moneda extranjera.
4. **Exactitud del OCR** con fotos reales del celular (medir con `npm run medir-lectura`).
5. **Comprobantes virtuales:** hoy se reconocen por la leyenda "comprobante virtual" o marcando al proveedor.
6. **Verificación de timbrados y SIFEN:** por ahora es manual, con captura como evidencia.
7. **No implementado todavía:** verificación criptográfica de la firma del XML (solo avisa si falta), conciliación contra el listado de Marangatu y respuestas automáticas a remitentes.

---

*Si algo falla, anotá: qué estabas haciendo, el mensaje de error completo (copiado de la pantalla o de la terminal) y una captura. Con eso cualquier persona con conocimientos técnicos (o un asistente de IA) puede ayudarte a resolverlo.*
