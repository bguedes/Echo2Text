@echo off
setlocal enabledelayedexpansion

echo ============================================================
echo  LMStudio Installation for Echo2Text
echo ============================================================
echo.

:: Check if LMStudio is already installed
set "LMSTUDIO_EXE=%LOCALAPPDATA%\Programs\LM-Studio\LM Studio.exe"
if exist "%LMSTUDIO_EXE%" (
    echo [OK] LMStudio is already installed.
    echo      Path: %LMSTUDIO_EXE%
    echo.
    goto :already_installed
)

:: Download LMStudio via winget (Windows 10/11)
where winget >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo [1/2] Installing via winget...
    winget install --id ElementLabs.LMStudio --accept-package-agreements --accept-source-agreements
    if !ERRORLEVEL! EQU 0 (
        echo [OK] LMStudio installed successfully via winget.
        goto :configure
    )
    echo [WARN] winget failed. Attempting manual download...
)

:: Manual download via PowerShell
echo [1/2] Downloading LMStudio...
set "DOWNLOAD_URL=https://releases.lmstudio.ai/windows/x64/latest/LM-Studio-Setup.exe"
set "INSTALLER=%TEMP%\LM-Studio-Setup.exe"

powershell -NoProfile -Command ^
  "try { Invoke-WebRequest -Uri '%DOWNLOAD_URL%' -OutFile '%INSTALLER%' -UseBasicParsing; Write-Host 'Download OK' } catch { Write-Host 'Error:' $_.Exception.Message; exit 1 }"

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Unable to download LMStudio automatically.
    echo         Download it manually from https://lmstudio.ai
    echo         then rerun this script or install it manually.
    pause
    exit /b 1
)

echo [2/2] Installing...
"%INSTALLER%" /S
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Installation failed. Try installing manually.
    start "" "https://lmstudio.ai"
    pause
    exit /b 1
)

:: Wait for the installation to complete
timeout /t 5 /nobreak >nul
del /f /q "%INSTALLER%" 2>nul

echo [OK] LMStudio installed successfully.

:configure
echo.
echo ============================================================
echo  LMStudio Configuration for Echo2Text
echo ============================================================
echo.
echo  Steps to complete in LMStudio after opening it:
echo.
echo  1. SEARCH tab (magnifying glass on the left)
echo     Search for a model, for example:
echo       - "mistral 7b instruct"  (recommended, ~4.4 GB)
echo       - "llama 3.1 8b instruct" (~4.9 GB)
echo       - "phi-3.5 mini instruct" (~2.2 GB, low-RAM PCs)
echo     Select the "Q4_K_M" variant and click Download.
echo.
echo  2. Once downloaded, go to the LOCAL SERVER tab (icon <>)
echo     Select your model from the dropdown list.
echo     Click "Start Server".
echo     The server starts at http://localhost:1234
echo.
echo  3. In Echo2Text, the URL is already set to
echo     http://localhost:1234/v1
echo     The "LMStudio" dot will turn green automatically.
echo.
echo ============================================================
echo.

set /p OPEN_NOW="Open LMStudio now? (Y/N): "
if /i "%OPEN_NOW%"=="Y" (
    if exist "%LMSTUDIO_EXE%" (
        start "" "%LMSTUDIO_EXE%"
    ) else (
        :: Search in other common locations
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
        echo [INFO] Cannot find LMStudio. Search for it in the Start menu.
    )
)
goto :end

:already_installed
echo  LMStudio is already installed on your machine.
echo.
echo  If you have not yet loaded an LLM model:
echo  1. Open LMStudio
echo  2. SEARCH tab → search "mistral 7b instruct" → Download Q4_K_M
echo  3. LOCAL SERVER tab → select the model → Start Server
echo.
set /p OPEN_NOW="Open LMStudio? (Y/N): "
if /i "%OPEN_NOW%"=="Y" start "" "%LMSTUDIO_EXE%"

:end
echo.
echo  Done. You can now launch Echo2Text with start.bat
echo.
pause
endlocal
