#!/usr/bin/env bash
# install-lmstudio.sh — Installs LMStudio on macOS (Intel & Apple Silicon)
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
echo -e "${BOLD} LMStudio Installation for Echo2Text (macOS)${RESET}"
echo -e "${BOLD}============================================================${RESET}"
echo ""

# ── Architecture detection ────────────────────────────────────────────────────
ARCH=$(uname -m)
if [[ "$ARCH" == "arm64" ]]; then
    log "Architecture detected: Apple Silicon (ARM64 — M1/M2/M3)"
    DMG_SUFFIX="arm64"
else
    log "Architecture detected: Intel x86_64"
    DMG_SUFFIX="x64"
fi

# ── Check if LMStudio is already installed ────────────────────────────────────
if [[ -d "/Applications/LM Studio.app" ]]; then
    ok "LMStudio is already installed in /Applications/LM Studio.app"
    echo ""
    goto_configure=true
else
    goto_configure=false
fi

if [[ "$goto_configure" == "false" ]]; then
    # ── Attempt via Homebrew Cask ─────────────────────────────────────────────
    if command -v brew &>/dev/null; then
        log "Homebrew detected. Attempting installation via brew..."
        if brew install --cask lm-studio 2>/dev/null; then
            ok "LMStudio installed via Homebrew."
        else
            warn "Homebrew installation unavailable. Falling back to manual download..."
            goto_configure=false
        fi
    fi

    # ── Manual download if brew failed ────────────────────────────────────────
    if [[ ! -d "/Applications/LM Studio.app" ]]; then
        log "Downloading LMStudio from lmstudio.ai..."
        DMG_URL="https://releases.lmstudio.ai/mac/${DMG_SUFFIX}/latest/LM-Studio.dmg"
        DMG_PATH="/tmp/LM-Studio.dmg"

        if command -v curl &>/dev/null; then
            curl -L --progress-bar -o "$DMG_PATH" "$DMG_URL"
        else
            err "curl is not available. Install it with: brew install curl"
            echo "    Download LMStudio manually from https://lmstudio.ai"
            exit 1
        fi

        log "Mounting DMG..."
        hdiutil attach "$DMG_PATH" -nobrowse -quiet

        log "Copying to /Applications..."
        # Find the mounted volume
        VOLUME=$(find /Volumes -name "LM Studio*" -maxdepth 1 2>/dev/null | head -1)
        if [[ -z "$VOLUME" ]]; then
            err "Unable to find the mounted volume. Install LMStudio manually."
            open "https://lmstudio.ai"
            exit 1
        fi

        cp -R "${VOLUME}/LM Studio.app" /Applications/
        hdiutil detach "$VOLUME" -quiet 2>/dev/null || true
        rm -f "$DMG_PATH"

        ok "LMStudio copied to /Applications."
    fi
fi

# ── Configuration instructions ────────────────────────────────────────────────
echo ""
echo -e "${BOLD}============================================================${RESET}"
echo -e "${BOLD} LMStudio Configuration for Echo2Text${RESET}"
echo -e "${BOLD}============================================================${RESET}"
echo ""
echo "  Steps to complete in LMStudio:"
echo ""
echo "  1. SEARCH tab (magnifying glass on the left)"
echo "     Search for a model, for example:"
echo "       - \"mistral 7b instruct\"   (recommended, ~4.4 GB)"
echo "       - \"llama 3.1 8b instruct\" (~4.9 GB)"
echo "       - \"phi-3.5 mini instruct\" (~2.2 GB, for Macs with limited RAM)"
echo "     Select the Q4_K_M variant and click Download."
echo ""
echo "  2. LOCAL SERVER tab (icon <-> bottom left)"
echo "     Select your model from the dropdown list."
echo "     Click \"Start Server\"."
echo "     The server starts at http://localhost:1234"
echo ""
echo "  3. In Echo2Text, the URL http://localhost:1234/v1 is pre-configured."
echo "     The LMStudio dot will turn green automatically."
echo ""
echo -e "${BOLD}============================================================${RESET}"
echo ""

# ── Offer to open LMStudio ────────────────────────────────────────────────────
read -rp "Open LMStudio now? (y/N): " OPEN_NOW
if [[ "${OPEN_NOW,,}" == "y" ]]; then
    open "/Applications/LM Studio.app"
    ok "LMStudio launched."
fi

echo ""
ok "Done. Launch Echo2Text with:  ./start.sh"
echo ""
