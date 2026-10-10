# Publicar ComprobantePy en internet

Esta guía pone ComprobantePy en un servidor en la nube, con un dominio propio `.com.py` y candado HTTPS, para usarlo desde cualquier lugar y desde el celular. Cada paso dice para qué sirve, qué datos te piden, qué hacer, qué tiene que salir y qué hacer si falla.

## Cómo usar esta guía

Publicar es **opcional**: para uso en la casa alcanza con la PC y `Iniciar.cmd`. Publicá recién cuando la implementación local esté verificada (`docs/PASO_A_PASO.md`).

El recorrido tiene cuatro piezas, en este orden:

1. **Servidor en la nube (DigitalOcean):** la computadora que queda encendida en internet.
2. **DNS (también en DigitalOcean):** la «guía telefónica» que dice que tu dominio apunta a ese servidor.
3. **Dominio `.com.py` (NIC.py):** el nombre que se escribe en el navegador. Lo administra **NIC-PY**, servicio del **CNC** (Centro Nacional de Computación de la UNA) junto con el LED de la Universidad Católica.
4. **Instalación en el servidor:** el programa con HTTPS automático.

| Concepto | Costo aproximado | Frecuencia |
| --- | --- | --- |
| Servidor DigitalOcean, 2 GB de memoria | 12 USD | Mensual |
| Servidor de 4 GB (si usás antivirus) | 24 USD | Mensual |
| DNS de DigitalOcean | Gratis | — |
| Dominio .com.py en NIC.py | G. 160.000 más comisión de pago | Anual |
| Certificado HTTPS (Let's Encrypt, automático) | Gratis | — |

> Los precios cambian: confirmá la tarifa vigente en nic.py y en digitalocean.com antes de pagar.

## Parte A: datos y elementos a preparar

Tené esto a mano antes de empezar: son los datos que piden DigitalOcean y NIC.py.

| Dato | Para qué | Dónde se usa | Listo |
| --- | --- | --- | --- |
| Correo electrónico propio (que leas seguido) | Cuentas, confirmaciones y avisos de vencimiento | DigitalOcean y NIC.py | ☐ |
| Tarjeta de crédito o débito habilitada para compras internacionales (o PayPal) | Pagar el servidor en dólares | DigitalOcean | ☐ |
| Documento de identidad (cédula o pasaporte) y celular con cámara | Posible verificación de identidad | DigitalOcean | ☐ |
| Nombre completo o razón social tal como figura ante la SET | Titular del dominio | NIC.py | ☐ |
| RUC con dígito verificador (o cédula) | Titular del dominio | NIC.py | ☐ |
| Dirección, ciudad y teléfono | Titular y contactos | NIC.py | ☐ |
| Datos de 3 contactos: administrativo, técnico y de facturación (nombre, correo, teléfono; pueden ser la misma persona) | Responsables del dominio | NIC.py | ☐ |
| 2 o 3 nombres de dominio candidatos | Por si el primero está ocupado | NIC.py | ☐ |
| Una frase de justificación del uso | Campo del formulario | NIC.py | ☐ |
| Medio de pago en guaraníes (transferencia, Aquí Pago o pago presencial) | Pagar el dominio | NIC.py | ☐ |

**Cómo elegir el nombre:** corto, fácil de dictar, solo letras, números y guiones (sin tildes ni ñ). Ejemplos: `comprobantes-familia.com.py`, `gestion-vgomez.com.py`.

- [ ] Parte A: datos reunidos

## Parte B: contratar el servidor

### Paso 1. Crear la cuenta en DigitalOcean

**Para qué sirve:** DigitalOcean alquila el servidor (le dicen «Droplet») donde va a funcionar el programa.

**Qué datos te piden:**

- Correo y contraseña (o ingresar con Google o GitHub).
- Confirmación del correo: llega un enlace que hay que abrir.
- Medio de pago: tarjeta de crédito o débito internacional, o PayPal. Puede haber un cobro de verificación pequeño que luego se devuelve.
- A veces, verificación de identidad: foto del documento y del rostro.

**Qué hacer:** entrá a **digitalocean.com** → **Sign up** → completá los datos → confirmá el correo → cargá el medio de pago.

**Qué tiene que salir:** el panel de DigitalOcean («Control Panel») con tu proyecto vacío.

**Si falla:**

- La tarjeta es rechazada: pedí al banco que habilite compras internacionales en línea, o usá PayPal.
- La cuenta queda «en revisión»: esperá el correo de DigitalOcean (suele resolverse en horas) y respondé lo que pidan.

- [ ] Paso 1 verificado

### Paso 2. Crear el servidor (Droplet)

**Para qué sirve:** crea la computadora en la nube.

**Qué datos te piden y qué elegir:**

| Opción en pantalla | Qué elegir |
| --- | --- |
| Region (región) | **New York** (la más cercana a Paraguay entre las de DigitalOcean) |
| Image (sistema) | **Ubuntu 24.04 (LTS) x64** |
| Size (tamaño) | **Basic → Regular → 2 GB / 1 CPU** (12 USD/mes); **4 GB** si vas a usar antivirus |
| Authentication (acceso) | **Password**: inventá una contraseña larga y guardala en tu gestor de contraseñas |
| Hostname (nombre) | `comprobantepy` |
| Backups (copias de DigitalOcean) | Opcional; el programa ya hace sus propios respaldos |

**Qué hacer:** en el panel, **Create → Droplets** → elegí lo de la tabla → **Create Droplet**.

**Qué tiene que salir:** en un minuto aparece el Droplet con una **dirección IP** (por ejemplo `164.90.12.34`). **Anotala:** se usa en los pasos siguientes.

**Si falla:** si no deja crear el Droplet, la cuenta todavía está en verificación (Paso 1).

| Dato a anotar | Valor |
| --- | --- |
| IP del servidor | |
| Contraseña del usuario root | (guardada en el gestor de contraseñas) |

- [ ] Paso 2 verificado

### Paso 3. Preparar el DNS en DigitalOcean

**Para qué sirve:** el DNS le dice a internet que tu dominio apunta a la IP del servidor. NIC.py pide los servidores DNS **al solicitar** el dominio, por eso se prepara antes.

**Qué hacer:**

1. En el panel: **Networking → Domains**.
2. Escribí tu dominio (por ejemplo `comprobantes-familia.com.py`) y elegí tu proyecto → **Add Domain**.
3. Creá dos registros de tipo **A**:

| Type (tipo) | Hostname | Will direct to | TTL |
| --- | --- | --- | --- |
| A | @ | tu Droplet `comprobantepy` (la IP del Paso 2) | 3600 |
| A | www | tu Droplet `comprobantepy` | 3600 |

**Qué tiene que salir:** el dominio aparece en la lista con sus registros, y arriba se ven los servidores de nombres (NS) de DigitalOcean:

```
ns1.digitalocean.com
ns2.digitalocean.com
ns3.digitalocean.com
```

Estos tres nombres son los que vas a cargar en NIC.py.

**Si falla:** si el dominio ya figura en otra cuenta de DigitalOcean, escribí a soporte de DigitalOcean.

- [ ] Paso 3 verificado

## Parte C: registrar el dominio .com.py en NIC.py

### Paso 4. Verificar que el nombre esté libre

**Para qué sirve:** confirmar que nadie registró ese nombre.

**Qué hacer:** entrá a **www.nic.py** → buscador de dominios («Registro de dominios» / «Whois») → escribí el nombre sin `www`.

**Qué tiene que salir:** el sistema dice que el dominio está **disponible** y ofrece el formulario de solicitud.

**Si falla (está ocupado):** probá con tus nombres candidatos de la Parte A.

- [ ] Paso 4 verificado

### Paso 5. Completar el formulario de solicitud

**Para qué sirve:** pedir la delegación del dominio a tu nombre.

**Qué datos te piden** (según el formulario de delegación de NIC.py):

| Sección | Datos |
| --- | --- |
| Dominio | Nombre completo, por ejemplo `comprobantes-familia.com.py` |
| Solicitante | Correo electrónico (llega la confirmación) |
| Justificación | Frase breve, por ejemplo: «Sistema familiar de gestión de comprobantes tributarios» |
| Servidores DNS | **Primario:** `ns1.digitalocean.com` · **Secundario:** `ns2.digitalocean.com` · **Alternativo:** `ns3.digitalocean.com` |
| Organización o titular | Nombre o razón social como figura ante la SET, RUC con DV (o cédula), dirección, ciudad y teléfono |
| Contacto administrativo | Nombre, correo, teléfono y dirección; puede modificar los datos de los demás contactos |
| Contacto técnico | Nombre, correo y teléfono; administra los servidores DNS |
| Contacto de facturación | Nombre, correo, teléfono y datos fiscales; recibe los avisos de pago y renovación |

**Qué hacer:** completá el formulario con los datos de la Parte A y los DNS del Paso 3 → **Enviar**.

**Qué tiene que salir:** un mensaje de solicitud recibida y, en tu correo, un **e-mail de confirmación** del NIC (remitente del CNC).

**Si falla:**

- Errores frecuentes: datos incompletos, DNS mal escritos o correos con errores. Revisá letra por letra.
- No llega el correo: revisá **Spam** o «Promociones».

> Tip: los tres contactos pueden ser la misma persona, pero el correo debe ser uno que leas seguido; ahí llegan los avisos de vencimiento.

- [ ] Paso 5 verificado

### Paso 6. Confirmar la solicitud por correo

**Para qué sirve:** NIC.py exige confirmar la solicitud desde el correo del solicitante (o del contacto administrativo o técnico).

**Qué hacer:** abrí el correo del NIC y hacé clic en el enlace de confirmación.

**Qué tiene que salir:** la solicitud pasa a **estudio de aprobación**: el NIC revisa que cumpla las pautas.

**Si falla:** si el enlace venció, volvé a enviar la solicitud o escribí a la mesa de ayuda del NIC (datos de contacto en nic.py).

- [ ] Paso 6 verificado

### Paso 7. Aprobación y pago

**Para qué sirve:** activar el dominio.

**Qué hacer:**

1. Esperá el correo de **aprobación** (suele tardar unos días hábiles).
2. Pagá dentro de los **15 días** desde la aprobación; si no, se considera que desististe.
3. Medios de pago informados por NIC.py: transferencia bancaria, bocas de cobranza o pago en línea (por ejemplo, Aquí Pago) y pago presencial en el CNC, campus de la UNA en San Lorenzo. Los pagos electrónicos tienen una comisión adicional y ningún pago es reembolsable.

**Qué tiene que salir:** con el pago acreditado, el dominio pasa a estado **Activo** y los servidores del NIC lo publican.

**Si falla:** si pasaron varios días sin novedades, consultá el estado en nic.py o escribí a la mesa de ayuda.

> Renovación anual: el vencimiento es el día 25 del mes de activación y el plazo de pago termina el último día de ese mes. Agendalo en el celular.

- [ ] Paso 7 verificado

### Paso 8. Comprobar que el dominio apunta al servidor

**Para qué sirve:** confirmar que el DNS ya funciona antes de instalar (el HTTPS lo necesita).

**Qué hacer:** en la terminal de tu PC (PowerShell o la terminal de VS Code):

```
nslookup comprobantes-familia.com.py
```

**Qué tiene que salir:** en «Address» aparece la **IP del servidor** del Paso 2.

**Si falla:** la propagación puede tardar unas horas. Si después de 24 horas no aparece la IP, revisá los DNS cargados en NIC.py y los registros A del Paso 3.

- [ ] Paso 8 verificado

## Parte D: instalar el programa en el servidor

### Paso 9. Conectarse al servidor

**Para qué sirve:** entrar a la terminal del servidor para instalar.

**Qué hacer:** en la terminal de tu PC (cambiá la IP por la tuya):

```
ssh root@164.90.12.34
```

La primera vez pregunta si confiás en el servidor: escribí `yes`. Después pide la contraseña del Paso 2 (no se ve al escribir).

**Qué tiene que salir:** una línea que termina en `root@comprobantepy:~#`.

**Si falla:** «ssh no se reconoce»: en Windows, **Configuración → Aplicaciones → Características opcionales → Cliente OpenSSH**. Alternativa: en el panel de DigitalOcean, en el Droplet, botón **Console** abre la terminal en el navegador.

- [ ] Paso 9 verificado

### Paso 10. Instalar Docker y el firewall

**Para qué sirve:** Docker corre el programa; el firewall deja abiertos solo los puertos necesarios (22, 80 y 443).

**Qué hacer** (en el servidor, uno por uno):

```
apt update && apt upgrade -y
curl -fsSL https://get.docker.com | sh
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw --force enable
```

**Qué tiene que salir:** `docker --version` muestra la versión y `ufw status` muestra 22, 80 y 443 permitidos.

**Si falla:** si `apt` dice que otro proceso lo usa, esperá dos minutos (el servidor se está actualizando solo) y repetí.

- [ ] Paso 10 verificado

### Paso 11. Descargar el programa

**Qué hacer:**

```
cd /opt
git clone -b claude/serene-knuth-9f54ys https://github.com/kanamepy/comprobantepy.git
cd comprobantepy
```

**Qué tiene que salir:** la carpeta `/opt/comprobantepy` con el proyecto (`ls` muestra `Dockerfile` y `docker-compose.prod.yml`).

**Si falla (repositorio privado):** GitHub pide usuario y **token**. En GitHub: **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**, con acceso de solo lectura («Contents: Read») al repositorio `comprobantepy`. Usá tu usuario de GitHub y el token como contraseña.

- [ ] Paso 11 verificado

### Paso 12. Crear la configuración del servidor

**Para qué sirve:** el `.env` del servidor con el dominio, las contraseñas y la clave de cifrado.

**Qué hacer:**

```
cp .env.prod.example .env
openssl rand -base64 24 | tr '+/' '-_'
openssl rand -base64 24 | tr '+/' '-_'
openssl rand -base64 32
nano .env
```

Los tres `openssl` generan valores al azar: copialos en este orden en `POSTGRES_ADMIN_PASSWORD`, `APP_DB_PASSWORD` y `CLAVE_CIFRADO`. Completá también:

| Variable | Valor |
| --- | --- |
| DOMINIO | `comprobantes-familia.com.py` (sin https) |
| URL_PUBLICA | `https://comprobantes-familia.com.py` |
| POSTGRES_ADMIN_PASSWORD | primer valor generado |
| APP_DB_PASSWORD | segundo valor generado |
| CLAVE_CIFRADO | tercer valor generado |
| RESPALDO_DIARIO_HORA | `2` |
| GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET | solo si usás Gmail |

Guardar en `nano`: **Ctrl + O**, Enter. Salir: **Ctrl + X**.

> Copiá el .env completo (sobre todo CLAVE_CIFRADO) a tu gestor de contraseñas. Sin esa clave no se recuperan los archivos ni los respaldos.

- [ ] Paso 12 verificado y .env guardado aparte

### Paso 13. Construir e iniciar

**Para qué sirve:** levanta la base, el programa, el lector de fotos y **Caddy**, que obtiene y renueva solo el certificado HTTPS.

**Qué hacer** (la primera vez tarda de 5 a 10 minutos):

```
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
```

Con antivirus (servidor de 4 GB): agregá `CLAMAV_HOST=clamav` al `.env` y usá:

```
docker compose -f docker-compose.prod.yml --profile antivirus up -d --build
```

**Qué tiene que salir:** `ps` muestra `postgres`, `app`, `worker` y `caddy` en estado **running**.

**Si falla:**

- Ver qué pasa: `docker compose -f docker-compose.prod.yml logs --tail 100 app`.
- Caddy no obtiene el certificado: el dominio todavía no apunta al servidor (Paso 8) o los puertos 80/443 están cerrados (Paso 10).

- [ ] Paso 13 verificado

### Paso 14. Crear el administrador y entrar

**Qué hacer:**

```
docker compose -f docker-compose.prod.yml exec app node apps/api/dist/scripts/crear-usuario.js --email tu@correo.com --nombre "Tu nombre" --admin
```

Después abrí **https://comprobantes-familia.com.py** en el navegador, ingresá y configurá el segundo factor con Google Authenticator.

**Qué tiene que salir:** el **candado** en la barra del navegador y la pantalla de inicio de ComprobantePy.

**Si falla:** «No es seguro» o error de certificado: esperá 2 minutos y recargá; si sigue, revisá el Paso 13.

- [ ] Paso 14 verificado

## Parte E: verificar y mantener

### Paso 15. Verificación final

| Verificación | Cómo | OK |
| --- | --- | --- |
| HTTPS con candado | Abrir el dominio en el navegador | ☐ |
| Acceso desde el celular con datos móviles (sin wifi) | Abrir el dominio en el celular | ☐ |
| Segundo factor activo para administrador y financieros | Menú Usuarios | ☐ |
| Respaldo manual correcto | `docker compose -f docker-compose.prod.yml exec worker node apps/api/dist/scripts/respaldo.js probar` | ☐ |
| Firewall con solo 22, 80 y 443 | `ufw status` | ☐ |
| Base de datos sin acceso desde internet | No agregar `ports` a postgres en `docker-compose.prod.yml` | ☐ |
| Vencimiento del dominio agendado | Día 25 del mes de activación | ☐ |

- [ ] Paso 15 verificado

### Paso 16. Gmail (opcional)

Si usás la lectura de correo, en **Google Cloud → Credenciales → tu cliente OAuth** agregá como URI de redireccionamiento autorizado:

```
https://comprobantes-familia.com.py/api/correo/oauth/callback
```

Después, en la aplicación: **Correo → Conectar con Google**.

- [ ] Paso 16 verificado

### Mantenimiento

| Tarea | Comando en el servidor (carpeta /opt/comprobantepy) | Frecuencia |
| --- | --- | --- |
| Actualizar a la versión nueva | `git pull` y `docker compose -f docker-compose.prod.yml up -d --build` | Cuando haya cambios |
| Probar el último respaldo | `docker compose -f docker-compose.prod.yml exec worker node apps/api/dist/scripts/respaldo.js probar` | Mensual |
| Copiar respaldos fuera del servidor | `docker compose -f docker-compose.prod.yml cp worker:/respaldos ./respaldos` y desde la PC `scp -r root@IP:/opt/comprobantepy/respaldos C:\Respaldos` | Semanal |
| Actualizar Ubuntu | `apt update && apt upgrade -y` | Mensual |
| Renovar el dominio en NIC.py | Pago anual | Anual |

## Alternativa sin dominio .com.py

Si NIC.py demora o preferís empezar ya, podés usar un subdominio gratuito de **DuckDNS** (por ejemplo `comprobantes-familia.duckdns.org`), que también obtiene candado HTTPS con Caddy:

1. Entrá a **duckdns.org** e ingresá con Google o GitHub.
2. Escribí el nombre del subdominio → **add domain**.
3. En **current ip** poné la IP del servidor (Paso 2) → **update ip**.
4. En el `.env` del servidor usá `DOMINIO=comprobantes-familia.duckdns.org` y `URL_PUBLICA=https://comprobantes-familia.duckdns.org`.
5. Seguí desde el Paso 9. Más adelante podés pasar al `.com.py` cambiando esas dos variables y reiniciando.

## Si algo falla

| Síntoma | Qué hacer |
| --- | --- |
| nslookup no muestra la IP | Esperar hasta 24 horas; revisar DNS en NIC.py y registros A en DigitalOcean |
| El navegador dice «No es seguro» | El dominio aún no apunta al servidor o 80/443 cerrados (Pasos 8 y 10) |
| ssh: Connection refused o timeout | Revisar la IP; usar la Console del panel de DigitalOcean |
| GitHub pide usuario y contraseña | Usar un token de solo lectura (Paso 11) |
| La página muestra «502» | El programa está arrancando: esperar 1 minuto; si sigue, ver los logs de app |
| Olvidé la contraseña del servidor | Panel de DigitalOcean → Droplet → **Access → Reset root password** |

## Fuentes

Requisitos y tarifas de NIC.py según su sitio y guías publicadas; confirmalos en nic.py antes de pagar, porque cambian:

- [NIC-PY: registro de dominios](https://www.nic.py/registro.php)
- [NIC-PY: procedimientos](https://www.nic.py/procedimientos.php)
- [NIC-PY: políticas de delegación](https://www.nic.py/politicas-de-delegacion.php)
- [NIC-PY: tarifario](https://nic.py/costos.php)
- [Blog de Personal: cómo registrar un dominio .com.py](https://blog.personal.com.py/como-registrar-un-dominio-com-py-en-paraguay/)
- [DigitalOcean: precios de Droplets](https://www.digitalocean.com/pricing/droplets)
