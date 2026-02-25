@echo off
setlocal enabledelayedexpansion

echo ============================================================
echo  Installation de LMStudio pour Parakeet
echo ============================================================
echo.

:: Vérifier si LMStudio est déjà installé
set "LMSTUDIO_EXE=%LOCALAPPDATA%\Programs\LM-Studio\LM Studio.exe"
if exist "%LMSTUDIO_EXE%" (
    echo [OK] LMStudio est déjà installé.
    echo      Chemin : %LMSTUDIO_EXE%
    echo.
    goto :already_installed
)

:: Télécharger LMStudio via winget (Windows 10/11)
where winget >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo [1/2] Installation via winget...
    winget install --id ElementLabs.LMStudio --accept-package-agreements --accept-source-agreements
    if !ERRORLEVEL! EQU 0 (
        echo [OK] LMStudio installé avec succès via winget.
        goto :configure
    )
    echo [WARN] winget a échoué. Tentative de téléchargement manuel...
)

:: Téléchargement manuel via PowerShell
echo [1/2] Téléchargement de LMStudio...
set "DOWNLOAD_URL=https://releases.lmstudio.ai/windows/x64/latest/LM-Studio-Setup.exe"
set "INSTALLER=%TEMP%\LM-Studio-Setup.exe"

powershell -NoProfile -Command ^
  "try { Invoke-WebRequest -Uri '%DOWNLOAD_URL%' -OutFile '%INSTALLER%' -UseBasicParsing; Write-Host 'Téléchargement OK' } catch { Write-Host 'Erreur :' $_.Exception.Message; exit 1 }"

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERREUR] Impossible de télécharger LMStudio automatiquement.
    echo          Téléchargez-le manuellement sur https://lmstudio.ai
    echo          puis relancez ce script ou installez-le manuellement.
    pause
    exit /b 1
)

echo [2/2] Installation en cours...
"%INSTALLER%" /S
if %ERRORLEVEL% NEQ 0 (
    echo [ERREUR] L'installation a échoué. Essayez d'installer manuellement.
    start "" "https://lmstudio.ai"
    pause
    exit /b 1
)

:: Attendre que l'installation se termine
timeout /t 5 /nobreak >nul
del /f /q "%INSTALLER%" 2>nul

echo [OK] LMStudio installé avec succès.

:configure
echo.
echo ============================================================
echo  Configuration de LMStudio pour Parakeet
echo ============================================================
echo.
echo  Étapes à effectuer dans LMStudio après son ouverture :
echo.
echo  1. Onglet SEARCH (loupe à gauche)
echo     Recherchez un modèle, par exemple :
echo       - "mistral 7b instruct"  (recommandé, ~4.4 Go)
echo       - "llama 3.1 8b instruct" (~4.9 Go)
echo       - "phi-3.5 mini instruct" (~2.2 Go, PC avec peu de RAM)
echo     Choisissez la variante "Q4_K_M" et cliquez Download.
echo.
echo  2. Une fois téléchargé, onglet LOCAL SERVER (icone <>)
echo     Sélectionnez votre modèle dans la liste déroulante.
echo     Cliquez "Start Server".
echo     Le serveur démarre sur http://localhost:1234
echo.
echo  3. Dans Parakeet, l'URL est déjà configurée sur
echo     http://localhost:1234/v1
echo     Le point "LMStudio" passera au vert automatiquement.
echo.
echo ============================================================
echo.

set /p OPEN_NOW="Ouvrir LMStudio maintenant ? (O/N) : "
if /i "%OPEN_NOW%"=="O" (
    if exist "%LMSTUDIO_EXE%" (
        start "" "%LMSTUDIO_EXE%"
    ) else (
        :: Chercher dans d'autres emplacements courants
        for %%P in (
            "%LOCALAPPDATA%\Programs\LM-Studio\LM Studio.exe"
            "%PROGRAMFILES%\LM Studio\LM Studio.exe"
            "%APPDATA%\Local\Programs\LM-Studio\LM Studio.exe"
        ) do (
            if exist %%P (
                start "" %%P
                goto :end
            )
        )
        echo [INFO] Impossible de trouver LMStudio. Cherchez-le dans le menu Démarrer.
    )
)
goto :end

:already_installed
echo  LMStudio est déjà installé sur votre machine.
echo.
echo  Si vous n'avez pas encore chargé de modèle LLM :
echo  1. Ouvrez LMStudio
echo  2. Onglet SEARCH → cherchez "mistral 7b instruct" → Download Q4_K_M
echo  3. Onglet LOCAL SERVER → sélectionnez le modèle → Start Server
echo.
set /p OPEN_NOW="Ouvrir LMStudio ? (O/N) : "
if /i "%OPEN_NOW%"=="O" start "" "%LMSTUDIO_EXE%"

:end
echo.
echo  Terminé. Vous pouvez maintenant lancer Parakeet avec start.bat
echo.
pause
endlocal
