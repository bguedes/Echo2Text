import gradio as gr
import onnx_asr
import numpy as np
import os
import pandas as pd
from datetime import datetime
import threading
import queue
import time
from openai import OpenAI

# ─── Configuration ────────────────────────────────────────────────────────────
providers     = ['CUDAExecutionProvider', 'CPUExecutionProvider']
SAMPLE_RATE   = 16000
CHUNK_SECONDS = 5   # plus de contexte par inférence → meilleure précision

SYSTEM_PROMPT = """\
Tu es un assistant d'analyse de réunion en temps réel.
Tu reçois les fragments successifs d'une transcription audio en cours.

À chaque nouveau fragment, identifie UNIQUEMENT les nouvelles questions et actions \
qui apparaissent dans CE fragment (pas celles que tu as déjà signalées dans les échanges précédents).

RÈGLES ABSOLUES DE FORMAT — à respecter sans exception :
- Une ligne par élément détecté, rien d'autre.
- Chaque ligne commence OBLIGATOIREMENT par le préfixe exact "QUESTION: " ou "ACTION: ".
- Pas de titre, pas de numérotation, pas de tableau, pas de markdown, pas de tirets, pas d'explication.
- Si aucune question ni action nouvelle : répondre UNIQUEMENT le mot RIEN, sans ponctuation.

Exemples de réponses valides :
QUESTION: As-tu envoyé l'email au fournisseur ?
ACTION: Envoyer l'email au fournisseur si ce n'est pas encore fait.
ACTION: Confirmer la livraison avec le transporteur pour demain 14h.

Exemple si rien de nouveau :
RIEN"""

# ─── Modèle ASR (chargé une seule fois) ──────────────────────────────────────
_asr_model      = None
_asr_model_lock = threading.Lock()

def get_model():
    global _asr_model
    with _asr_model_lock:
        if _asr_model is None:
            print("Chargement du modèle Parakeet…")
            _asr_model = (
                onnx_asr.load_model("nemo-parakeet-tdt-0.6b-v3", providers=providers)
                .with_timestamps()
            )
            print("Modèle ASR prêt.")
    return _asr_model

print("Pré-chargement du modèle ASR…")
get_model()

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

def format_asr_table(sentences):
    return [[i + 1, s['start'], s['end'], s['segment']] for i, s in enumerate(sentences)]

def format_llm_table(items):
    return [[i + 1, item] for i, item in enumerate(items)]

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

# ─── Thread LLM de fond ───────────────────────────────────────────────────────

def _process_llm_line(line: str, result_q: queue.Queue):
    """Parse une ligne de réponse LLM et poste le résultat dans result_q."""
    line = line.strip()
    if line.upper().startswith("QUESTION:"):
        text = line[9:].strip()
        if text:
            result_q.put({"type": "question", "text": text})
    elif line.upper().startswith("ACTION:"):
        text = line[7:].strip()
        if text:
            result_q.put({"type": "action", "text": text})


def llm_worker(task_q, result_q, stop_event):
    """
    Thread de fond LLM avec conversation persistante et streaming.
    - Maintient un historique de conversation avec LMStudio.
    - Reçoit chaque nouveau fragment de transcription (nouvelles phrases).
    - Stream la réponse ligne par ligne → questions/actions ajoutées au fur et à mesure.
    """
    history = [{"role": "system", "content": SYSTEM_PROMPT}]
    client  = None
    model_id = "local-model"

    while not stop_event.is_set():
        try:
            item = task_q.get(timeout=0.5)
            if item is None:
                break
            new_fragment, url = item

            # Initialise / réinitialise le client si l'URL a changé
            if client is None:
                try:
                    client   = OpenAI(base_url=url, api_key="lm-studio", timeout=60)
                    models   = client.models.list()
                    model_id = models.data[0].id if models.data else "local-model"
                    print(f"[LLM] Connecté à LMStudio — modèle : {model_id}")
                except Exception as e:
                    print(f"[LLM] Connexion impossible : {e}")
                    client = None
                    continue

            # Ajoute le nouveau fragment à l'historique
            history.append({"role": "user", "content": new_fragment})

            # Appel en streaming
            full_response = ""
            buffer        = ""
            try:
                stream = client.chat.completions.create(
                    model=model_id,
                    messages=history,
                    temperature=0.1,
                    max_tokens=512,
                    stream=True,
                )
                for chunk in stream:
                    if stop_event.is_set():
                        break
                    token = (chunk.choices[0].delta.content or "") if chunk.choices else ""
                    if not token:
                        continue
                    full_response += token
                    buffer        += token
                    # Traite les lignes complètes dès qu'elles arrivent
                    while "\n" in buffer:
                        line, buffer = buffer.split("\n", 1)
                        _process_llm_line(line, result_q)

                # Traite le reste du buffer
                if buffer.strip():
                    _process_llm_line(buffer, result_q)

            except Exception as e:
                print(f"[LLM] Erreur streaming : {e}")
                full_response = ""

            # Mémorise la réponse dans l'historique pour le contexte suivant
            if full_response:
                history.append({"role": "assistant", "content": full_response})

        except queue.Empty:
            continue

# ─── Gestion d'état ───────────────────────────────────────────────────────────

def init_state(lmstudio_url="http://localhost:1234/v1"):
    # ASR worker
    asr_stop = threading.Event()
    audio_q  = queue.Queue()
    asr_rq   = queue.Queue()
    asr_w    = threading.Thread(target=asr_worker, args=(audio_q, asr_rq, asr_stop), daemon=True)
    asr_w.start()
    # LLM worker (conversation persistante)
    llm_stop = threading.Event()
    llm_tq   = queue.Queue()
    llm_rq   = queue.Queue()
    llm_w    = threading.Thread(target=llm_worker, args=(llm_tq, llm_rq, llm_stop), daemon=True)
    llm_w.start()

    return {
        # ASR
        'audio_q':  audio_q,
        'asr_rq':   asr_rq,
        'asr_stop': asr_stop,
        'asr_w':    asr_w,
        'sentences':  [],
        'full_text':  '',
        # LLM
        'llm_tq':        llm_tq,
        'llm_rq':        llm_rq,
        'llm_stop':      llm_stop,
        'llm_w':         llm_w,
        'lmstudio_url':  lmstudio_url,
        'questions':     [],
        'actions':       [],
        'last_sent_idx': 0,   # index de la dernière phrase déjà envoyée au LLM
    }

def _collect_asr(state):
    while not state['asr_rq'].empty():
        r = state['asr_rq'].get_nowait()
        state['sentences'].extend(r.get('sentences', []))
        t = r.get('text', '')
        if t:
            state['full_text'] += (' ' if state['full_text'] else '') + t

def _collect_llm(state):
    """Récupère les items détectés par le LLM (accumulatif, avec déduplication)."""
    while not state['llm_rq'].empty():
        r = state['llm_rq'].get_nowait()
        if r.get('type') == 'question' and r['text'] not in state['questions']:
            state['questions'].append(r['text'])
        elif r.get('type') == 'action' and r['text'] not in state['actions']:
            state['actions'].append(r['text'])

def _maybe_trigger_llm(state):
    """Envoie immédiatement chaque nouvelle phrase complète au LLM."""
    new_sents = state['sentences'][state['last_sent_idx']:]
    if not new_sents:
        return
    fragment = ' '.join(s['segment'] for s in new_sents)
    state['llm_tq'].put((fragment, state['lmstudio_url']))
    state['last_sent_idx'] = len(state['sentences'])

def _stop_asr(state):
    """Arrête uniquement le worker ASR et attend sa fin."""
    state['asr_stop'].set()
    state['audio_q'].put(None)
    state['asr_w'].join(timeout=60)

def _stop_llm(state):
    """Envoie la sentinelle au worker LLM et attend sa fin."""
    state['llm_tq'].put(None)
    state['llm_w'].join(timeout=60)

def _stop_all(state):
    """Arrête les deux workers (utilisé par reset)."""
    state['asr_stop'].set()
    state['audio_q'].put(None)
    state['llm_stop'].set()
    state['llm_tq'].put(None)

# ─── Callbacks Gradio ─────────────────────────────────────────────────────────

def transcribe_chunk(audio_chunk, state, lmstudio_url):
    if state is None:
        state = init_state(lmstudio_url)
    state['lmstudio_url'] = lmstudio_url

    if audio_chunk is not None:
        sr, data = audio_chunk
        data = data.flatten()
        data = data.astype(np.float32) / 32767.0 if data.dtype == np.int16 else data.astype(np.float32)
        if sr != SAMPLE_RATE:
            data = resample(data, sr)
        state['audio_q'].put(data)

    _collect_asr(state)
    _maybe_trigger_llm(state)
    _collect_llm(state)

    return (
        state,
        state['full_text'],
        format_asr_table(state['sentences']),
        format_llm_table(state['questions']),
        format_llm_table(state['actions']),
    )

def finalize_transcription(state, lmstudio_url):
    if state is None:
        state = init_state(lmstudio_url)
    state['lmstudio_url'] = lmstudio_url

    # 1. Arrête l'ASR, récupère les dernières phrases
    _stop_asr(state)
    _collect_asr(state)

    # 2. Envoie les dernières phrases au LLM, puis arrête le worker LLM
    _maybe_trigger_llm(state)
    _stop_llm(state)
    _collect_llm(state)

    has      = len(state['sentences']) > 0
    csv_path = _save_csv(state['sentences']) if has else None
    srt_path = _save_srt(state['sentences']) if has else None

    return (
        state,
        state['full_text'],
        format_asr_table(state['sentences']),
        format_llm_table(state['questions']),
        format_llm_table(state['actions']),
        gr.update(value=csv_path, visible=has),
        gr.update(value=srt_path, visible=has),
    )

def reset_all(state):
    if state is not None:
        state['asr_stop'].set()
        state['audio_q'].put(None)
        state['llm_stop'].set()
        state['llm_tq'].put(None)
    url = (state or {}).get('lmstudio_url', 'http://localhost:1234/v1')
    return (
        init_state(url), '', [], [], [],
        gr.update(visible=False), gr.update(visible=False),
    )

# ─── Export CSV / SRT ─────────────────────────────────────────────────────────

def _ts():
    return datetime.now().strftime("%Y%m%d_%H%M%S")

def _save_csv(sentences):
    os.makedirs("output", exist_ok=True)
    path = os.path.join("output", f"transcription_{_ts()}.csv")
    pd.DataFrame([
        {'Index': i + 1, 'Start (s)': s['start'], 'End (s)': s['end'], 'Segment': s['segment']}
        for i, s in enumerate(sentences)
    ]).to_csv(path, index=False)
    return path

def _save_srt(sentences):
    os.makedirs("output", exist_ok=True)
    path = os.path.join("output", f"transcription_{_ts()}.srt")
    def fmt(sec):
        sec = float(sec)
        h = int(sec // 3600); m = int((sec % 3600) // 60)
        s = int(sec % 60);    ms = int((sec % 1) * 1000)
        return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"
    lines = []
    for i, sent in enumerate(sentences, 1):
        lines += [str(i), f"{fmt(sent['start'])} --> {fmt(sent['end'])}", sent['segment'], '']
    with open(path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))
    return path

# ─── Interface Gradio ─────────────────────────────────────────────────────────

custom_css = ".cell-menu-button { display: none !important; }"

with gr.Blocks(css=custom_css) as demo:
    gr.Markdown("# Parakeet v3 + LMStudio – Transcription & Analyse Temps Réel")
    gr.Markdown(
        f"**Flux** : Microphone → Parakeet GPU (chunks **{CHUNK_SECONDS} s**) → transcription  \n"
        "En parallèle → LMStudio (background) → **questions** et **actions** détectées automatiquement"
    )

    state = gr.State()

    with gr.Row():
        audio_input = gr.Audio(
            sources=["microphone"], streaming=True, type="numpy", label="Microphone"
        )
        lmstudio_url = gr.Textbox(
            value="http://localhost:1234/v1",
            label="URL LMStudio",
            placeholder="http://localhost:1234/v1",
            scale=1,
        )

    reset_btn = gr.Button("Réinitialiser", variant="secondary")

    live_text = gr.Textbox(
        label="Transcription en direct",
        placeholder="Commencez à parler…",
        lines=5,
        interactive=False,
    )

    with gr.Row():
        questions_table = gr.Dataframe(
            headers=["#", "Question détectée"],
            datatype=["number", "str"],
            label="Questions",
            wrap=True,
            interactive=False,
        )
        actions_table = gr.Dataframe(
            headers=["#", "Action à faire"],
            datatype=["number", "str"],
            label="Actions",
            wrap=True,
            interactive=False,
        )

    with gr.Row():
        csv_btn = gr.DownloadButton(label="Télécharger CSV", visible=False)
        srt_btn = gr.DownloadButton(label="Télécharger SRT", visible=False)

    timestamps_table = gr.Dataframe(
        headers=["Index", "Début (s)", "Fin (s)", "Segment"],
        datatype=["number", "number", "number", "str"],
        label="Horodatages par phrase",
        wrap=True,
        interactive=False,
    )

    # ── Événements ────────────────────────────────────────────────────────────

    audio_input.stream(
        fn=transcribe_chunk,
        inputs=[audio_input, state, lmstudio_url],
        outputs=[state, live_text, timestamps_table, questions_table, actions_table],
    )

    audio_input.stop_recording(
        fn=finalize_transcription,
        inputs=[state, lmstudio_url],
        outputs=[state, live_text, timestamps_table, questions_table, actions_table, csv_btn, srt_btn],
    )

    reset_btn.click(
        fn=reset_all,
        inputs=[state],
        outputs=[state, live_text, timestamps_table, questions_table, actions_table, csv_btn, srt_btn],
    )

demo.queue().launch()
