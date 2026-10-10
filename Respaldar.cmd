@echo off
rem Doble clic: crea un respaldo y comprueba que se pueda restaurar.
cd /d "%~dp0"
docker compose up -d
call npm.cmd run respaldo
if errorlevel 1 goto fin
echo.
echo Comprobando el respaldo...
call npm.cmd run respaldo -- probar
echo.
echo Los respaldos estan en la carpeta datos\respaldos. Copialos a un disco externo o a la nube.
:fin
echo.
pause
