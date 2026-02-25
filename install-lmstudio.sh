#!/usr/bin/env bash
# install-lmstudio.sh — Installation de LMStudio sur macOS (Intel & Apple Silicon)
set -euo pipefail

BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[0;33m"
RED="\033[0;31m"
RESET="\033[0m"

log()  { echo -e "${BOLD}[INFO]${RESET} $*"; }
ok()   { echo -e "${GREEN}[OK]${RESET}   $*"; }
warn() { echo -e "${YELLOW}[WARN]${RESET} $*"; }
err()  { echo -e "${RED}[ERR]${RESET}  $*"; }

echo ""
echo -e "${BOLD}============================================================${RESET}"
echo -e "${BOLD} Installation de LMStudio pour Parakeet (macOS)${RESET}"
echo -e "${BOLD}============================================================${RESET}"
echo ""

# ── Détection architecture ────────────────────────────────────────────────────
ARCH=$(uname -m)
if [[ "$ARCH" == "arm64" ]]; then
    log "Architecture détectée : Apple Silicon (ARM64 — M1/M2/M3)"
    DMG_SUFFIX="arm64"
else
    log "Architecture détectée : Intel x86_64"
    DMG_SUFFIX="x64"
fi

# ── Vérifier si LMStudio est déjà installé ────────────────────────────────────
if [[ -d "/Applications/LM Studio.app" ]]; then
    ok "LMStudio est déjà installé dans /Applications/LM Studio.app"
    echo ""
    goto_configure=true
else
    goto_configure=false
fi

if [[ "$goto_configure" == "false" ]]; then
    # ── Tentative via Homebrew Cask ───────────────────────────────────────────
    if command -v brew &>/dev/null; then
        log "Homebrew détecté. Tentative d'installation via brew..."
        if brew install --cask lm-studio 2>/dev/null; then
            ok "LMStudio installé via Homebrew."
        else
            warn "Installation via Homebrew non disponible. Téléchargement manuel..."
            goto_configure=false
        fi
    fi

    # ── Téléchargement manuel si brew a échoué ────────────────────────────────
    if [[ ! -d "/Applications/LM Studio.app" ]]; then
        log "Téléchargement de LMStudio depuis lmstudio.ai..."
        DMG_URL="https://releases.lmstudio.ai/mac/${DMG_SUFFIX}/latest/LM-Studio.dmg"
        DMG_PATH="/tmp/LM-Studio.dmg"

        if command -v curl &>/dev/null; then
            curl -L --progress-bar -o "$DMG_PATH" "$DMG_URL"
        else
            err "curl n'est pas disponible. Installez-le avec : brew install curl"
            echo "    Téléchargez LMStudio manuellement sur https://lmstudio.ai"
            exit 1
        fi

        log "Montage du DMG..."
        hdiutil attach "$DMG_PATH" -nobrowse -quiet

        log "Copie dans /Applications..."
        # Trouver le volume monté
        VOLUME=$(find /Volumes -name "LM Studio*" -maxdepth 1 2>/dev/null | head -1)
        if [[ -z "$VOLUME" ]]; then
            err "Impossible de trouver le volume monté. Installez LMStudio manuellement."
            open "https://lmstudio.ai"
            exit 1
        fi

        cp -R "${VOLUME}/LM Studio.app" /Applications/
        hdiutil detach "$VOLUME" -quiet 2>/dev/null || true
        rm -f "$DMG_PATH"

        ok "LMStudio copié dans /Applications."
    fi
fi

# ── Instructions de configuration ─────────────────────────────────────────────
echo ""
echo -e "${BOLD}============================================================${RESET}"
echo -e "${BOLD} Configuration de LMStudio pour Parakeet${RESET}"
echo -e "${BOLD}============================================================${RESET}"
echo ""
echo "  Étapes à effectuer dans LMStudio :"
echo ""
echo "  1. Onglet SEARCH (loupe à gauche)"
echo "     Recherchez un modèle, par exemple :"
echo "       - \"mistral 7b instruct\"   (recommandé, ~4.4 Go)"
echo "       - \"llama 3.1 8b instruct\" (~4.9 Go)"
echo "       - \"phi-3.5 mini instruct\" (~2.2 Go, pour Macs avec peu de RAM)"
echo "     Choisissez la variante Q4_K_M et cliquez Download."
echo ""
echo "  2. Onglet LOCAL SERVER (icône <-> en bas à gauche)"
echo "     Sélectionnez votre modèle dans la liste déroulante."
echo "     Cliquez \"Start Server\"."
echo "     Le serveur démarre sur http://localhost:1234"
echo ""
echo "  3. Dans Parakeet, l'URL http://localhost:1234/v1 est pré-configurée."
echo "     Le point LMStudio passera au vert automatiquement."
echo ""
echo -e "${BOLD}============================================================${RESET}"
echo ""

# ── Proposer d'ouvrir LMStudio ────────────────────────────────────────────────
read -rp "Ouvrir LMStudio maintenant ? (o/N) : " OPEN_NOW
if [[ "${OPEN_NOW,,}" == "o" ]]; then
    open "/Applications/LM Studio.app"
    ok "LMStudio lancé."
fi

echo ""
ok "Terminé. Lancez Parakeet avec :  ./start.sh"
echo ""
