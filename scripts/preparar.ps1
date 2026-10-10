<#
  Prepara ComprobantePy en esta PC (Windows), paso a paso:
    1. Verifica Node.js 22+ y Docker Desktop (ofrece instalarlos con winget).
    2. Crea el archivo .env con una clave de cifrado nueva.
    3. Levanta PostgreSQL, instala dependencias y crea las tablas.
    4. Crea la base de pruebas y, si querés, tu usuario administrador.
  Se puede ejecutar las veces que haga falta: lo que ya está hecho se saltea.

  Uso (desde la carpeta del proyecto, en la terminal de VS Code):
    powershell -ExecutionPolicy Bypass -File scripts\preparar.ps1
#>
$ErrorActionPreference = "Stop"
$raiz = Split-Path -Parent $PSScriptRoot
Set-Location $raiz
$enWindows = $env:OS -eq "Windows_NT"
$npm = if ($enWindows) { "npm.cmd" } else { "npm" }

function Paso([string]$texto) { Write-Host "`n==> $texto" -ForegroundColor Cyan }
function Bien([string]$texto) { Write-Host "    OK  $texto" -ForegroundColor Green }
function Falla([string]$texto) {
  Write-Host "`n[X] $texto" -ForegroundColor Red
  exit 1
}
function Ejecutar([string]$programa, [string[]]$argumentos, [string]$siFalla) {
  & $programa @argumentos
  if ($LASTEXITCODE -ne 0) { Falla $siFalla }
}
function Preguntar([string]$texto) {
  $respuesta = Read-Host "$texto (s/n)"
  return $respuesta -match '^(s|si|sí|y|yes)$'
}
function Instalar([string]$nombre, [string]$idWinget) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Falla "Falta $nombre. Instalalo desde su página (ver README) y volvé a ejecutar este script."
  }
  if (-not (Preguntar "Falta $nombre. ¿Lo instalo ahora con winget?")) {
    Falla "Instalá $nombre y volvé a ejecutar este script."
  }
  Ejecutar "winget" @("install", "--id", $idWinget, "-e", "--accept-package-agreements", "--accept-source-agreements") "No se pudo instalar $nombre."
  Write-Host "`n$nombre quedó instalado. Cerrá VS Code, abrilo de nuevo y volvé a ejecutar este script." -ForegroundColor Yellow
  exit 0
}

# --- 1. Programas -------------------------------------------------------------
Paso "Verificando Node.js"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Instalar "Node.js" "OpenJS.NodeJS.LTS" }
$versionNode = (& node -v).TrimStart("v")
if ([int]($versionNode.Split(".")[0]) -lt 22) {
  Write-Host "    Tenés Node.js $versionNode y se necesita la 22 o superior." -ForegroundColor Yellow
  Instalar "Node.js (versión nueva)" "OpenJS.NodeJS.LTS"
}
Bien "Node.js $versionNode"

Paso "Verificando Docker Desktop"
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Host "    Docker Desktop necesita WSL 2; si Windows lo pide, aceptá y reiniciá la PC." -ForegroundColor Yellow
  Instalar "Docker Desktop" "Docker.DockerDesktop"
}
& docker info *> $null
if ($LASTEXITCODE -ne 0) {
  $escritorio = Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"
  if ($enWindows -and (Test-Path $escritorio)) {
    Write-Host "    Abriendo Docker Desktop (puede tardar un par de minutos)..."
    Start-Process $escritorio
  }
  $listo = $false
  for ($i = 0; $i -lt 60 -and -not $listo; $i++) {
    Start-Sleep -Seconds 3
    & docker info *> $null
    $listo = $LASTEXITCODE -eq 0
  }
  if (-not $listo) { Falla "Docker Desktop no está funcionando. Abrilo a mano, esperá a que diga 'Engine running' y volvé a ejecutar este script." }
}
Bien "Docker está funcionando"

# --- 2. Configuración ---------------------------------------------------------
Paso "Archivo de configuración .env"
$archivoEnv = Join-Path $raiz ".env"
if (-not (Test-Path $archivoEnv)) {
  Copy-Item (Join-Path $raiz ".env.example") $archivoEnv
  Bien "Se creó .env a partir de .env.example"
}
$contenido = [IO.File]::ReadAllText($archivoEnv)
if ($contenido -match '(?m)^CLAVE_CIFRADO=\s*$') {
  $clave = & node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
  $contenido = $contenido -replace '(?m)^CLAVE_CIFRADO=\s*$', "CLAVE_CIFRADO=$clave"
  [IO.File]::WriteAllText($archivoEnv, $contenido, (New-Object Text.UTF8Encoding $false))
  Bien "Se generó una CLAVE_CIFRADO nueva"
  Write-Host "    IMPORTANTE: copiá la línea CLAVE_CIFRADO de .env a un lugar seguro (gestor de contraseñas)." -ForegroundColor Yellow
  Write-Host "    Sin esa clave no se pueden abrir los archivos guardados." -ForegroundColor Yellow
} else {
  Bien ".env ya tiene CLAVE_CIFRADO"
}

# --- 3. Base de datos, dependencias y tablas ---------------------------------
Paso "Levantando PostgreSQL"
Ejecutar "docker" @("compose", "up", "-d") "No se pudo levantar PostgreSQL. Si el error menciona el puerto 5432, tenés otro PostgreSQL instalado usando ese puerto."
function ConsultaBase([string]$sql) {
  $salida = & docker compose exec -T -e PGPASSWORD=comprobantepy postgres psql -h localhost -U comprobantepy -d comprobantepy -tAc $sql 2>$null
  if ($LASTEXITCODE -ne 0) { return $null }
  return ($salida | Out-String).Trim()
}
$lista = $false
for ($i = 0; $i -lt 60 -and -not $lista; $i++) {
  $lista = (ConsultaBase "SELECT 1") -eq "1"
  if (-not $lista) { Start-Sleep -Seconds 2 }
}
if (-not $lista) { Falla "PostgreSQL no responde. Mirá los mensajes con: docker compose logs postgres" }
Bien "PostgreSQL listo"
if ((ConsultaBase "SELECT rolsuper FROM pg_roles WHERE rolname = current_user") -eq "t") {
  Write-Host "    Aviso: la base se creó con una versión anterior del proyecto (usuario administrador)." -ForegroundColor Yellow
  Write-Host "    Funciona, pero sin la segunda barrera de aislamiento. Ver README, 'Notas técnicas'." -ForegroundColor Yellow
}

Paso "Instalando dependencias (la primera vez tarda unos minutos)"
Ejecutar $npm @("install") "Falló npm install. Copiá el mensaje de error de arriba."
Bien "Dependencias instaladas"

Paso "Creando o actualizando las tablas"
Ejecutar $npm @("run", "db:migrate") "Fallaron las migraciones. Copiá el mensaje de error de arriba."
Bien "Tablas al día"

# --- 4. Base de pruebas y usuario ---------------------------------------------
Paso "Base para las pruebas automáticas"
if ((ConsultaBase "SELECT 1 FROM pg_database WHERE datname = 'comprobantepy_test'") -ne "1") {
  Ejecutar "docker" @("compose", "exec", "-T", "postgres", "createdb", "-U", "comprobantepy", "comprobantepy_test") "No se pudo crear la base de pruebas."
  Bien "Se creó comprobantepy_test"
} else {
  Bien "comprobantepy_test ya existe"
}

Paso "Usuario administrador"
if ((ConsultaBase "SELECT count(*) FROM usuarios") -eq "0") {
  if (Preguntar "No hay usuarios todavía. ¿Creo tu usuario administrador ahora?") {
    $email = Read-Host "Correo electrónico"
    $nombre = Read-Host "Nombre"
    Ejecutar $npm @("run", "crear-usuario", "--", "--email", $email, "--nombre", $nombre, "--admin") "No se pudo crear el usuario."
  } else {
    Write-Host "    Podés crearlo después con: npm run crear-usuario -- --email tu@correo.com --nombre `"Tu nombre`" --admin"
  }
} else {
  Bien "Ya hay usuarios creados"
}

Write-Host "`nTodo listo." -ForegroundColor Green
Write-Host "  Iniciar la aplicación:  npm run dev   y abrir http://localhost:5173"
Write-Host "  Pruebas automáticas:    en VS Code, Terminal > Ejecutar tarea > 'Pruebas automáticas'"
