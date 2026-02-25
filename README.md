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

# Parakeet — Transcription & Analyse temps réel

Application de bureau (Windows / macOS) pour la transcription en direct de réunions avec détection automatique des questions et actions, propulsée par le modèle ASR **NeMo Parakeet TDT 0.6B v3** (ONNX) et un LLM local via **LMStudio**.

---

## Table des matières

1. [Prérequis système](#1-prérequis-système)
2. [Installation de Node.js](#2-installation-de-nodejs)
3. [Installation de Python](#3-installation-de-python)
4. [Cloner / décompresser le projet](#4-cloner--décompresser-le-projet)
5. [Installer les dépendances Python](#5-installer-les-dépendances-python)
6. [Installer les dépendances Node.js](#6-installer-les-dépendances-nodejs)
7. [Installer et configurer LMStudio](#7-installer-et-configurer-lmstudio)
8. [Premier lancement](#8-premier-lancement)
9. [Lancement macOS (Apple M3)](#9-lancement-macos-apple-m3)
10. [Sources audio supportées](#10-sources-audio-supportées)
11. [FAQ / Problèmes courants](#11-faq--problèmes-courants)

---

## 1. Prérequis système

| Composant | Windows | macOS (M3) |
|-----------|---------|------------|
| OS | Windows 10/11 64-bit | macOS 14 Sonoma ou plus récent |
| GPU (optionnel) | NVIDIA CUDA 11.8+ | — (CPU uniquement, Metal non supporté par ONNX Runtime) |
| RAM | 8 Go minimum, 16 Go recommandé | 8 Go minimum, 16 Go recommandé |
| Espace disque | ~5 Go (modèle ~600 Mo + LMStudio) | ~5 Go |
| Python | 3.10 – 3.12 | 3.10 – 3.12 |
| Node.js | 18 LTS ou 20 LTS | 18 LTS ou 20 LTS |

> **GPU NVIDIA** : si vous disposez d'une carte NVIDIA, `onnx-asr` utilisera CUDA automatiquement pour accélérer la transcription. Sans GPU la transcription tourne sur CPU (plus lent mais fonctionnel).

---

## 2. Installation de Node.js

### Windows
Téléchargez l'installateur LTS depuis [https://nodejs.org](https://nodejs.org) et exécutez-le.
Vérification :
```cmd
node -v   # ex. v20.11.0
npm -v    # ex. 10.2.4
```

### macOS
```bash
# Via Homebrew (recommandé)
brew install node@20
# Ou via nvm (gestionnaire de versions)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.zshrc
nvm install 20
nvm use 20
```

---

## 3. Installation de Python

### Windows
Téléchargez Python 3.11 depuis [https://www.python.org/downloads/](https://www.python.org/downloads/).
**Important** : cochez "Add Python to PATH" lors de l'installation.
Vérification :
```cmd
python --version   # Python 3.11.x
```

### macOS (M3)
```bash
# Via Homebrew
brew install python@3.11
# Vérification
python3 --version  # Python 3.11.x
```

---

## 4. Cloner / décompresser le projet

```bash
# Via Git
git clone https://github.com/votre-repo/parakeet-tdt-0.6b-v3-onnx-cpu.git
cd parakeet-tdt-0.6b-v3-onnx-cpu

# Ou décompressez l'archive ZIP dans le dossier de votre choix
```

---

## 5. Installer les dépendances Python

Le projet utilise un **environnement virtuel** (`venv`) isolé du Python système.

### Windows
```cmd
cd parakeet-tdt-0.6b-v3-onnx-cpu

:: Créer l'environnement virtuel
python -m venv venv

:: Activer l'environnement
venv\Scripts\activate

:: Installer les dépendances
pip install -r requirements.txt
```

> **Avec GPU NVIDIA** : `onnx-asr[gpu,hub]` installe automatiquement `onnxruntime-gpu`. Assurez-vous que CUDA 11.8+ est installé.
> **Sans GPU** : remplacez `onnx-asr[gpu,hub]` par `onnx-asr[hub]` dans `requirements.txt` avant l'installation.

### macOS (M3)
```bash
cd parakeet-tdt-0.6b-v3-onnx-cpu

# Créer l'environnement virtuel
python3 -m venv venv

# Activer l'environnement
source venv/bin/activate

# Installer les dépendances (CPU uniquement sur M3)
pip install "onnx-asr[hub]>=0.6.1" "fastapi>=0.115.0" "uvicorn[standard]>=0.30.0"
```

> Sur Apple Silicon, `onnxruntime` s'exécute en mode CPU. La directive `[gpu]` n'est pas nécessaire.

Le premier lancement téléchargera automatiquement le modèle **nemo-parakeet-tdt-0.6b-v3** (~600 Mo) depuis HuggingFace Hub.

---

## 6. Installer les dépendances Node.js

```bash
cd electron
npm install
```

Cela installe uniquement **Electron ^32** (défini dans `electron/package.json`). Aucune dépendance native n'est requise.

---

## 7. Installer et configurer LMStudio

LMStudio est le serveur LLM local qui fournit les réponses aux questions détectées et génère le résumé de réunion.

### 7.1 Installation automatique (scripts fournis)

#### Windows
```cmd
install-lmstudio.bat
```

#### macOS
```bash
chmod +x install-lmstudio.sh
./install-lmstudio.sh
```

Ces scripts téléchargent et installent LMStudio automatiquement.

### 7.2 Installation manuelle

1. Rendez-vous sur [https://lmstudio.ai](https://lmstudio.ai)
2. Téléchargez la version correspondant à votre système :
   - **Windows** : `LM-Studio-x.x.x-Setup.exe`
   - **macOS (Apple Silicon)** : `LM-Studio-x.x.x-arm64.dmg`
3. Installez l'application

### 7.3 Chargement d'un modèle LLM

Parakeet fonctionne avec n'importe quel modèle compatible **OpenAI chat completions** chargé dans LMStudio.

**Modèles recommandés** (bon équilibre vitesse / qualité) :

| Modèle | Taille | RAM nécessaire |
|--------|--------|---------------|
| `Mistral 7B Instruct v0.3` (Q4_K_M) | ~4.4 Go | 8 Go |
| `Llama 3.1 8B Instruct` (Q4_K_M) | ~4.9 Go | 8 Go |
| `Qwen2.5 7B Instruct` (Q4_K_M) | ~4.5 Go | 8 Go |
| `Phi-3.5 Mini Instruct` (Q4_K_M) | ~2.2 Go | 6 Go |

**Étapes dans LMStudio :**

1. Ouvrez LMStudio
2. Onglet **Search** (loupe) → cherchez le modèle souhaité (ex. `mistral-7b-instruct`)
3. Cliquez **Download** sur la variante `Q4_K_M`
4. Une fois téléchargé, onglet **Local Server** (icône `<->`)
5. Sélectionnez le modèle dans le menu déroulant
6. Cliquez **Start Server** → le serveur démarre sur `http://localhost:1234`

> L'URL `http://localhost:1234/v1` est pré-configurée dans Parakeet. Vous pouvez la modifier dans l'interface si nécessaire.

### 7.4 Démarrage automatique du serveur LMStudio

Pour que LMStudio démarre son serveur au lancement :

- Dans LMStudio : `Settings > Local Server > Start server on app startup`

---

## 8. Premier lancement

### Windows
Double-cliquez sur `start.bat` ou exécutez dans un terminal :
```cmd
start.bat
```

### macOS
```bash
chmod +x start.sh
./start.sh
```

### Ce qui se passe au premier démarrage

1. Le serveur Python (`server.py`) démarre sur le port **8765**
2. Le modèle Parakeet est téléchargé depuis HuggingFace (~600 Mo, **une seule fois**)
3. La fenêtre Electron s'ouvre après ~5 secondes
4. Le point **Serveur ASR** passe au vert quand le modèle est chargé (~30s–2min selon votre machine)
5. Le point **LMStudio** passe au vert si le serveur LMStudio est actif sur le port 1234

### Premier enregistrement

1. Cliquez **▶ Démarrer** → une modal s'ouvre
2. Saisissez le nom de l'entreprise et le titre de la réunion
3. Cliquez **▶ Démarrer** dans la modal
4. Parlez — la transcription apparaît en temps réel
5. Cliquez **■ Arrêter** pour terminer et générer le résumé

---

## 9. Lancement macOS (Apple M3)

Le script `start.sh` est l'équivalent de `start.bat` pour macOS.

```bash
./start.sh
```

**Ce que fait `start.sh` :**
- Détecte l'environnement virtuel Python (`venv/bin/python`) ou utilise `python3`
- Lance `server.py` en arrière-plan
- Attend 5 secondes
- Lance l'application Electron via `npm start` dans le dossier `electron/`

**Différences avec Windows :**
- Sur M3, la transcription s'effectue en **CPU** (ONNX Runtime ARM64) — légèrement plus lent qu'avec un GPU NVIDIA, mais parfaitement utilisable
- Aucune installation de CUDA nécessaire
- Le modèle Parakeet TDT v3 tourne nativement sur Apple Silicon

---

## 10. Sources audio supportées

| Source | Description |
|--------|-------------|
| **Micro système** | Microphone par défaut |
| **Micro X** | Tout périphérique d'entrée audio détecté |
| **Audio système** | Capture l'audio de Zoom, Teams, Meet, etc. (via loopback) |
| **YouTube / URL Web** | Ouvre une fenêtre navigateur, capture l'audio système |
| **Fichier audio** | Transcription d'un fichier wav, mp3, mp4, ogg |

> **Audio système sur macOS** : nécessite un pilote loopback tiers comme [BlackHole](https://github.com/ExistentialAudio/BlackHole) (gratuit).
> Installez BlackHole, puis dans les Préférences Son macOS créez un **Aggregate Device** combinant votre sortie habituelle + BlackHole. Sélectionnez BlackHole comme source dans Parakeet.

---

## 11. FAQ / Problèmes courants

### Le point "Serveur ASR" reste rouge
- Vérifiez que le serveur Python est démarré
- Vérifiez que le port 8765 est libre :
  - Windows : `netstat -ano | findstr 8765`
  - macOS : `lsof -i :8765`
- Consultez les logs dans le terminal

### Erreur lors de l'installation de `onnx-asr[gpu,hub]`
- Assurez-vous que CUDA 11.8+ est installé (Windows avec GPU NVIDIA)
- Sur macOS M3 ou PC sans GPU, utilisez `onnx-asr[hub]` (CPU uniquement)

### Le point "LMStudio" reste rouge
- Vérifiez que LMStudio est ouvert et que le serveur local est démarré (onglet `<->`)
- Vérifiez l'URL dans Parakeet : `http://localhost:1234/v1`
- Assurez-vous qu'un modèle est **chargé et actif** dans LMStudio

### `npm install` échoue dans `electron/`
- Vérifiez la version Node.js : `node -v` doit être ≥ 18
- Supprimez `node_modules/` et relancez : `rm -rf node_modules && npm install`

### Aucun son capturé depuis Zoom/Teams (macOS)
- Installez [BlackHole 2ch](https://github.com/ExistentialAudio/BlackHole) (gratuit)
- Dans les réglages son macOS, créez un **Aggregate Device** combinant votre micro + BlackHole
- Sélectionnez cet Aggregate Device comme sortie dans Zoom/Teams
- Dans Parakeet, sélectionnez "BlackHole 2ch" comme source audio

### La transcription est lente
- Sur CPU (sans GPU), comptez ~2–5s de latence par chunk de 5s de parole
- Avec GPU NVIDIA, la latence tombe à <1s
- Sur M3, la vitesse est comparable à un CPU Intel Core i7 récent (suffisant pour usage en réunion)
