import asyncio
import json
import numpy as np
import queue
import struct
import threading
import time

import onnx_asr
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse

# ─── Configuration ────────────────────────────────────────────────────────────
providers     = ['CUDAExecutionProvider', 'CPUExecutionProvider']
SAMPLE_RATE   = 16000
CHUNK_SECONDS = 5   # plus de contexte par inférence → meilleure précision

# ─── Modèle ASR (chargé une seule fois) ──────────────────────────────────────
_asr_model      = None
_asr_model_lock = threading.Lock()
_model_ready    = False

def get_model():
    global _asr_model, _model_ready
    with _asr_model_lock:
        if _asr_model is None:
            print("Chargement du modèle Parakeet…")
            _asr_model = (
                onnx_asr.load_model("nemo-parakeet-tdt-0.6b-v3", providers=providers)
                .with_timestamps()
            )
            _model_ready = True
            print("Modèle ASR prêt.")
    return _asr_model

# Pré-chargement en thread de fond pour ne pas bloquer le démarrage du serveur
def _preload():
    get_model()

threading.Thread(target=_preload, daemon=True).start()

# ─── Helpers audio ────────────────────────────────────────────────────────────

def resample(audio, from_sr, to_sr=SAMPLE_RATE):
    if from_sr == to_sr:
        return audio
    new_len = int(len(audio) * to_sr / from_sr)
    return np.interp(
        np.linspace(0, len(audio) - 1, new_len), np.arange(len(audio)), audio
    ).astype(np.float32)

def float_to_int16(audio):
    if audio.dtype in (np.float32, np.float64):
        peak = np.max(np.abs(audio))
        if peak > 0:
            audio = audio / peak
        return (audio * 32767).astype(np.int16)
    return audio.astype(np.int16)

# ─── Helpers transcription ────────────────────────────────────────────────────

def convert_to_sentence_timestamps(timestamps, tokens):
    sentences, start, buf = [], None, []
    for i, tok in enumerate(tokens):
        if tok in {'.', '!', '?'}:
            if start is not None:
                buf.append(tok)
                sentences.append({
                    'start':   f"{start:.2f}",
                    'end':     f"{timestamps[i]:.2f}",
                    'segment': ''.join(buf).strip(),
                })
                start, buf = None, []
        else:
            if start is None:
                start = timestamps[i]
            buf.append(tok)
    return sentences

def _transcribe(audio_float32, time_offset):
    model = get_model()
    out   = model.recognize(float_to_int16(audio_float32))
    if not out.tokens:
        return [], '', 0.0
    raw_sents = convert_to_sentence_timestamps(out.timestamps, out.tokens)
    last_end  = float(raw_sents[-1]['end']) if raw_sents else 0.0
    sentences = [
        {
            'start':   f"{float(s['start']) + time_offset:.2f}",
            'end':     f"{float(s['end'])   + time_offset:.2f}",
            'segment': s['segment'],
        }
        for s in raw_sents
    ]
    return sentences, ''.join(out.tokens), last_end

# ─── Thread ASR de fond ───────────────────────────────────────────────────────

def asr_worker(audio_q, result_q, stop_event):
    buffer, time_offset = np.array([], dtype=np.float32), 0.0
    while not stop_event.is_set():
        try:
            while True:
                item = audio_q.get_nowait()
                if item is None:
                    _asr_flush(buffer, time_offset, result_q)
                    return
                buffer = np.concatenate([buffer, item])
        except queue.Empty:
            pass

        min_samples = CHUNK_SECONDS * SAMPLE_RATE
        if len(buffer) >= min_samples:
            chunk = buffer[:min_samples]
            sents, text, last_end = _transcribe(chunk, time_offset)
            result_q.put({'sentences': sents, 'text': text})
            if sents:
                carry  = int(last_end * SAMPLE_RATE)
                buffer = np.concatenate([chunk[carry:], buffer[min_samples:]])
                time_offset += last_end
            else:
                buffer = buffer[min_samples:]
                time_offset += CHUNK_SECONDS
        else:
            time.sleep(0.05)

    _asr_flush(buffer, time_offset, result_q)

def _asr_flush(buffer, time_offset, result_q):
    if len(buffer) >= SAMPLE_RATE // 2:
        sents, text, _ = _transcribe(buffer, time_offset)
        if sents or text:
            result_q.put({'sentences': sents, 'text': text, 'final': True})

# ─── FastAPI app ──────────────────────────────────────────────────────────────

app = FastAPI()

@app.get("/health")
async def health():
    return JSONResponse({"status": "ok", "model_ready": _model_ready})

@app.websocket("/ws/transcribe")
async def ws_transcribe(websocket: WebSocket):
    await websocket.accept()

    audio_q  = queue.Queue()
    asr_rq   = queue.Queue()
    stop_evt = threading.Event()

    asr_thread = threading.Thread(
        target=asr_worker, args=(audio_q, asr_rq, stop_evt), daemon=True
    )
    asr_thread.start()

    # Accumulateurs pour le client
    all_sentences = []
    full_text     = ''

    async def result_sender():
        nonlocal all_sentences, full_text
        while True:
            await asyncio.sleep(0.1)
            results = []
            while not asr_rq.empty():
                results.append(asr_rq.get_nowait())

            if results:
                for r in results:
                    all_sentences.extend(r.get('sentences', []))
                    t = r.get('text', '')
                    if t:
                        full_text += (' ' if full_text else '') + t
                payload = {
                    'type':      'transcript',
                    'sentences': all_sentences,
                    'fullText':  full_text,
                }
                await websocket.send_text(json.dumps(payload))

    sender_task = asyncio.create_task(result_sender())

    sample_rate = SAMPLE_RATE  # default

    try:
        while True:
            msg = await websocket.receive()

            if 'text' in msg:
                data = json.loads(msg['text'])
                if data.get('type') == 'config':
                    sample_rate = int(data.get('sampleRate', SAMPLE_RATE))
                elif data.get('type') == 'stop':
                    # Signal de fin : flush et attente
                    audio_q.put(None)
                    stop_evt.set()
                    await asyncio.get_event_loop().run_in_executor(
                        None, lambda: asr_thread.join(timeout=60)
                    )
                    # Envoyer le résultat final restant
                    while not asr_rq.empty():
                        r = asr_rq.get_nowait()
                        new_sents = r.get('sentences', [])
                        all_sentences.extend(new_sents)
                        t = r.get('text', '')
                        if t:
                            full_text += (' ' if full_text else '') + t
                    payload = {
                        'type':      'transcript',
                        'sentences': all_sentences,
                        'fullText':  full_text,
                        'final':     True,
                    }
                    await websocket.send_text(json.dumps(payload))

            elif 'bytes' in msg:
                raw = msg['bytes']
                # Float32Array (little-endian)
                n_samples = len(raw) // 4
                if n_samples > 0:
                    audio = np.frombuffer(raw, dtype='<f4').copy()
                    if sample_rate != SAMPLE_RATE:
                        audio = resample(audio, sample_rate)
                    audio_q.put(audio)

    except WebSocketDisconnect:
        pass
    finally:
        sender_task.cancel()
        stop_evt.set()
        audio_q.put(None)

# ─── Point d'entrée ───────────────────────────────────────────────────────────

if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='127.0.0.1', port=8765, log_level='info')
