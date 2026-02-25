#!/usr/bin/env bash
# start.sh — Starts Echo2Text on macOS (Intel & Apple Silicon M1/M2/M3)
set -euo pipefail

# ── Script directory (resolves symlinks) ──────────────────────────────────────
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Kill any stale process still holding port 8765
if lsof -ti :8765 &>/dev/null; then
    echo "[start] Releasing port 8765..."
    lsof -ti :8765 | xargs kill -9 2>/dev/null || true
fi

echo "[start] Starting Python ASR server..."

# ── Choose Python (venv or system) ────────────────────────────────────────────
if [[ -f "$ROOT/venv/bin/python" ]]; then
    PYTHON="$ROOT/venv/bin/python"
else
    PYTHON="$(command -v python3 || command -v python)"
fi

if [[ -z "$PYTHON" ]]; then
    echo "[ERROR] Python not found."
    echo "        Install Python 3.10+ via Homebrew: brew install python@3.11"
    exit 1
fi

echo "[start] Python: $PYTHON"

# ── Check that npm is available ───────────────────────────────────────────────
if ! command -v npm &>/dev/null; then
    echo "[ERROR] npm not found."
    echo "        Install Node.js via Homebrew: brew install node@20"
    echo "        Or via nvm: nvm install 20 && nvm use 20"
    exit 1
fi

# ── Launch server.py in the background ────────────────────────────────────────
"$PYTHON" "$ROOT/server.py" &
SERVER_PID=$!
echo "[start] Python server started (PID $SERVER_PID)"

# ── Stop the Python server when the app closes ────────────────────────────────
cleanup() {
    echo ""
    echo "[start] Stopping Python server (PID $SERVER_PID)..."
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
    echo "[start] Server stopped."
}
trap cleanup EXIT INT TERM

# ── Wait for the server to be ready ──────────────────────────────────────────
echo "[start] Waiting 5 seconds before launching Electron..."
sleep 5

# ── Launch Electron ───────────────────────────────────────────────────────────
echo "[start] Launching Electron..."
cd "$ROOT/electron"
npm start

# (cleanup runs automatically on exit via trap EXIT)
