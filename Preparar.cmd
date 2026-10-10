@echo off
rem Doble clic: prepara ComprobantePy la primera vez (o lo repara).
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\preparar.ps1"
echo.
pause
