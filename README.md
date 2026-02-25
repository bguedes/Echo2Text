---
title: Parakeet-tdt-0.6b-v3 ONNX CPU
emoji: 🦀
colorFrom: green
colorTo: gray
sdk: gradio
sdk_version: 5.49.0
app_file: app.py
pinned: false
license: bsd-3-clause
short_description: Speech transcription (Nvidia/parakeet-tdt-0.6b-v3+onnx_asr)
tags:
- asr
- onnx
preload_from_hub:
- istupakov/parakeet-tdt-0.6b-v3-onnx
models:
- istupakov/parakeet-tdt-0.6b-v3-onnx
---

This space uses Nvidia [parakeet-tdt-0.6b-v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3) model in [onnx format](https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx) with [onnx-asr](https://github.com/istupakov/onnx-asr) backend.
In theory with minor edits it can work both on CPU and GPU but I don't have access to ZeroGPU spaces to enable hardware acceleration.
Locally I tested it with Nvidia RTX3060 and RTX4060Ti and it used about 6GB VRAM with 150s chunks.

---

# Echo2Text — Real-time Meeting Transcription & Analysis

Desktop application (Windows / macOS) for live meeting transcription with automatic question and action item detection, powered by the **NeMo Parakeet TDT 0.6B v3** ASR model (ONNX) and a local LLM via **LMStudio**.

---

## Table of Contents

1. [System Requirements](#1-system-requirements)
2. [Install Node.js](#2-install-nodejs)
3. [Install Python](#3-install-python)
4. [Clone / Extract the Project](#4-clone--extract-the-project)
5. [Install Python Dependencies](#5-install-python-dependencies)
6. [Install Node.js Dependencies](#6-install-nodejs-dependencies)
7. [Install and Configure LMStudio](#7-install-and-configure-lmstudio)
8. [First Launch](#8-first-launch)
9. [macOS Launch (Apple M3)](#9-macos-launch-apple-m3)
10. [Supported Audio Sources](#10-supported-audio-sources)
11. [FAQ / Troubleshooting](#11-faq--troubleshooting)

---

## 1. System Requirements

| Component | Windows | macOS (M3) |
|-----------|---------|------------|
| OS | Windows 10/11 64-bit | macOS 14 Sonoma or later |
| GPU (optional) | NVIDIA CUDA 11.8+ | — (CPU only, Metal not supported by ONNX Runtime) |
| RAM | 8 GB minimum, 16 GB recommended | 8 GB minimum, 16 GB recommended |
| Disk space | ~5 GB (model ~600 MB + LMStudio) | ~5 GB |
| Python | 3.10 – 3.12 | 3.10 – 3.12 |
| Node.js | 18 LTS or 20 LTS | 18 LTS or 20 LTS |

> **NVIDIA GPU**: if you have an NVIDIA card, `onnx-asr` will automatically use CUDA to accelerate transcription. Without a GPU, transcription runs on CPU (slower but fully functional).

---

## 2. Install Node.js

### Windows
Download the LTS installer from [https://nodejs.org](https://nodejs.org) and run it.
Verify:
```cmd
node -v   # e.g. v20.11.0
npm -v    # e.g. 10.2.4
```

### macOS
```bash
# Via Homebrew (recommended)
brew install node@20
# Or via nvm (version manager)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.zshrc
nvm install 20
nvm use 20
```

---

## 3. Install Python

### Windows
Download Python 3.11 from [https://www.python.org/downloads/](https://www.python.org/downloads/).
**Important**: check "Add Python to PATH" during installation.
Verify:
```cmd
python --version   # Python 3.11.x
```

### macOS (M3)
```bash
# Via Homebrew
brew install python@3.11
# Verify
python3 --version  # Python 3.11.x
```

---

## 4. Clone / Extract the Project

```bash
# Via Git
git clone https://github.com/bguedes/Echo2Text.git
cd Echo2Text

# Or extract the ZIP archive into the folder of your choice
```

---

## 5. Install Python Dependencies

The project uses a **virtual environment** (`venv`) isolated from the system Python.

### Windows
```cmd
cd Echo2Text

:: Create the virtual environment
python -m venv venv

:: Activate the environment
venv\Scripts\activate

:: Install dependencies
pip install -r requirements.txt
```

> **With NVIDIA GPU**: `onnx-asr[gpu,hub]` automatically installs `onnxruntime-gpu`. Make sure CUDA 11.8+ is installed.
> **Without GPU**: replace `onnx-asr[gpu,hub]` with `onnx-asr[hub]` in `requirements.txt` before installing.

### macOS (M3)
```bash
cd Echo2Text

# Create the virtual environment
python3 -m venv venv

# Activate the environment
source venv/bin/activate

# Install dependencies (CPU only on M3)
pip install "onnx-asr[hub]>=0.6.1" "fastapi>=0.115.0" "uvicorn[standard]>=0.30.0"
```

> On Apple Silicon, `onnxruntime` runs in CPU mode. The `[gpu]` extra is not needed.

The first launch will automatically download the **nemo-parakeet-tdt-0.6b-v3** model (~600 MB) from HuggingFace Hub.

---

## 6. Install Node.js Dependencies

```bash
cd electron
npm install
```

This installs only **Electron ^32** (defined in `electron/package.json`). No native dependencies are required.

---

## 7. Install and Configure LMStudio

LMStudio is the local LLM server that answers detected questions and generates the meeting summary.

### 7.1 Automatic Installation (provided scripts)

#### Windows
```cmd
install-lmstudio.bat
```

#### macOS
```bash
chmod +x install-lmstudio.sh
./install-lmstudio.sh
```

These scripts download and install LMStudio automatically.

### 7.2 Manual Installation

1. Go to [https://lmstudio.ai](https://lmstudio.ai)
2. Download the version for your system:
   - **Windows**: `LM-Studio-x.x.x-Setup.exe`
   - **macOS (Apple Silicon)**: `LM-Studio-x.x.x-arm64.dmg`
3. Install the application

### 7.3 Loading an LLM Model

Echo2Text works with any **OpenAI chat completions** compatible model loaded in LMStudio.

**Recommended models** (good speed / quality balance):

| Model | Size | Required RAM |
|-------|------|-------------|
| `Mistral 7B Instruct v0.3` (Q4_K_M) | ~4.4 GB | 8 GB |
| `Llama 3.1 8B Instruct` (Q4_K_M) | ~4.9 GB | 8 GB |
| `Qwen2.5 7B Instruct` (Q4_K_M) | ~4.5 GB | 8 GB |
| `Phi-3.5 Mini Instruct` (Q4_K_M) | ~2.2 GB | 6 GB |

**Steps in LMStudio:**

1. Open LMStudio
2. **Search** tab (magnifying glass) → search for a model (e.g. `mistral-7b-instruct`)
3. Click **Download** on the `Q4_K_M` variant
4. Once downloaded, go to the **Local Server** tab (icon `<->`)
5. Select your model from the dropdown
6. Click **Start Server** → the server starts on `http://localhost:1234`

> The URL `http://localhost:1234/v1` is pre-configured in Echo2Text. You can change it in the interface if needed.

### 7.4 Auto-start the LMStudio Server

To have LMStudio start its server automatically on launch:

- In LMStudio: `Settings > Local Server > Start server on app startup`

---

## 8. First Launch

### Windows
Double-click `start.bat` or run in a terminal:
```cmd
start.bat
```

### macOS
```bash
chmod +x start.sh
./start.sh
```

### What happens on first startup

1. The Python server (`server.py`) starts on port **8765**
2. The Parakeet model is downloaded from HuggingFace (~600 MB, **once only**)
3. The Electron window opens after ~5 seconds
4. The **ASR Server** dot turns green when the model is loaded (~30s–2min depending on your machine)
5. The **LMStudio** dot turns green if the LMStudio server is active on port 1234

### First recording

1. Click **▶ Start** → a setup modal opens
2. Enter the company name and meeting title
3. Click **▶ Start** in the modal
4. Speak — transcription appears in real time
5. Click **■ Stop** to end the session and generate the summary

---

## 9. macOS Launch (Apple M3)

The `start.sh` script is the macOS equivalent of `start.bat`.

```bash
./start.sh
```

**What `start.sh` does:**
- Detects the Python virtual environment (`venv/bin/python`) or falls back to `python3`
- Starts `server.py` in the background
- Waits 5 seconds
- Launches the Electron app via `npm start` in the `electron/` folder

**Differences from Windows:**
- On M3, transcription runs on **CPU** (ONNX Runtime ARM64) — slightly slower than an NVIDIA GPU, but perfectly usable
- No CUDA installation required
- The Parakeet TDT v3 model runs natively on Apple Silicon

---

## 10. Supported Audio Sources

| Source | Description |
|--------|-------------|
| **System microphone** | Default microphone |
| **Microphone X** | Any detected audio input device |
| **System audio** | Captures audio from Zoom, Teams, Meet, etc. (via loopback) |
| **YouTube / Web URL** | Opens a browser window, captures system audio |
| **Audio file** | Transcribe a wav, mp3, mp4, or ogg file |

> **System audio on macOS**: requires a third-party loopback driver such as [BlackHole](https://github.com/ExistentialAudio/BlackHole) (free).
> Install BlackHole, then in macOS Sound Preferences create an **Aggregate Device** combining your usual output + BlackHole. Select BlackHole as the source in Echo2Text.

---

## 11. FAQ / Troubleshooting

### The "ASR Server" dot stays red
- Make sure the Python server is running
- Check that port 8765 is free:
  - Windows: `netstat -ano | findstr 8765`
  - macOS: `lsof -i :8765`
- Check the logs in the terminal where the server is running

### Error installing `onnx-asr[gpu,hub]`
- Make sure CUDA 11.8+ is installed (Windows with NVIDIA GPU)
- On macOS M3 or a PC without a GPU, use `onnx-asr[hub]` (CPU only)

### The "LMStudio" dot stays red
- Make sure LMStudio is open and the local server is started (tab `<->`)
- Check the URL in Echo2Text: `http://localhost:1234/v1`
- Make sure a model is **loaded and active** in LMStudio

### `npm install` fails in `electron/`
- Check the Node.js version: `node -v` must be ≥ 18
- Delete `node_modules/` and retry: `rm -rf node_modules && npm install`

### No audio captured from Zoom/Teams (macOS)
- Install [BlackHole 2ch](https://github.com/ExistentialAudio/BlackHole) (free)
- In macOS Sound settings, create an **Aggregate Device** combining your mic + BlackHole
- Set this Aggregate Device as the output in Zoom/Teams
- In Echo2Text, select "BlackHole 2ch" as the audio source

### Transcription is slow
- On CPU (no GPU), expect ~2–5s latency per 5s audio chunk
- With an NVIDIA GPU, latency drops to <1s
- On M3, speed is comparable to a recent Intel Core i7 (sufficient for meeting use)
