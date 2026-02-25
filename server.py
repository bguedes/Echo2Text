import asyncio
import json
import numpy as np
import os
import queue
import struct
import threading
import time

from dotenv import load_dotenv
load_dotenv()

import onnx_asr
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse

# ─── Configuration ────────────────────────────────────────────────────────────
providers     = ['CUDAExecutionProvider', 'CPUExecutionProvider']
SAMPLE_RATE   = 16000
CHUNK_SECONDS = 5   # more context per inference → better accuracy

# ─── ASR model (loaded once) ──────────────────────────────────────────────────
_asr_model      = None
_asr_model_lock = threading.Lock()
_model_ready    = False

def get_model():
    global _asr_model, _model_ready
    with _asr_model_lock:
        if _asr_model is None:
            print("Loading Parakeet model…")
            _asr_model = (
                onnx_asr.load_model("nemo-parakeet-tdt-0.6b-v3", providers=providers)
                .with_timestamps()
            )
            _model_ready = True
            print("ASR model ready.")
    return _asr_model

# Pre-load in a background thread to avoid blocking server startup
def _preload():
    get_model()

threading.Thread(target=_preload, daemon=True).start()

# ─── Diarization pipeline (optional — requires HF_TOKEN) ──────────────────────

_diar_pipeline   = None
_diar_lock       = threading.Lock()
_diarization_on  = False
_embedding_model = None

def load_diarization():
    global _diar_pipeline, _diarization_on, _embedding_model
    hf_token = os.environ.get('HF_TOKEN', '').strip()
    if not hf_token:
        print("[diarization] HF_TOKEN missing — diarization disabled.")
        return
    try:
        from pyannote.audio import Pipeline, Inference
        import torch
        pipe = Pipeline.from_pretrained(
            "pyannote/speaker-diarization-3.1", use_auth_token=hf_token
        )
        emb = Inference("pyannote/embedding", window="whole", use_auth_token=hf_token)
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        pipe.to(device)
        with _diar_lock:
            _diar_pipeline   = pipe
            _embedding_model = emb
            _diarization_on  = True
        print(f"[diarization] Pipeline ready ({device}).")
    except Exception as e:
        print(f"[diarization] Error: {e}")

threading.Thread(target=load_diarization, daemon=True).start()

# ─── Cross-chunk speaker registry ─────────────────────────────────────────────

_speaker_embeddings = {}   # { global_id: centroid np.ndarray }
_speaker_counter    = 0
_registry_lock      = threading.Lock()

def _cosine_sim(a, b):
    denom = np.linalg.norm(a) * np.linalg.norm(b)
    return float(np.dot(a, b) / denom) if denom > 0 else 0.0

def _match_or_create_speaker(embedding, threshold=0.75):
    global _speaker_counter
    with _registry_lock:
        best_id, best_score = None, -1.0
        for gid, centroid in _speaker_embeddings.items():
            s = _cosine_sim(embedding, centroid)
            if s > best_score:
                best_score, best_id = s, gid
        if best_score >= threshold and best_id is not None:
            count = sum(1 for v in _speaker_embeddings if v == best_id)
            _speaker_embeddings[best_id] = (
                (_speaker_embeddings[best_id] * count + embedding) / (count + 1)
            )
            return best_id
        gid = f"SPEAKER_{_speaker_counter}"
        _speaker_counter += 1
        _speaker_embeddings[gid] = embedding
        return gid

# ─── Audio chunk diarization ──────────────────────────────────────────────────

def diarize_chunk(audio_float32, time_offset, sentences):
    """Assign a stable global speaker ID to each sentence. Modifies in-place."""
    if not _diarization_on:
        for s in sentences:
            s['speaker'] = None
        return
    try:
        import torch
        waveform = torch.from_numpy(audio_float32).unsqueeze(0)
        input_dict = {"waveform": waveform, "sample_rate": SAMPLE_RATE}

        diarization = _diar_pipeline(input_dict)

        # Extract embedding per local speaker → map to global_id
        local_to_global = {}
        for turn, _, local_label in diarization.itertracks(yield_label=True):
            if local_label in local_to_global:
                continue
            s_idx = int(turn.start * SAMPLE_RATE)
            e_idx = int(turn.end   * SAMPLE_RATE)
            seg   = audio_float32[s_idx:e_idx]
            if len(seg) < 1600:  # < 0.1s → too short
                continue
            seg_t = torch.from_numpy(seg).unsqueeze(0)
            emb   = _embedding_model({"waveform": seg_t, "sample_rate": SAMPLE_RATE})
            local_to_global[local_label] = _match_or_create_speaker(np.array(emb))

        # Assign speaker to each sentence by maximum time overlap
        for s in sentences:
            s_local_start = float(s['start']) - time_offset
            s_local_end   = float(s['end'])   - time_offset
            best_spk, best_overlap = None, 0.0
            for turn, _, local_label in diarization.itertracks(yield_label=True):
                overlap = min(s_local_end, turn.end) - max(s_local_start, turn.start)
                if overlap > best_overlap and local_label in local_to_global:
                    best_overlap = overlap
                    best_spk     = local_to_global[local_label]
            s['speaker'] = best_spk
    except Exception as e:
        print(f"[diarization] Chunk error: {e}")
        for s in sentences:
            s.setdefault('speaker', None)

# ─── Audio helpers ────────────────────────────────────────────────────────────

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

# ─── Transcription helpers ────────────────────────────────────────────────────

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

# ─── Background ASR thread ────────────────────────────────────────────────────

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
            if sents:
                diarize_chunk(chunk, time_offset, sents)
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
        if sents:
            diarize_chunk(buffer, time_offset, sents)
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

    global _speaker_embeddings, _speaker_counter
    with _registry_lock:
        _speaker_embeddings = {}
        _speaker_counter    = 0

    audio_q  = queue.Queue()
    asr_rq   = queue.Queue()
    stop_evt = threading.Event()

    asr_thread = threading.Thread(
        target=asr_worker, args=(audio_q, asr_rq, stop_evt), daemon=True
    )
    asr_thread.start()

    # Accumulators for the client
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
                    # End signal: flush and wait for the thread
                    audio_q.put(None)
                    stop_evt.set()
                    await asyncio.get_event_loop().run_in_executor(
                        None, lambda: asr_thread.join(timeout=60)
                    )
                    # Send any remaining final result
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

# ─── Entry point ──────────────────────────────────────────────────────────────

if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='127.0.0.1', port=8765, log_level='info')
