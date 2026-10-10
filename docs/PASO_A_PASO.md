# Implementación y verificación paso a paso

Esta guía lleva de una notebook con Windows de 64 bits a ComprobantePy funcionando y verificado. Cada paso dice para qué sirve, qué hacer, qué tiene que salir y qué hacer si falla, y termina con una casilla para marcar.

## Cómo usar esta guía

Hacé los pasos en orden: uno a la vez, y recién al ver el resultado esperado pasá al siguiente.

- **Los comandos** (texto en recuadro gris) se escriben en la **terminal de VS Code**: menú **Terminal → Nueva terminal**. Se copian, se pegan y se presiona **Enter**.
- **Los archivos `.cmd`** (`Preparar.cmd`, `Iniciar.cmd`, `Respaldar.cmd`, `Pruebas.cmd`) se ejecutan de dos formas: escribiendo `.\Preparar.cmd` en la terminal de VS Code, o con doble clic en el **Explorador de archivos de Windows** (en VS Code: clic derecho sobre el archivo → **Mostrar en el Explorador de archivos**).
- **Si un paso falla,** probá la alternativa de ese paso. Si sigue fallando, anotá el número de paso y copiá el mensaje completo de la terminal.

| Dato | Completar |
| --- | --- |
| Fecha | |
| Responsable | |
| Equipo | |
| Carpeta del proyecto | C:\Proyectos\comprobantepy |

## Parte A: preparar la notebook

Se hace una sola vez. Instala los programas que necesita ComprobantePy.

### Paso 1. Verificar la virtualización

**Para qué sirve:** Docker funciona dentro de una máquina virtual liviana (WSL 2); el procesador necesita la virtualización activada.

**Qué hacer:** apretá **Ctrl + Shift + Esc** → **Rendimiento** → **CPU**.

**Qué tiene que salir:** abajo a la derecha dice **Virtualización: Habilitado**.

**Si falla (dice «Deshabilitado»):**

- Reiniciá la notebook y presioná **F2** varias veces al ver el logo de Acer.
- En la pestaña **Advanced** o **Main**, poné **Intel Virtualization Technology** en **Enabled**.
- Guardá con **F10 → Yes**.

- [ ] Paso 1 verificado

### Paso 2. Instalar WSL 2

**Para qué sirve:** es el subsistema Linux de Windows sobre el que corre Docker Desktop.

**Qué hacer:** clic derecho en el botón Inicio → **Terminal (administrador)** y ejecutá:

```
wsl --install
```

Después reiniciá la notebook.

**Qué tiene que salir:** al ejecutar `wsl --status` aparece **Versión predeterminada: 2**.

**Si falla:**

- «wsl no se reconoce»: actualizá Windows en **Configuración → Windows Update** y repetí.
- Error 0x80370102: la virtualización está apagada; volvé al Paso 1.
- Alternativa: **Panel de control → Programas → Activar o desactivar las características de Windows** → marcá **Plataforma de máquina virtual** y **Subsistema de Windows para Linux** → Aceptar → reiniciá.

- [ ] Paso 2 verificado

### Paso 3. Instalar Node.js

**Para qué sirve:** es el motor que ejecuta el programa (la API, la web y el lector de fotos).

**Qué hacer:** en la **Terminal (administrador)**:

```
winget install --id OpenJS.NodeJS.LTS -e
```

**Qué tiene que salir:** al cerrar y abrir la terminal, `node -v` muestra **v22** o un número mayor.

**Si falla:**

- «winget no se reconoce»: descargalo de **nodejs.org** → **LTS** → **Windows Installer (.msi) 64-bit** → Next en todo, con **Add to PATH** marcado.
- `node -v` sigue sin reconocerse: cerrá todas las terminales y VS Code; si sigue igual, reiniciá la PC.
- Muestra v18 o v20: desinstalá esa versión en **Configuración → Aplicaciones** e instalá la LTS.

- [ ] Paso 3 verificado

### Paso 4. Instalar Docker Desktop

**Para qué sirve:** corre la base de datos PostgreSQL dentro de un contenedor, sin instalarla en Windows.

**Qué hacer:** en la **Terminal (administrador)**:

```
winget install --id Docker.DockerDesktop -e
```

Reiniciá. Abrí **Docker Desktop** desde Inicio, aceptá los términos y, si pide cuenta, tocá **Skip**.

**Qué tiene que salir:** abajo a la izquierda dice **Engine running**, y `docker info` no da error.

**Si falla:**

- Sin winget: descargalo de **docker.com/products/docker-desktop** → **Download for Windows – AMD64** → instalá con **Use WSL 2** marcado.
- «WSL 2 is not installed» o «WSL update failed»: ejecutá `wsl --update` en la Terminal (administrador), o volvé al Paso 2.
- Queda en «Starting…»: ícono de la ballena (abajo a la derecha) → **Quit**, y abrilo de nuevo; si sigue, reiniciá la PC.
- «Virtualization support not detected»: volvé al Paso 1.

- [ ] Paso 4 verificado

### Paso 5. Verificar Git

**Para qué sirve:** descarga el proyecto desde GitHub y lo mantiene actualizado.

**Qué hacer:**

```
git --version
```

**Qué tiene que salir:** **git version 2.x**.

**Si falla:** `winget install --id Git.Git -e`, o descargalo de **git-scm.com** → **Download for Windows** → Next en todo. Después cerrá y abrí la terminal.

- [ ] Paso 5 verificado

## Parte B: instalar el programa

Se hace una sola vez. Los pasos 8 a 13 los hace juntos `Preparar.cmd` (ver el atajo al final de esta parte).

### Paso 6. Descargar el proyecto

**Para qué sirve:** trae el código a la PC, en la rama donde está todo el trabajo.

**Qué hacer:**

```
cd C:\
mkdir Proyectos
cd Proyectos
git clone -b claude/serene-knuth-9f54ys https://github.com/kanamepy/comprobantepy.git
cd comprobantepy
code .
```

**Qué tiene que salir:** se abre VS Code y en el panel izquierdo se ven `Preparar.cmd`, `Iniciar.cmd`, `GUIA.md` y `package.json`.

**Si falla:**

- «mkdir: ya existe»: seguí con el comando siguiente.
- «Repository not found» o pide usuario: en VS Code **F1** → **Git: Clone** → **Clone from GitHub** → iniciá sesión → `kanamepy/comprobantepy`. Después, abajo a la izquierda, clic en `main` → `origin/claude/serene-knuth-9f54ys`.
- Ya estaba descargado y faltan esos archivos: `git fetch origin` y después `git checkout claude/serene-knuth-9f54ys`.
- «code no se reconoce»: abrí VS Code → **Archivo → Abrir carpeta** → `C:\Proyectos\comprobantepy`.
- Evitá carpetas sincronizadas con OneDrive (Escritorio, Documentos).

- [ ] Paso 6 verificado

### Paso 7. Abrir la terminal en VS Code

**Para qué sirve:** todos los comandos siguientes se ejecutan dentro de la carpeta del proyecto.

**Qué hacer:** en VS Code, menú **Terminal → Nueva terminal**.

**Qué tiene que salir:** abajo aparece una línea que termina en `C:\Proyectos\comprobantepy>`.

**Si falla:** escribí `cd C:\Proyectos\comprobantepy`.

- [ ] Paso 7 verificado

### Paso 8. Crear la configuración (.env)

**Para qué sirve:** el archivo `.env` guarda la conexión a la base y la clave que cifra los archivos. Es propio de la PC y no se sube a GitHub.

**Qué hacer:**

```
Copy-Item .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Copiá el texto que imprime el segundo comando. Abrí `.env` en VS Code, pegalo después de `CLAVE_CIFRADO=` y guardá con **Ctrl + S**.

**Qué tiene que salir:** la línea queda así: `CLAVE_CIFRADO=AbC123...=`.

**Si falla:** si `Copy-Item` da error, usá `copy .env.example .env`. Si no ves `.env` en el panel, recargalo con la flecha circular.

> Guardá la CLAVE_CIFRADO fuera de la PC (gestor de contraseñas). Sin ella no se pueden abrir los archivos guardados ni los respaldos.

- [ ] Paso 8 verificado y clave guardada aparte

### Paso 9. Levantar la base de datos

**Para qué sirve:** crea y enciende el contenedor de PostgreSQL. La primera vez descarga unos 150 MB.

**Qué hacer** (con Docker Desktop abierto):

```
docker compose up -d
```

**Qué tiene que salir:** `Container comprobantepy-postgres-1 Started`.

**Si falla:**

- «Cannot connect to the Docker daemon»: esperá a ver **Engine running** y repetí.
- «port is already allocated» o «5432»: hay otro PostgreSQL instalado. **Windows + R** → `services.msc` → `postgresql-x64-…` → **Detener**, y repetí. Alternativa: en `docker-compose.yml` cambiá `"5432:5432"` por `"5433:5432"` y en `.env` `localhost:5432` por `localhost:5433`.

- [ ] Paso 9 verificado

### Paso 10. Instalar las dependencias

**Para qué sirve:** descarga las librerías que usa el programa (unas 700) a la carpeta `node_modules`.

**Qué hacer:**

```
npm.cmd install
```

**Qué tiene que salir:** termina con `added 7xx packages`. Los avisos «npm warn» y «vulnerabilities» son normales.

**Si falla:**

- «ejecución de scripts deshabilitada»: escribí `npm.cmd`, no `npm`.
- Error de red: repetí el comando.
- EPERM o archivo en uso: cerrá otras terminales, mové la carpeta fuera de OneDrive y repetí.

- [ ] Paso 10 verificado

### Paso 11. Crear las tablas

**Para qué sirve:** crea la estructura de la base de datos.

**Qué hacer:**

```
npm.cmd run db:migrate
```

**Qué tiene que salir:** **Migraciones aplicadas.**

**Si falla:**

- «ECONNREFUSED»: la base no está encendida; repetí el Paso 9.
- «password authentication failed»: si la base no tiene datos importantes, `docker compose down -v`, `docker compose up -d` y repetí.
- «Falta la variable DATABASE_URL»: falta `.env`; volvé al Paso 8.

- [ ] Paso 11 verificado

### Paso 12. Crear la base de pruebas

**Para qué sirve:** una base aparte para las pruebas automáticas; se borra en cada prueba.

**Qué hacer:**

```
docker compose exec postgres createdb -U comprobantepy comprobantepy_test
```

**Qué tiene que salir:** no muestra nada (salió bien). Si dice «already exists», ya estaba creada.

- [ ] Paso 12 verificado

### Paso 13. Crear el usuario administrador

**Para qué sirve:** el primer usuario para entrar a la aplicación.

**Qué hacer:**

```
npm.cmd run crear-usuario -- --email tu@correo.com --nombre "Tu nombre" --admin
```

Pide una contraseña de 10 caracteres o más; mientras se escribe no se ve nada.

**Qué tiene que salir:** confirma la creación y avisa que al iniciar sesión se configura el segundo factor.

**Si falla:** «Ya existe un usuario»: usá ese. «La contraseña debe tener…»: usá una más larga.

- [ ] Paso 13 verificado

### Atajo: Preparar.cmd

Hace los pasos 8 a 13 de una vez. En la terminal de VS Code:

```
.\Preparar.cmd
```

O doble clic en `Preparar.cmd` desde el Explorador de archivos. Si aparece «Windows protegió su PC»: **Más información → Ejecutar de todas formas**. Al terminar dice **Todo listo.**

## Parte C: usar el programa

Se repite cada vez que se usa ComprobantePy.

### Paso 14. Iniciar

**Para qué sirve:** enciende la API, la web y el lector de fotos y correo.

**Qué hacer** (con Docker Desktop abierto):

```
.\Iniciar.cmd
```

O bien, comando por comando:

```
docker compose up -d
npm.cmd run dev
```

**Qué tiene que salir:** se abre el navegador en `http://localhost:5173`. La terminal queda ocupada mostrando mensajes: es normal.

**Si falla:**

- «port 3000/5173 already in use»: cerrá las otras terminales (ícono del tacho) o reiniciá VS Code.
- La página no abre: esperá 20 segundos y presioná **F5**.

- [ ] Paso 14 verificado

### Paso 15. Entrar

**Para qué sirve:** ingresar y activar el segundo factor de seguridad.

**Qué hacer:** correo y contraseña del Paso 13 → escaneá el QR con **Google Authenticator** en el celular → escribí los 6 números → **Confirmar**.

**Qué tiene que salir:** la pantalla **Inicio** con el menú arriba y «Hola, …».

**Si falla:** «Código inválido»: la hora del celular tiene que ser automática (**Ajustes → Fecha y hora**).

- [ ] Paso 15 verificado

### Paso 16. Apagar

**Qué hacer:** `Ctrl + C` en la terminal, o cerrá la ventana de `Iniciar.cmd`. Para apagar también la base: `docker compose down` (los datos se conservan).

> Nunca uses `docker compose down -v`: borra la base de datos.

- [ ] Paso 16 verificado

## Parte D: verificar que funciona

### Paso 17. Pruebas automáticas

**Para qué sirve:** unas 177 pruebas que comprueban que todo el programa funciona.

**Qué hacer:**

```
.\Pruebas.cmd
```

**Qué tiene que salir:** al final, `Tests 85 passed` y `Tests 92 passed`.

**Si falla:** copiá las líneas que tienen **×** o **FAIL**.

- [ ] Paso 17 verificado

### Paso 18. Pruebas con facturas reales

**Para qué sirve:** comprobar que el programa sirve en el caso real.

| N.° | Qué hacer | Resultado esperado | OK | Observaciones |
| --- | --- | --- | --- | --- |
| 18.1 | **Contribuyentes → ＋ Agregar**: nombre, RUC con DV, obligación 955/956 y obligaciones con fecha desde | El contribuyente aparece en la lista | ☐ | |
| 18.2 | **Cargar**: un XML de factura electrónica y su PDF | Queda un solo comprobante con los dos archivos | ☐ | |
| 18.3 | **Cargar**: una factura física en PDF y una foto con el celular | La foto muestra «Leyendo…» y en segundos completa los datos | ☐ | |
| 18.4 | Cargar otra vez el mismo archivo | Responde «Ya estaba cargado» y no duplica | ☐ | |
| 18.5 | **Bandeja**: abrir cada comprobante y corregir lo marcado en amarillo | Los cambios se guardan | ☐ | |
| 18.6 | **Proveedores**: confirmar el proveedor nuevo | Deja de figurar «A confirmar» | ☐ | |
| 18.7 | Imputar (por ejemplo, 100 % IVA) → **Confirmar** → **Aprobar** | Estado **Aprobado** y «Listo para exportar» si es físico | ☐ | |
| 18.8 | **Exportar**: período → **Generar** → descargar el ZIP | Se descarga el ZIP del lote | ☐ | |
| 18.9 | Importar el ZIP en Marangatu con 2 o 3 comprobantes | Marangatu acepta el archivo | ☐ | |
| 18.10 | Registrar en el lote el resultado de la DNIT | Aceptados quedan «Aceptado por la DNIT» | ☐ | |
| 18.11 | **Reporte**: período del contribuyente → descargar Excel | Totales coinciden con lo aprobado | ☐ | |
| 18.12 | **IRP-RSP**: cargar un ingreso y revisar el Resumen | Muestra los escenarios confirmado y proyectado | ☐ | |
| 18.13 | **Usuarios**: crear un usuario Consulta y entrar con él | Solo ve su contribuyente y no puede modificar | ☐ | |

**Si Marangatu rechaza el archivo:** copiá el mensaje exacto; es un ajuste de formato (delimitador o fin de línea).

- [ ] Paso 18 verificado

### Paso 19. Respaldo

**Para qué sirve:** copia la base y los archivos, y comprueba que se puedan recuperar.

**Qué hacer:**

```
.\Respaldar.cmd
```

**Qué tiene que salir:** **El respaldo se puede restaurar.** Los respaldos quedan en `datos\respaldos`.

**Si falla:** revisá que Docker esté abierto y copiá el mensaje de error.

- [ ] Paso 19 verificado

## Puesta en marcha segura

Antes de usarlo con datos reales, confirmá cada punto.

| Punto | OK | Observaciones |
| --- | --- | --- |
| CLAVE_CIFRADO guardada fuera de la PC | ☐ | |
| Administrador y Financieros con segundo factor activo | ☐ | |
| Respaldo semanal copiado a disco externo o nube | ☐ | |
| Cada persona de la familia con su propio usuario y perfil | ☐ | |
| Importación de prueba en Marangatu aceptada | ☐ | |
| Obligación 955/956 y tasas del IRP-RSP confirmadas con el contador | ☐ | |

## Si algo falla

| Mensaje o síntoma | Qué hacer |
| --- | --- |
| node no se reconoce | Cerrá y abrí VS Code; si sigue, reiniciá la PC |
| ejecución de scripts deshabilitada | Usá `npm.cmd` en vez de `npm` |
| Cannot connect to the Docker daemon | Abrí Docker Desktop y esperá **Engine running** |
| Virtualization support not detected | Volvé al Paso 1 |
| port is already allocated / 5432 | Detené el otro PostgreSQL en `services.msc` |
| password authentication failed | Sin datos importantes: `docker compose down -v` y repetí desde el Paso 9 |
| La foto queda «Leyendo…» | El lector se inicia con `Iniciar.cmd`; cerralo y abrilo de nuevo |
| La página no abre | Esperá 20 segundos y presioná F5 |

Más casos: sección 12 de `GUIA.md`.

## Resultado de la implementación

| Resultado | OK |
| --- | --- |
| Implementación completa, sin observaciones | ☐ |
| Implementación completa, con observaciones anotadas | ☐ |
| Implementación incompleta: pasos pendientes anotados | ☐ |

| Firma | Fecha |
| --- | --- |
| | |
