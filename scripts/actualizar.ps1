<#
  Trae la última versión de ComprobantePy desde GitHub, con un respaldo antes.
  Uso: doble clic en Actualizar.cmd (o: powershell -ExecutionPolicy Bypass -File scripts\actualizar.ps1)
#>
$ErrorActionPreference = "Stop"
$raiz = Split-Path -Parent $PSScriptRoot
Set-Location $raiz
$npm = if ($env:OS -eq "Windows_NT") { "npm.cmd" } else { "npm" }

function Paso([string]$texto) { Write-Host "`n==> $texto" -ForegroundColor Cyan }
function Bien([string]$texto) { Write-Host "    OK  $texto" -ForegroundColor Green }
function Falla([string]$texto) { Write-Host "`n[X] $texto" -ForegroundColor Red; exit 1 }

Paso "Verificando Docker"
& docker info *> $null
if ($LASTEXITCODE -ne 0) { Falla "Docker Desktop no está abierto. Abrilo, esperá 'Engine running' y volvé a ejecutar Actualizar." }
& docker compose up -d *> $null
Bien "Docker y la base de datos encendidos"

Paso "Revisando cambios locales"
$cambios = & git status --porcelain --untracked-files=no
if ($cambios) {
  Write-Host "    Hay archivos del proyecto modificados en esta PC:" -ForegroundColor Yellow
  $cambios | ForEach-Object { Write-Host "      $_" }
  $respuesta = Read-Host "    ¿Guardarlos aparte (git stash) y continuar? (s/n)"
  if ($respuesta -notmatch '^(s|si|sí)$') { Falla "Actualización cancelada; no se cambió nada." }
  & git stash push -m "Cambios locales antes de actualizar" | Out-Null
  Bien "Cambios guardados aparte (se recuperan con: git stash pop)"
} else {
  Bien "Sin cambios locales"
}

Paso "Respaldo antes de actualizar"
& $npm run respaldo
if ($LASTEXITCODE -ne 0) {
  Write-Host "    No se pudo hacer el respaldo." -ForegroundColor Yellow
  $respuesta = Read-Host "    ¿Actualizar igual, sin respaldo? (s/n)"
  if ($respuesta -notmatch '^(s|si|sí)$') { Falla "Actualización cancelada; no se cambió nada." }
} else {
  Bien "Respaldo creado en datos\respaldos"
}

Paso "Descargando la última versión"
$antes = (& git rev-parse --short HEAD).Trim()
& git pull --ff-only
if ($LASTEXITCODE -ne 0) { Falla "No se pudo descargar la versión nueva. Ejecutá Diagnostico.cmd y compartí el resultado." }
$despues = (& git rev-parse --short HEAD).Trim()
if ($antes -eq $despues) {
  Bien "Ya tenías la última versión ($despues)"
} else {
  Bien "Actualizado de $antes a $despues"
  Write-Host ""
  & git log --oneline "$antes..$despues" | ForEach-Object { Write-Host "      $_" }
}

Paso "Instalando dependencias"
& $npm install
if ($LASTEXITCODE -ne 0) { Falla "Falló npm install. Ejecutá Diagnostico.cmd y compartí el resultado." }
Bien "Dependencias al día"

Paso "Actualizando las tablas"
& $npm run db:migrate
if ($LASTEXITCODE -ne 0) { Falla "Fallaron las migraciones. El respaldo de recién está en datos\respaldos." }
Bien "Base de datos al día"

Write-Host "`nActualización terminada. Abrí el programa con «ComprobantePy - Iniciar» (o Iniciar.cmd)." -ForegroundColor Green
