@echo off
setlocal

:: Script directory
set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"

:: Kill any stale process still holding port 8765
echo [start] Checking port 8765...
powershell -NoProfile -Command "Get-Process -Id (Get-NetTCPConnection -LocalPort 8765 -ErrorAction SilentlyContinue).OwningProcess -ErrorAction SilentlyContinue | Stop-Process -Force" 2>nul

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
