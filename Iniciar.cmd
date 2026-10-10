@echo off
rem Doble clic: inicia ComprobantePy y abre el navegador. Para detenerla, cerra esta ventana.
cd /d "%~dp0"
title ComprobantePy - no cierres esta ventana mientras la uses
docker info >nul 2>&1
if errorlevel 1 (
  echo Abriendo Docker Desktop, puede tardar un par de minutos...
  if exist "%ProgramFiles%\Docker\Docker\Docker Desktop.exe" start "" "%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
)
set /a intentos=0
:esperar
docker info >nul 2>&1
if not errorlevel 1 goto docker_listo
set /a intentos+=1
if %intentos% geq 60 (
  echo.
  echo No se pudo iniciar Docker Desktop. Abrilo a mano, espera "Engine running" y volve a abrir este archivo.
  pause
  exit /b 1
)
timeout /t 3 /nobreak >nul
goto esperar
:docker_listo
docker compose up -d
if errorlevel 1 (
  echo.
  echo No se pudo iniciar la base de datos. Revisa la seccion 12 de GUIA.md.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Falta preparar el proyecto: abri primero Preparar.cmd
  pause
  exit /b 1
)
echo.
echo Iniciando... el navegador se abre solo en unos segundos: http://localhost:5173
start "" cmd /c "timeout /t 15 /nobreak >nul & start http://localhost:5173"
call npm.cmd run dev
pause
