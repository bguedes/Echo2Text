@echo off
setlocal

:: Répertoire du script
set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"

echo [start] Démarrage du serveur Python ASR...

:: Choisir Python (venv ou système)
if exist "%ROOT%\venv\Scripts\python.exe" (
    set "PYTHON=%ROOT%\venv\Scripts\python.exe"
) else (
    set "PYTHON=python"
)

:: Lancer server.py en arrière-plan
start "Parakeet ASR Server" /B "%PYTHON%" "%ROOT%\server.py"

:: Attendre que le serveur soit prêt (~10s pour le modèle)
echo [start] Attente de 5 secondes avant de lancer Electron...
timeout /t 5 /nobreak >nul

:: Lancer Electron
echo [start] Lancement Electron...
cd /d "%ROOT%\electron"
npm start

endlocal
