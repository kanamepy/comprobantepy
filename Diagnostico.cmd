@echo off
rem Doble clic: revisa la instalacion y guarda el resultado en diagnostico.txt (sin claves ni datos privados).
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\diagnostico.ps1"
echo.
pause
