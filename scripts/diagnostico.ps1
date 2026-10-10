<#
  Revisa la instalación de ComprobantePy y guarda el resultado en diagnostico.txt.
  No incluye contraseñas, claves ni datos de comprobantes: se puede compartir para pedir ayuda.
#>
$ErrorActionPreference = "Continue"
$raiz = Split-Path -Parent $PSScriptRoot
Set-Location $raiz
$enWindows = $env:OS -eq "Windows_NT"
$salida = New-Object System.Collections.Generic.List[string]
$problemas = New-Object System.Collections.Generic.List[string]

function Linea([string]$texto) { $salida.Add($texto); Write-Host $texto }
function Titulo([string]$texto) { Linea ""; Linea "== $texto ==" }
function Probar([string]$nombre, [scriptblock]$accion) {
  try {
    $r = & $accion 2>&1 | Out-String
    $r = $r.Trim()
    if (-not $r) { $r = "(sin salida)" }
    Linea ("{0,-28} {1}" -f $nombre, ($r -split "`n")[0].Trim())
    return $r
  } catch {
    Linea ("{0,-28} NO DISPONIBLE ({1})" -f $nombre, $_.Exception.Message)
    return $null
  }
}

Linea "Diagnóstico de ComprobantePy - $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
Linea "Carpeta: $raiz"

Titulo "Programas"
if ($enWindows) { Linea ("{0,-28} {1}" -f "Windows", [Environment]::OSVersion.VersionString) }
$node = Probar "Node.js" { node -v }
if (-not $node) { $problemas.Add("Falta Node.js (Paso 3)") }
elseif ([int]($node.TrimStart("v").Split(".")[0]) -lt 22) { $problemas.Add("Node.js $node es viejo: se necesita 22 o superior (Paso 3)") }
$null = Probar "npm" { if ($enWindows) { npm.cmd -v } else { npm -v } }
if (-not (Probar "Git" { git --version })) { $problemas.Add("Falta Git (Paso 5)") }
if (-not (Probar "Docker" { docker --version })) { $problemas.Add("Falta Docker Desktop (Paso 4)") }
if ($enWindows) { $null = Probar "WSL" { wsl --status } }

Titulo "Docker"
& docker info *> $null
if ($LASTEXITCODE -eq 0) {
  Linea "Docker funcionando           sí"
  $estado = & docker compose ps --format "{{.Service}}: {{.State}}" 2>&1 | Out-String
  Linea "Contenedores                 $($estado.Trim() -replace "`r?`n", ' | ')"
  if ($estado -notmatch "postgres: running") { $problemas.Add("La base de datos no está encendida: docker compose up -d (Paso 9)") }
} else {
  Linea "Docker funcionando           NO"
  $problemas.Add("Docker Desktop no está abierto o no arrancó (Paso 4)")
}

Titulo "Configuración"
$archivoEnv = Join-Path $raiz ".env"
if (Test-Path $archivoEnv) {
  $env_ = Get-Content $archivoEnv
  $clave = ($env_ | Where-Object { $_ -match '^CLAVE_CIFRADO=' }) -replace '^CLAVE_CIFRADO=', ''
  Linea ("{0,-28} {1}" -f ".env", "existe")
  Linea ("{0,-28} {1}" -f "CLAVE_CIFRADO", $(if ($clave.Trim()) { "definida (no se muestra)" } else { "VACÍA" }))
  if (-not $clave.Trim()) { $problemas.Add("CLAVE_CIFRADO vacía en .env (Paso 8)") }
  $url = ($env_ | Where-Object { $_ -match '^DATABASE_URL=' }) -replace '^DATABASE_URL=', ''
  Linea ("{0,-28} {1}" -f "DATABASE_URL", ($url -replace '//([^:]+):[^@]+@', '//$1:***@'))
  foreach ($var in "URL_PUBLICA", "GOOGLE_CLIENT_ID", "CLAMAV_HOST", "RESPALDO_DIARIO_HORA") {
    $v = ($env_ | Where-Object { $_ -match "^$var=" }) -replace "^$var=", ''
    Linea ("{0,-28} {1}" -f $var, $(if ($v) { if ($var -eq "GOOGLE_CLIENT_ID") { "definido" } else { $v } } else { "(vacío)" }))
  }
} else {
  Linea ".env                         NO EXISTE"
  $problemas.Add("Falta el archivo .env (Paso 8 o Preparar.cmd)")
}
Linea ("{0,-28} {1}" -f "Dependencias (node_modules)", $(if (Test-Path (Join-Path $raiz "node_modules")) { "instaladas" } else { "NO instaladas" }))
if (-not (Test-Path (Join-Path $raiz "node_modules"))) { $problemas.Add("Faltan las dependencias: npm.cmd install (Paso 10)") }

Titulo "Base de datos"
$consulta = {
  param($sql)
  & docker compose exec -T -e PGPASSWORD=comprobantepy postgres psql -h localhost -U comprobantepy -d comprobantepy -tAc $sql 2>&1 | Out-String
}
$migraciones = (& $consulta "SELECT count(*) FROM drizzle.__drizzle_migrations").Trim()
if ($migraciones -match '^\d+$') {
  Linea ("{0,-28} {1}" -f "Migraciones aplicadas", $migraciones)
  Linea ("{0,-28} {1}" -f "Usuarios", (& $consulta "SELECT count(*) FROM usuarios").Trim())
  Linea ("{0,-28} {1}" -f "Contribuyentes", (& $consulta "SELECT count(*) FROM contribuyentes").Trim())
  Linea ("{0,-28} {1}" -f "Comprobantes", (& $consulta "SELECT count(*) FROM comprobantes").Trim())
  $super = (& $consulta "SELECT rolsuper FROM pg_roles WHERE rolname = current_user").Trim()
  Linea ("{0,-28} {1}" -f "Usuario de base sin privilegios", $(if ($super -eq "f") { "sí" } else { "NO (base de una versión anterior)" }))
  if ((& $consulta "SELECT count(*) FROM usuarios").Trim() -eq "0") { $problemas.Add("No hay usuarios: npm.cmd run crear-usuario (Paso 13)") }
} else {
  Linea "Conexión a la base           NO ($($migraciones -split "`n" | Select-Object -First 1))"
  $problemas.Add("No se pudo consultar la base: revisá Docker y ejecutá npm.cmd run db:migrate (Pasos 9 y 11)")
}

Titulo "Puertos"
foreach ($puerto in 3000, 5173, 5432) {
  $usado = $false
  if ($enWindows) { $usado = [bool](Get-NetTCPConnection -LocalPort $puerto -State Listen -ErrorAction SilentlyContinue) }
  else { $usado = [bool](& bash -c "ss -ltn 2>/dev/null | grep -q ':$puerto '; echo `$?" | Select-String '^0$') }
  Linea ("{0,-28} {1}" -f "Puerto $puerto", $(if ($usado) { "en uso" } else { "libre" }))
}
Linea "(5432 en uso = base encendida; 3000 y 5173 en uso = programa abierto)"

Titulo "Versión del programa"
$null = Probar "Rama" { git branch --show-current }
$null = Probar "Última versión" { git log -1 --format="%h %ad %s" --date=short }
$modificados = (& git status --porcelain --untracked-files=no | Measure-Object).Count
Linea ("{0,-28} {1}" -f "Archivos modificados", $modificados)

Titulo "Respaldos"
$carpeta = Join-Path $raiz "datos\respaldos"
if (Test-Path $carpeta) {
  $ultimos = Get-ChildItem $carpeta -Directory -Filter "respaldo-*" | Sort-Object Name -Descending
  Linea ("{0,-28} {1}" -f "Cantidad", $ultimos.Count)
  if ($ultimos.Count) { Linea ("{0,-28} {1}" -f "Último", $ultimos[0].Name) }
} else {
  Linea "Cantidad                     0 (todavía no se hizo ninguno: Respaldar.cmd)"
}

if ($enWindows) {
  Titulo "Disco"
  $disco = Get-PSDrive -Name ($raiz.Substring(0, 1))
  Linea ("{0,-28} {1:N1} GB" -f "Espacio libre", ($disco.Free / 1GB))
  if ($disco.Free -lt 5GB) { $problemas.Add("Queda poco espacio en el disco (menos de 5 GB)") }
}

Titulo "Resultado"
if ($problemas.Count -eq 0) {
  Linea "Sin problemas detectados."
} else {
  foreach ($p in $problemas) { Linea "PROBLEMA: $p" }
}

$archivo = Join-Path $raiz "diagnostico.txt"
[IO.File]::WriteAllLines($archivo, $salida, (New-Object Text.UTF8Encoding $true))
Write-Host "`nResultado guardado en: $archivo" -ForegroundColor Green
Write-Host "Podés compartir ese archivo para pedir ayuda: no contiene claves ni datos de comprobantes."
