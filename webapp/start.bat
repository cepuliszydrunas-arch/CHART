@echo off
cd /d "%~dp0"

REM --- Patikrinti ar portas 3000 laisvas ---
netstat -ano | findstr ":3000 " | findstr "LISTENING" >nul
if %errorlevel%==0 (
    echo [!] Portas 3000 uzimtas. Stabdomas procesas...
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000 " ^| findstr "LISTENING"') do (
        taskkill /PID %%a /F >nul 2>&1
    )
    timeout /t 1 /nobreak >nul
)

echo [*] Build'inam...
if not exist "node_modules" (
    echo [*] Instaliuojami paketai...
    call npm install || goto :error
)
call npm run build || goto :error

echo [*] Startuojamas serveris: http://localhost:3000
call npm run preview -- --port 3000
goto :eof

:error
echo [!] KLAIDA - paziurek zemesne isvesti.
pause
