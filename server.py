import asyncio
import concurrent.futures as _cf
import json
import numpy as np
import os
import platform as _sys_platform
import queue
import struct
import sys
import threading
import time
import warnings
import wave

# Suppress harmless warnings from pyannote / Lightning at model load time.
warnings.filterwarnings('ignore', category=UserWarning, module=r'pyannote\.audio\.core\.io')
# Lightning auto-upgrade message (checkpoint v1 → v2)
warnings.filterwarnings('ignore', message=r'.*Lightning automatically upgraded.*')
# pyannote embedding model loaded without its task-dependent loss
warnings.filterwarnings('ignore', message=r'.*task-dependent loss function.*')
# Lightning reports loss_func.W not in model state dict — expected for inference-only load
warnings.filterwarnings('ignore', message=r'.*keys that are not in the model state dict.*')
# Lightning redirects legacy pytorch_lightning imports to lightning.pytorch — harmless migration shim
warnings.filterwarnings('ignore', message=r'.*Redirecting import of pytorch_lightning.*')

from dotenv import load_dotenv
load_dotenv()

# ─── Platform detection ───────────────────────────────────────────────────────
def _detect_backend():
    """MLX on Apple Silicon, ONNX everywhere else."""
    if os.environ.get('PARAKEET_BACKEND', '').lower() == 'onnx':
        return 'onnx'
    if sys.platform == 'darwin' and _sys_platform.machine() == 'arm64':
        try:
            import mlx.core  # noqa — check MLX is installed
            return 'mlx'
        except ImportError:
            pass
    return 'onnx'

BACKEND = _detect_backend()
print(f"[backend] {'MLX (Apple Silicon)' if BACKEND == 'mlx' else 'ONNX Runtime'}")

if BACKEND == 'onnx':
    import onnxruntime as _ort
    import onnx_asr
    _available = _ort.get_available_providers()
    providers = [p for p in ['CUDAExecutionProvider', 'CPUExecutionProvider'] if p in _available]
    if not providers:
        providers = ['CPUExecutionProvider']

import subprocess
import tempfile

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse

# ─── Configuration ────────────────────────────────────────────────────────────
SAMPLE_RATE   = 16000
CHUNK_SECONDS = 3   # shorter chunks → more frequent real-time updates

# Diarization tuning — overridable via .env
# DIAR_MATCH_THRESHOLD : cosine similarity required to match a new embedding to an
#   existing speaker.  Lower = more permissive (fewer false new speakers).
#   Raise if different people are incorrectly merged; lower if the same person
#   keeps getting split into several SPEAKER_ IDs.  Range [0.0 – 1.0].
# DIAR_MERGE_THRESHOLD : cosine similarity above which two speaker centroids are
#   considered identical and merged post-hoc.  Should always be > DIAR_MATCH_THRESHOLD.
#   Range [0.0 – 1.0].
# DIAR_MIN_SEGMENT_S : minimum turn duration (seconds) for which an embedding is
#   extracted.  Very short segments produce noisy embeddings; 1.0 s is a safe floor.
# DIAR_CONTEXT_S : seconds of audio kept as preroll from the previous chunk and
#   prepended to each new diarization window to provide cross-chunk speaker context.
DIAR_MATCH_THRESHOLD = float(os.environ.get('DIAR_MATCH_THRESHOLD', '0.45'))
DIAR_MERGE_THRESHOLD = float(os.environ.get('DIAR_MERGE_THRESHOLD', '0.65'))
DIAR_MIN_SEGMENT_S   = float(os.environ.get('DIAR_MIN_SEGMENT_S',   '1.0'))
DIAR_CONTEXT_S       = float(os.environ.get('DIAR_CONTEXT_S',       '2.0'))

# Mutex that serialises ALL _diar_pipeline calls across threads.
# pyannote's pipeline is not thread-safe: concurrent calls from the WS
# diarization pool and /transcribe-full would cause heap corruption or wrong
# results.  Each session creates its own ThreadPoolExecutor (see ws_transcribe)
# so there is no cross-session backlog.
_pipeline_lock = threading.Lock()

# ─── ASR model (loaded once) ──────────────────────────────────────────────────
_asr_model      = None
_asr_model_lock = threading.Lock()
_model_ready    = False

# ─── MLX single-thread executor ───────────────────────────────────────────────
# Metal (MLX GPU) requires all GPU calls to happen on the same thread that
# initialized the Metal context.  Calling from arbitrary threads causes
# SIGSEGV in mlx::core::metal::CommandEncoder::dispatch_threads.
# Solution: one dedicated persistent thread owns all MLX calls.
if BACKEND == 'mlx':
    _mlx_request_q  = queue.Queue()   # (fn, args, kwargs, result_event, result_box)
    _mlx_result_box = {}              # filled by the MLX thread

    def _mlx_thread_main():
        """Persistent thread that owns the Metal context."""
        # Import and initialise MLX here — this thread owns the Metal context.
        from parakeet_mlx import from_pretrained as _ptrained
        global _asr_model, _model_ready
        print("Loading Parakeet MLX model (GPU)…")
        _asr_model   = _ptrained("mlx-community/parakeet-tdt-0.6b-v3")
        _model_ready = True
        print("ASR model ready (MLX GPU).")

        while True:
            fn, args, kwargs, done_event, box = _mlx_request_q.get()
            if fn is None:   # shutdown sentinel
                break
            try:
                box['result'] = fn(*args, **kwargs)
            except BaseException as exc:
                # Catch ALL exceptions (including Metal/GPU internal errors)
                # so the thread never exits the loop and future _mlx_call()s
                # don't block forever on event.wait().
                box['error'] = exc
            finally:
                done_event.set()

    _mlx_thread = threading.Thread(target=_mlx_thread_main, daemon=True, name='mlx-gpu')
    _mlx_thread.start()

    def _mlx_call(fn, *args, **kwargs):
        """Submit fn(*args, **kwargs) to the MLX thread and return the result."""
        box   = {}
        event = threading.Event()
        _mlx_request_q.put((fn, args, kwargs, event, box))
        event.wait()
        if 'error' in box:
            raise box['error']
        return box['result']

def get_model():
    global _asr_model, _model_ready
    if BACKEND == 'mlx':
        # Model is loaded by the MLX thread; wait until ready.
        _mlx_thread.join(timeout=0)   # non-blocking — just check
        while not _model_ready:
            time.sleep(0.1)
        return _asr_model
    with _asr_model_lock:
        if _asr_model is None:
            print("Loading Parakeet ONNX model…")
            _asr_model = (
                onnx_asr.load_model("nemo-parakeet-tdt-0.6b-v3", providers=providers)
                .with_timestamps()
            )
            _model_ready = True
            print("ASR model ready.")
    return _asr_model

# Pre-load ONNX model in a background thread (MLX is loaded by _mlx_thread above)
if BACKEND == 'onnx':
    threading.Thread(target=get_model, daemon=True).start()

# ─── Diarization pipeline (optional — requires HF_TOKEN) ──────────────────────

_diar_pipeline   = None
_diar_lock       = threading.Lock()
_diarization_on  = False
_embedding_model = None
_diar_on_gpu     = False   # True only when pyannote runs on CUDA (Windows/RTX)

def load_diarization():
    global _diar_pipeline, _diarization_on, _embedding_model, _diar_on_gpu
    hf_token = os.environ.get('HF_TOKEN', '').strip()
    if not hf_token:
        print("[diarization] HF_TOKEN missing — diarization disabled.")
        return
    try:
        from pyannote.audio import Pipeline, Inference, Model
        import torch
        pipe = Pipeline.from_pretrained(
            "pyannote/speaker-diarization-3.1", token=hf_token
        )
        emb_model = Model.from_pretrained("pyannote/embedding", token=hf_token)
        emb = Inference(emb_model, window="whole")
        if torch.cuda.is_available():
            device = torch.device('cuda')
        else:
            # MPS (Apple Silicon) excluded: several pyannote ops (SincNet, etc.)
            # are not fully supported on MPS and cause device-mismatch errors
            # between the pipeline and the embedding model.  CPU is reliable on
            # all platforms and fast enough for speaker diarization.
            device = torch.device('cpu')
        pipe.to(device)
        emb_model.to(device)  # keep embedding model on the same device as pipeline
        with _diar_lock:
            _diar_pipeline   = pipe
            _embedding_model = emb
            _diarization_on  = True
            _diar_on_gpu     = (device.type == 'cuda')
        print(f"[diarization] Pipeline ready ({device}).")
    except Exception as e:
        import traceback
        msg = str(e)
        if '403' in msg or 'gated' in msg or 'restricted' in msg:
            import re
            match = re.search(r'pyannote/[\w\-]+', msg)
            model = match.group(0) if match else 'a pyannote model'
            print(f"[diarization] Access denied to {model}.")
            print(f"[diarization] Accept terms at: https://huggingface.co/{model}")
            print(f"[diarization] Then restart the server.")
        else:
            print(f"[diarization] LOAD ERROR: {e}")
            print("[diarization] Full traceback:")
            traceback.print_exc()

threading.Thread(target=load_diarization, daemon=True).start()

# ─── Cross-chunk speaker registry ─────────────────────────────────────────────

_speaker_embeddings = {}   # { global_id: centroid np.ndarray }
_speaker_counts     = {}   # { global_id: int } — number of embeddings averaged in
_speaker_counter    = 0
_registry_lock      = threading.Lock()

def _cosine_sim(a, b):
    a, b = a.flatten(), b.flatten()
    denom = np.linalg.norm(a) * np.linalg.norm(b)
    return float(np.dot(a, b) / denom) if denom > 0 else 0.0

def _match_or_create_speaker(embedding, threshold=None):
    global _speaker_counter
    if threshold is None:
        threshold = DIAR_MATCH_THRESHOLD
    embedding = np.array(embedding).flatten()
    with _registry_lock:
        best_id, best_score = None, -1.0
        for gid, centroid in _speaker_embeddings.items():
            s = _cosine_sim(embedding, centroid)
            if s > best_score:
                best_score, best_id = s, gid
        if best_score >= threshold and best_id is not None:
            count = _speaker_counts[best_id]
            _speaker_embeddings[best_id] = (
                (_speaker_embeddings[best_id] * count + embedding) / (count + 1)
            )
            _speaker_counts[best_id] = count + 1
            return best_id
        gid = f"SPEAKER_{_speaker_counter}"
        _speaker_counter += 1
        _speaker_embeddings[gid] = embedding
        _speaker_counts[gid]     = 1
        return gid

def _merge_similar_speakers(merge_threshold=None):
    """
    After each chunk, scan the speaker registry for pairs whose centroids are

    close enough to be the same person (cosine similarity ≥ merge_threshold).
    Merge the less-observed speaker into the more-observed one and return a
    mapping  {removed_id: kept_id}  so callers can reassign sentence labels.

    Why this is needed: a short or noisy segment at a chunk boundary may yield
    an embedding that misses the match threshold → a new SPEAKER_ is created.
    This function detects such duplicates after the fact and collapses them.
    """
    if merge_threshold is None:
        merge_threshold = DIAR_MERGE_THRESHOLD
    global _speaker_embeddings, _speaker_counts
    merge_map = {}
    with _registry_lock:
        # Repeat until no more pairs can be merged in a single pass.
        changed = True
        while changed:
            changed = False
            ids = list(_speaker_embeddings.keys())
            for i in range(len(ids)):
                for j in range(i + 1, len(ids)):
                    a, b = ids[i], ids[j]
                    # Either might have been removed in the current pass.
                    if a not in _speaker_embeddings or b not in _speaker_embeddings:
                        continue
                    sim = _cosine_sim(_speaker_embeddings[a], _speaker_embeddings[b])
                    if sim < merge_threshold:
                        continue
                    # Keep the speaker with more accumulated samples (more reliable centroid).
                    if _speaker_counts.get(a, 0) >= _speaker_counts.get(b, 0):
                        keeper, removed = a, b
                    else:
                        keeper, removed = b, a
                    # Weighted average of both centroids.
                    ck, cr = _speaker_counts[keeper], _speaker_counts[removed]
                    _speaker_embeddings[keeper] = (
                        _speaker_embeddings[keeper] * ck + _speaker_embeddings[removed] * cr
                    ) / (ck + cr)
                    _speaker_counts[keeper] = ck + cr
                    del _speaker_embeddings[removed]
                    del _speaker_counts[removed]
                    # Chain transitive merges: if removed was itself a merge target.
                    for k, v in list(merge_map.items()):
                        if v == removed:
                            merge_map[k] = keeper
                    merge_map[removed] = keeper
                    changed = True
                    break
                if changed:
                    break
    return merge_map

# ─── Audio chunk diarization ──────────────────────────────────────────────────

def diarize_chunk(audio_float32, time_offset, sentences, num_speakers=None):
    """Assign a stable global speaker ID to each sentence. Modifies in-place.

    Returns a merge_map dict {removed_id: kept_id} when post-hoc merging
    collapsed duplicate speakers, so callers can fix already-sent sentences.
    Returns an empty dict when no merges occurred.
    """
    if not _diarization_on:
        for s in sentences:
            s['speaker'] = None
        return {}
    try:
        import torch
        waveform = torch.from_numpy(audio_float32).unsqueeze(0)
        input_dict = {"waveform": waveform, "sample_rate": SAMPLE_RATE}

        kwargs = {}
        if num_speakers is not None:
            # Pass only as upper bound — forcing min=max causes warnings when
            # a chunk has fewer speakers than expected (e.g. bounds [2,2] with 1 speaker)
            kwargs['max_speakers'] = num_speakers
        with _pipeline_lock:
            result = _diar_pipeline(input_dict, **kwargs)
        # pyannote 3.x returns DiarizeOutput(speaker_diarization=Annotation, ...)
        # pyannote 2.x returns Annotation directly (has itertracks)
        if hasattr(result, 'itertracks'):
            diarization = result
        elif hasattr(result, 'speaker_diarization'):
            diarization = result.speaker_diarization
        elif hasattr(result, 'diarization'):
            diarization = result.diarization
        elif hasattr(result, 'annotation'):
            diarization = result.annotation
        else:
            raise ValueError(f"Unexpected diarization output type: {type(result)}")

        # Extract embedding per local speaker → map to global_id
        local_to_global = {}
        for turn, _, local_label in diarization.itertracks(yield_label=True):
            if local_label in local_to_global:
                continue
            s_idx = int(turn.start * SAMPLE_RATE)
            e_idx = int(turn.end   * SAMPLE_RATE)
            seg   = audio_float32[s_idx:e_idx]
            if len(seg) < int(DIAR_MIN_SEGMENT_S * SAMPLE_RATE):  # too short for reliable embedding
                continue
            seg_t   = torch.from_numpy(seg).unsqueeze(0)
            emb     = _embedding_model({"waveform": seg_t, "sample_rate": SAMPLE_RATE})
            emb_arr = np.array(emb).flatten()
            if not np.isfinite(emb_arr).all():
                continue  # NaN / Inf embedding from silent/noisy segment — skip
            local_to_global[local_label] = _match_or_create_speaker(emb_arr)

        # Build turn list once (re-iterating Annotation is fine but cleaner this way)
        all_turns = [
            (turn.start, turn.end, local_to_global[local_label])
            for turn, _, local_label in diarization.itertracks(yield_label=True)
            if local_label in local_to_global
        ]

        # Assign speaker to each sentence by maximum time overlap;
        # fall back to nearest turn when no overlap is found (e.g. very short turn
        # at chunk boundary whose embedding was skipped).
        for s in sentences:
            s_local_start = float(s['start']) - time_offset
            s_local_end   = float(s['end'])   - time_offset
            best_spk, best_overlap   = None, 0.0
            nearest_spk, nearest_dist = None, float('inf')
            for (ts, te, gid) in all_turns:
                overlap = min(s_local_end, te) - max(s_local_start, ts)
                if overlap > best_overlap:
                    best_overlap = overlap
                    best_spk     = gid
                dist = min(abs(s_local_start - te), abs(s_local_end - ts))
                if dist < nearest_dist:
                    nearest_dist = dist
                    nearest_spk  = gid
            s['speaker'] = best_spk if best_overlap > 0 else nearest_spk

        # Smooth isolated very-short speaker "islands": if sentence i-1 and i+1
        # share the same speaker and sentence i is different but very short, it is
        # likely a diarization artefact — reassign to the surrounding speaker.
        for i in range(1, len(sentences) - 1):
            prev_spk = sentences[i - 1].get('speaker')
            next_spk = sentences[i + 1].get('speaker')
            curr_spk = sentences[i].get('speaker')
            if (prev_spk and next_spk and prev_spk == next_spk and curr_spk != prev_spk):
                duration = float(sentences[i]['end']) - float(sentences[i]['start'])
                if duration < 1.5:
                    sentences[i]['speaker'] = prev_spk

        # Post-hoc merge: collapse any duplicate speakers created by noisy
        # short-segment embeddings, then apply the merge map to this chunk's sentences.
        merge_map = _merge_similar_speakers()
        if merge_map:
            print(f"[diarization] Merged speakers: {merge_map}")
            for s in sentences:
                if s.get('speaker') in merge_map:
                    s['speaker'] = merge_map[s['speaker']]
        return merge_map

    except Exception as e:
        import traceback
        print(f"[diarization] Chunk error: {e}")
        traceback.print_exc()
        for s in sentences:
            s.setdefault('speaker', None)
        return {}

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
    return _transcribe_mlx(audio_float32, time_offset) if BACKEND == 'mlx' \
           else _transcribe_onnx(audio_float32, time_offset)

# ── Backend ONNX ──────────────────────────────────────────────────────────────
def _transcribe_onnx(audio_float32, time_offset):
    model = get_model()
    out   = model.recognize(float_to_int16(audio_float32))
    if not out.tokens:
        return [], '', 0.0
    raw_sents = convert_to_sentence_timestamps(out.timestamps, out.tokens)
    if not raw_sents:
        # No punctuation → no sentence boundaries detected.
        # Create one synthetic sentence spanning the full chunk so timestamps
        # and diarization still work (same fallback as the MLX backend).
        text    = ''.join(out.tokens).strip()
        last_ts = float(out.timestamps[-1]) if out.timestamps else 0.0
        if text:
            return (
                [{'start': f"{time_offset:.2f}",
                  'end':   f"{time_offset + last_ts:.2f}",
                  'segment': text}],
                text,
                last_ts,
            )
        return [], ''.join(out.tokens), 0.0
    last_end  = float(raw_sents[-1]['end'])
    sentences = [
        {
            'start':   f"{float(s['start']) + time_offset:.2f}",
            'end':     f"{float(s['end'])   + time_offset:.2f}",
            'segment': s['segment'],
        }
        for s in raw_sents
    ]
    return sentences, ''.join(out.tokens), last_end

# ── Backend MLX (Apple Silicon) ───────────────────────────────────────────────
def _transcribe_mlx(audio_float32, time_offset):
    """
    parakeet-mlx expects an audio file path. Write a temporary WAV, then
    dispatch model.transcribe() to the dedicated MLX thread (Metal owner).
    """
    import tempfile
    fd, tmp = tempfile.mkstemp(suffix='.wav')
    os.close(fd)
    try:
        pcm = (audio_float32 * 32767).clip(-32768, 32767).astype(np.int16)
        with wave.open(tmp, 'wb') as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(SAMPLE_RATE)
            wf.writeframes(pcm.tobytes())
        # Run on the MLX thread that owns the Metal context
        model  = get_model()
        result = _mlx_call(model.transcribe, tmp)
    finally:
        os.unlink(tmp)

    if not result.sentences:
        # parakeet found speech but no sentence boundaries (no punctuation).
        # Create one synthetic sentence spanning the full audio chunk so that
        # timestamps and diarization still work downstream.
        if result.text:
            duration = len(audio_float32) / SAMPLE_RATE
            return (
                [{'start': f"{time_offset:.2f}",
                  'end':   f"{time_offset + duration:.2f}",
                  'segment': result.text}],
                result.text,
                duration,
            )
        return [], '', 0.0
    sentences = [
        {
            'start':   f"{s.start + time_offset:.2f}",
            'end':     f"{s.end   + time_offset:.2f}",
            'segment': s.text,
        }
        for s in result.sentences
    ]
    return sentences, result.text, result.sentences[-1].end

# ─── Background diarization helper ───────────────────────────────────────────

def _diarize_and_notify(diar_audio, diar_offset, sentences, num_speakers, result_q):
    """
    Called from the per-session diarization pool (background thread).
    Runs diarization on diar_audio, updates sentence dicts in-place, then
    pushes a lightweight 'diar_refresh' marker so result_sender re-renders.
    Because the sentence dicts are shared objects (same refs as in all_sentences
    on the server side), the in-place update is visible to the next poll.
    """
    try:
        merge_map = diarize_chunk(diar_audio, diar_offset, sentences, num_speakers) or {}
        result_q.put({'diar_refresh': True, 'merge_map': merge_map})
    except Exception as e:
        print(f"[diarization] Async error: {e}")

# ─── Background ASR thread ────────────────────────────────────────────────────

def asr_worker(audio_q, result_q, stop_event, num_speakers_ref=None, diar_pool=None):
    buffer, time_offset = np.array([], dtype=np.float32), 0.0
    # Rolling preroll: keep the last DIAR_CTX_SECONDS of processed audio so
    # each chunk's diarization window overlaps with the previous one.
    # This gives pyannote enough context to correctly identify speakers at
    # chunk boundaries instead of starting "cold" each time.
    DIAR_CTX_SAMPLES = int(DIAR_CONTEXT_S * SAMPLE_RATE)  # preroll context for cross-chunk diarization
    diar_context = np.array([], dtype=np.float32)

    while not stop_event.is_set():
        try:
            while True:
                item = audio_q.get_nowait()
                if item is None:
                    _asr_flush(buffer, time_offset, result_q, num_speakers_ref, diar_context)
                    return
                buffer = np.concatenate([buffer, item])
        except queue.Empty:
            pass

        min_samples = CHUNK_SECONDS * SAMPLE_RATE
        if len(buffer) >= min_samples:
            chunk = buffer[:min_samples]
            try:
                sents, text, last_end = _transcribe(chunk, time_offset)
            except Exception as exc:
                # Transcription error (e.g. Metal GPU crash, bad audio) — log and
                # skip this chunk rather than killing the asr_worker thread.
                print(f"[asr_worker] _transcribe error (chunk skipped): {exc}")
                diar_context = np.concatenate([diar_context, chunk])[-DIAR_CTX_SAMPLES:]
                buffer = buffer[min_samples:]
                time_offset += CHUNK_SECONDS
                continue
            ns = num_speakers_ref[0] if num_speakers_ref else None

            # ── Send ASR result immediately — do NOT wait for diarization ──────
            # Speaker fields start as None; _diarize_and_notify will fill them
            # in-place once the background task completes.
            for s in sents:
                s['speaker'] = None
            result_q.put({'sentences': sents, 'text': text, 'merge_map': {}})

            # ── Submit diarization to per-session pool (non-blocking) ────────
            if sents and _diarization_on and diar_pool is not None:
                if len(diar_context) > 0:
                    # np.concatenate always creates a new array → safe to pass to thread
                    diar_audio  = np.concatenate([diar_context, chunk])
                    diar_offset = time_offset - len(diar_context) / SAMPLE_RATE
                else:
                    diar_audio  = chunk.copy()
                    diar_offset = time_offset
                diar_pool.submit(
                    _diarize_and_notify, diar_audio, diar_offset, sents, ns, result_q
                )

            if sents:
                carry  = int(last_end * SAMPLE_RATE)
                diar_context = np.concatenate([diar_context, chunk[:carry]])[-DIAR_CTX_SAMPLES:]
                buffer = np.concatenate([chunk[carry:], buffer[min_samples:]])
                time_offset += last_end
            else:
                diar_context = np.concatenate([diar_context, chunk])[-DIAR_CTX_SAMPLES:]
                buffer = buffer[min_samples:]
                time_offset += CHUNK_SECONDS
        else:
            time.sleep(0.05)

    _asr_flush(buffer, time_offset, result_q, num_speakers_ref, diar_context)

def _asr_flush(buffer, time_offset, result_q, num_speakers_ref=None, diar_context=None):
    if len(buffer) >= SAMPLE_RATE // 2:
        sents, text, _ = _transcribe(buffer, time_offset)
        ns = num_speakers_ref[0] if num_speakers_ref else None
        merge_map = {}
        if sents:
            if _diar_on_gpu:
                # GPU diarization (Windows/RTX): fast enough to run synchronously
                if diar_context is not None and len(diar_context) > 0:
                    diar_audio  = np.concatenate([diar_context, buffer])
                    diar_offset = time_offset - len(diar_context) / SAMPLE_RATE
                else:
                    diar_audio  = buffer
                    diar_offset = time_offset
                merge_map = diarize_chunk(diar_audio, diar_offset, sents, ns) or {}
            else:
                # CPU diarization (macOS): skip synchronous call in flush — it
                # would block the WS stop handler for 30-120 s per chunk.
                # /transcribe-full will run a single-pass diarization on the
                # full audio instead.
                for s in sents:
                    s.setdefault('speaker', None)
        if sents or text:
            result_q.put({'sentences': sents, 'text': text, 'final': True, 'merge_map': merge_map})

# ─── Pool helpers ─────────────────────────────────────────────────────────────

def _shutdown_pool(pool, wait=True):
    """Shut down a ThreadPoolExecutor, cancelling queued (not-yet-started) tasks.

    Python 3.9+ supports cancel_futures=True natively.  On older versions we
    fall back to shutdown(wait=wait) which drains the queue normally.
    """
    try:
        pool.shutdown(wait=wait, cancel_futures=True)
    except TypeError:
        pool.shutdown(wait=wait)

# ─── FastAPI app ──────────────────────────────────────────────────────────────

app = FastAPI()

@app.get("/health")
async def health():
    return JSONResponse({"status": "ok", "model_ready": _model_ready})

@app.get("/shutdown")
async def shutdown():
    """Called by Electron on window close to cleanly terminate the server."""
    def _exit():
        time.sleep(0.15)
        os._exit(0)
    threading.Thread(target=_exit, daemon=True).start()
    return JSONResponse({"status": "shutting down"})

@app.post("/transcribe-file")
async def transcribe_file_endpoint(request: Request):
    """
    Accept a JSON body {"path": "/absolute/path/to/file"}.
    Uses ffmpeg to decode any audio/video format → 16 kHz mono float32,
    then runs the full ASR pipeline without loading the file in the renderer.
    """
    data = await request.json()
    file_path = data.get('path', '')
    if not file_path or not os.path.isfile(file_path):
        return JSONResponse({'error': 'File not found'}, status_code=400)

    def _run():
        import soundfile as sf
        fd, tmp_path = tempfile.mkstemp(suffix='.wav')
        os.close(fd)
        try:
            subprocess.run(
                ['ffmpeg', '-y', '-i', file_path,
                 '-ar', str(SAMPLE_RATE), '-ac', '1', '-f', 'wav', tmp_path],
                check=True, capture_output=True,
            )
            audio, _ = sf.read(tmp_path, dtype='float32')
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

        global _speaker_embeddings, _speaker_counts, _speaker_counter
        with _registry_lock:
            _speaker_embeddings = {}
            _speaker_counts     = {}
            _speaker_counter    = 0

        all_sentences = []
        full_text     = ''
        chunk_size    = CHUNK_SECONDS * SAMPLE_RATE
        time_offset   = 0.0
        buffer        = audio.copy()

        while len(buffer) >= chunk_size:
            chunk = buffer[:chunk_size]
            sents, text, last_end = _transcribe(chunk, time_offset)
            if sents:
                all_sentences.extend(sents)
            if text:
                full_text += (' ' if full_text else '') + text
            if sents:
                carry  = int(last_end * SAMPLE_RATE)
                buffer = np.concatenate([chunk[carry:], buffer[chunk_size:]])
                time_offset += last_end
            else:
                buffer = buffer[chunk_size:]
                time_offset += CHUNK_SECONDS

        if len(buffer) >= SAMPLE_RATE // 2:
            sents, text, _ = _transcribe(buffer, time_offset)
            if sents:
                all_sentences.extend(sents)
            if text:
                full_text += (' ' if full_text else '') + text

        for s in all_sentences:
            s.setdefault('speaker', None)

        return all_sentences, full_text

    all_sents, full_text = await asyncio.get_event_loop().run_in_executor(None, _run)
    return JSONResponse({'sentences': all_sents, 'fullText': full_text})


@app.post("/transcribe-full")
async def transcribe_full(request: Request):
    """
    Accept raw float32 PCM binary (mono, SAMPLE_RATE Hz, little-endian).
    Run the full Parakeet transcription pipeline and return {sentences, fullText}.
    """
    body = await request.body()
    if not body or len(body) < 4:
        return JSONResponse({'sentences': [], 'fullText': ''})

    audio = np.frombuffer(body, dtype='<f4').copy()

    # Reset speaker registry for a clean transcription
    global _speaker_embeddings, _speaker_counts, _speaker_counter
    with _registry_lock:
        _speaker_embeddings = {}
        _speaker_counts     = {}
        _speaker_counter    = 0

    def _run():
        all_sentences = []
        full_text     = ''
        chunk_size    = CHUNK_SECONDS * SAMPLE_RATE
        time_offset   = 0.0
        buffer        = audio.copy()

        # ── Phase 1 : transcription only (fast — MLX/GPU) ───────────────────
        while len(buffer) >= chunk_size:
            chunk = buffer[:chunk_size]
            sents, text, last_end = _transcribe(chunk, time_offset)
            if sents:
                all_sentences.extend(sents)
            if text:
                full_text += (' ' if full_text else '') + text
            if sents:
                carry  = int(last_end * SAMPLE_RATE)
                buffer = np.concatenate([chunk[carry:], buffer[chunk_size:]])
                time_offset += last_end
            else:
                buffer = buffer[chunk_size:]
                time_offset += CHUNK_SECONDS

        # Flush remaining audio
        if len(buffer) >= SAMPLE_RATE // 2:
            sents, text, _ = _transcribe(buffer, time_offset)
            if sents:
                all_sentences.extend(sents)
            if text:
                full_text += (' ' if full_text else '') + text

        # ── Phase 2 : single-pass diarization on the full audio ─────────────
        # Running pyannote once on the whole recording is both faster and more
        # accurate than calling it for every chunk (no cold-start, full context).
        # On macOS (CPU), skip diarization here — it would time out the HTTP
        # request on long recordings.  The client can run /transcribe-full
        # without speaker labels on macOS, which is fast enough to be usable.
        if all_sentences and _diarization_on and _diar_on_gpu:
            diarize_chunk(audio, 0.0, all_sentences)
        else:
            for s in all_sentences:
                s.setdefault('speaker', None)

        return all_sentences, full_text

    all_sents, full_text = await asyncio.get_event_loop().run_in_executor(None, _run)
    return JSONResponse({'sentences': all_sents, 'fullText': full_text})


@app.websocket("/ws/transcribe")
async def ws_transcribe(websocket: WebSocket):
    await websocket.accept()

    global _speaker_embeddings, _speaker_counts, _speaker_counter
    with _registry_lock:
        _speaker_embeddings = {}
        _speaker_counts     = {}
        _speaker_counter    = 0

    audio_q          = queue.Queue()
    asr_rq           = queue.Queue()
    stop_evt         = threading.Event()
    num_speakers_ref = [None]  # mutable — updated when config arrives

    # Per-session pool (max_workers=1) — created fresh for every WS session so
    # there is no backlog from previous sessions competing with /transcribe-full.
    # Shut down in the stop handler (cancels pending tasks, waits for the running
    # one to finish) so /transcribe-full always gets exclusive pipeline access.
    diar_pool = _cf.ThreadPoolExecutor(max_workers=1, thread_name_prefix='diar')

    asr_thread = threading.Thread(
        target=asr_worker,
        args=(audio_q, asr_rq, stop_evt, num_speakers_ref, diar_pool),
        daemon=True,
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
                    # Apply speaker merges retroactively: if two SPEAKER_ IDs were
                    # collapsed into one (same person detected twice), fix all
                    # sentences already sent, not just the new ones.
                    merge_map = r.get('merge_map', {})
                    if merge_map:
                        for s in all_sentences:
                            if s.get('speaker') in merge_map:
                                s['speaker'] = merge_map[s['speaker']]
                    if r.get('diar_refresh'):
                        # Background diarization completed — sentence dicts were
                        # updated in-place, merge_map applied above.  No new
                        # sentences or text to add; just fall through to re-render.
                        pass
                    else:
                        all_sentences.extend(r.get('sentences', []))
                        t = r.get('text', '')
                        if t:
                            full_text += (' ' if full_text else '') + t
                payload = {
                    'type':      'transcript',
                    'sentences': all_sentences,
                    'fullText':  full_text,
                }
                try:
                    await websocket.send_text(json.dumps(payload))
                except Exception as send_err:
                    # Client disconnected or WS closed — stop sending silently.
                    print(f"[result_sender] WebSocket send failed: {send_err}")
                    return

    sender_task = asyncio.create_task(result_sender())

    sample_rate = SAMPLE_RATE  # default

    try:
        while True:
            msg = await websocket.receive()

            if 'text' in msg:
                data = json.loads(msg['text'])
                if data.get('type') == 'config':
                    sample_rate = int(data.get('sampleRate', SAMPLE_RATE))
                    ns = data.get('numSpeakers')
                    if ns is not None:
                        nsv = int(ns)
                        # 2 is the UI default and means "auto-detect".
                        # Only constrain pyannote when the user explicitly chose > 2.
                        num_speakers_ref[0] = nsv if nsv > 2 else None
                elif data.get('type') == 'stop':
                    # End signal: flush and wait for the thread
                    audio_q.put(None)
                    stop_evt.set()
                    await asyncio.get_event_loop().run_in_executor(
                        None, lambda: asr_thread.join(timeout=60)
                    )
                    # Cancel pending diarization tasks.
                    # On GPU (Windows/RTX): wait for the running task to finish
                    # so /transcribe-full gets exclusive pipeline access.
                    # On CPU (macOS): don't wait — CPU diarization can take
                    # 30-120 s per chunk and would block the stop flow.
                    await asyncio.get_event_loop().run_in_executor(
                        None, lambda: _shutdown_pool(diar_pool, wait=_diar_on_gpu)
                    )
                    # Send any remaining final result
                    while not asr_rq.empty():
                        r = asr_rq.get_nowait()
                        merge_map = r.get('merge_map', {})
                        if merge_map:
                            for s in all_sentences:
                                if s.get('speaker') in merge_map:
                                    s['speaker'] = merge_map[s['speaker']]
                        if not r.get('diar_refresh'):
                            all_sentences.extend(r.get('sentences', []))
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

    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        sender_task.cancel()
        stop_evt.set()
        audio_q.put(None)
        # Best-effort cleanup: cancel queued diarization tasks without waiting.
        _shutdown_pool(diar_pool, wait=False)

# ─── Entry point ──────────────────────────────────────────────────────────────

if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='127.0.0.1', port=8765, log_level='info')
