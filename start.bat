@echo off
setlocal

:: Script directory
set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"

:: Kill any stale process still holding port 8765
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8765 " 2^>nul') do (
    echo [start] Releasing port 8765 (PID %%a)...
    taskkill /F /PID %%a >nul 2>&1
)

echo [start] Starting Python ASR server...

:: Choose Python (venv or system)
if exist "%ROOT%\venv\Scripts\python.exe" (
    set "PYTHON=%ROOT%\venv\Scripts\python.exe"
) else (
    set "PYTHON=python"
)

:: Launch server.py in the background
start "Parakeet ASR Server" /B "%PYTHON%" "%ROOT%\server.py"

:: Wait for the server to be ready (~10s for model loading)
echo [start] Waiting 5 seconds before launching Electron...
timeout /t 5 /nobreak >nul

:: Launch Electron
echo [start] Launching Electron...
cd /d "%ROOT%\electron"
npm start

endlocal
