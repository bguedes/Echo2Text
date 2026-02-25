#!/usr/bin/env bash
# start.sh — Démarrage de Parakeet sur macOS (Intel & Apple Silicon M1/M2/M3)
set -euo pipefail

# ── Répertoire du script (résout les symlinks) ────────────────────────────────
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "[start] Démarrage du serveur Python ASR..."

# ── Choisir Python (venv ou système) ─────────────────────────────────────────
if [[ -f "$ROOT/venv/bin/python" ]]; then
    PYTHON="$ROOT/venv/bin/python"
else
    PYTHON="$(command -v python3 || command -v python)"
fi

if [[ -z "$PYTHON" ]]; then
    echo "[ERREUR] Python introuvable."
    echo "         Installez Python 3.10+ via Homebrew : brew install python@3.11"
    exit 1
fi

echo "[start] Python : $PYTHON"

# ── Vérifier que npm est disponible ──────────────────────────────────────────
if ! command -v npm &>/dev/null; then
    echo "[ERREUR] npm introuvable."
    echo "         Installez Node.js via Homebrew : brew install node@20"
    echo "         Ou via nvm : nvm install 20 && nvm use 20"
    exit 1
fi

# ── Lancer server.py en arrière-plan ─────────────────────────────────────────
"$PYTHON" "$ROOT/server.py" &
SERVER_PID=$!
echo "[start] Serveur Python démarré (PID $SERVER_PID)"

# ── Arrêter le serveur Python à la fermeture de l'app ────────────────────────
cleanup() {
    echo ""
    echo "[start] Arrêt du serveur Python (PID $SERVER_PID)..."
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
    echo "[start] Serveur arrêté."
}
trap cleanup EXIT INT TERM

# ── Attendre que le serveur soit prêt ────────────────────────────────────────
echo "[start] Attente de 5 secondes avant de lancer Electron..."
sleep 5

# ── Lancer Electron ───────────────────────────────────────────────────────────
echo "[start] Lancement Electron..."
cd "$ROOT/electron"
npm start

# (cleanup s'exécute automatiquement à la fin via trap EXIT)
