@echo off
rem Doble clic: ejecuta las pruebas automaticas.
cd /d "%~dp0"
docker compose up -d
set TEST_DATABASE_URL=postgres://comprobantepy:comprobantepy@localhost:5432/comprobantepy_test
call npm.cmd test
echo.
echo Si al final dice "Tests 85 passed" y "Tests 92 passed", todo esta bien.
pause
