@echo off
rem Doble clic: trae la ultima version de ComprobantePy (hace un respaldo antes).
rem Cerra el programa (ventana de Iniciar) antes de actualizar.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\actualizar.ps1"
echo.
pause
