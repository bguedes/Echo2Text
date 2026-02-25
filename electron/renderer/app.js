'use strict';

// ─── Configuration ────────────────────────────────────────────────────────────
const WS_URL        = 'ws://127.0.0.1:8765/ws/transcribe';
const HEALTH_URL    = 'http://127.0.0.1:8765/health';
const POLL_INTERVAL = 2000;
const BUFFER_SIZE   = 4096;
const VAD_THRESHOLD = 0.004;  // RMS en dessous duquel le chunk est ignoré (silence)

// ─── Prompts FR ───────────────────────────────────────────────────────────────
const SYSTEM_PROMPT_QUESTIONS = `Tu es un assistant d'analyse de réunion en temps réel.
Tu reçois les fragments successifs d'une transcription audio en cours.

À chaque nouveau fragment, identifie UNIQUEMENT les nouvelles questions posées \
dans CE fragment (pas celles que tu as déjà signalées dans les échanges précédents).

RÈGLES ABSOLUES DE FORMAT :
- Une ligne par question détectée, préfixe obligatoire "QUESTION: ".
- Pas de titre, pas de numérotation, pas de tableau, pas de markdown, pas d'explication.
- Si aucune nouvelle question dans ce fragment : répondre uniquement RIEN.

Exemples valides :
QUESTION: As-tu confirmé la date de livraison avec le transporteur ?
QUESTION: Les stocks sont-ils suffisants pour honorer la commande ?

Exemple si rien de nouveau :
RIEN`;

const SYSTEM_PROMPT_ANSWER = `Tu es un assistant expert en entreprise.
On vient de détecter cette question lors d'une réunion professionnelle.
Donne une réponse concise et pratique (2 à 4 phrases maximum).
Réponds directement, sans reformuler la question, sans intro ni conclusion.`;

const SYSTEM_PROMPT_ACTIONS = `Tu es un assistant d'analyse de réunion.
Voici la transcription complète d'une réunion. Identifie toutes les actions à réaliser.

RÈGLES ABSOLUES DE FORMAT :
- Une ligne par action, préfixe obligatoire "ACTION: ".
- Pas de titre, pas de numérotation, pas de tableau, pas de markdown, pas d'explication.
- Si aucune action à faire : répondre uniquement RIEN.

Exemples valides :
ACTION: Envoyer un email au transporteur pour confirmer la livraison demain à 14h.
ACTION: Vérifier les niveaux de stock avant la livraison.

Exemple si rien :
RIEN`;

const SYSTEM_PROMPT_SUMMARY = `Tu es un assistant de synthèse de réunion.
Voici la transcription complète, les questions et les actions.
Produis une synthèse en JSON strict (sans markdown) :
{"summary":"résumé en 3-5 phrases","next_steps":"décisions et prochaines étapes"}
Réponds UNIQUEMENT avec le JSON.`;

// ─── Prompts EN ───────────────────────────────────────────────────────────────
const SYSTEM_PROMPT_QUESTIONS_EN = `You are a real-time meeting analysis assistant.
You receive successive fragments of an ongoing audio transcription.

For each new fragment, identify ONLY the new questions asked in THIS fragment \
(not those you have already reported in previous exchanges).

ABSOLUTE FORMAT RULES:
- One line per detected question, mandatory prefix "QUESTION: ".
- No title, no numbering, no table, no markdown, no explanation.
- If no new question in this fragment: reply only NOTHING.

Valid examples:
QUESTION: Have you confirmed the delivery date with the carrier?
QUESTION: Are stock levels sufficient to fulfill the order?

Example if nothing new:
NOTHING`;

const SYSTEM_PROMPT_ANSWER_EN = `You are an expert business assistant.
A question has just been detected during a professional meeting.
Give a concise and practical answer (2 to 4 sentences maximum).
Reply directly, without rephrasing the question, without intro or conclusion.`;

const SYSTEM_PROMPT_ACTIONS_EN = `You are a meeting analysis assistant.
Here is the complete transcript of a meeting. Identify all actions to be taken.

ABSOLUTE FORMAT RULES:
- One line per action, mandatory prefix "ACTION: ".
- No title, no numbering, no table, no markdown, no explanation.
- If no action to take: reply only NOTHING.

Valid examples:
ACTION: Send an email to the carrier to confirm delivery tomorrow at 2pm.
ACTION: Check stock levels before delivery.

Example if nothing:
NOTHING`;

const SYSTEM_PROMPT_SUMMARY_EN = `You are a meeting summary assistant.
Here is the full transcript, the questions and the actions.
Produce a summary in strict JSON (no markdown):
{"summary":"summary in 3-5 sentences","next_steps":"decisions and next steps"}
Reply ONLY with the JSON.`;

// ─── Getters de prompts (dynamiques selon la langue) ─────────────────────────
function promptQuestions() { return language === 'fr' ? SYSTEM_PROMPT_QUESTIONS : SYSTEM_PROMPT_QUESTIONS_EN; }
function promptAnswer()    { return language === 'fr' ? SYSTEM_PROMPT_ANSWER    : SYSTEM_PROMPT_ANSWER_EN; }
function promptActions()   { return language === 'fr' ? SYSTEM_PROMPT_ACTIONS   : SYSTEM_PROMPT_ACTIONS_EN; }
function promptSummary()   { return language === 'fr' ? SYSTEM_PROMPT_SUMMARY   : SYSTEM_PROMPT_SUMMARY_EN; }

// ─── État global ──────────────────────────────────────────────────────────────
let ws          = null;
let audioCtx    = null;
let mediaStream = null;
let processor   = null;
let recording   = false;
let language    = 'fr';  // 'fr' | 'en'

let allSentences = [];
let lastSentIdx  = 0;

// Questions : [{ text, answer, answering }]
let questions = [];
// Actions : [string] — détectées en fin de réunion
let actions   = [];

// LLM — détection questions (temps réel, avec historique)
let llmHistoryQ = [{ role: 'system', content: promptQuestions() }];
let llmQueueQ   = [];
let llmBusyQ    = false;

// LLM — réponses aux questions (sans historique, one-shot par question)
let llmQueueAns = [];
let llmBusyAns  = false;

// LLM — connexion
let llmModelId   = 'local-model';
let llmConnected = false;

// ─── État réunion courante ────────────────────────────────────────────────────
let currentMeetingId    = null;
let currentCompanyName  = '';
let currentMeetingTitle = '';
let mediaRecorder       = null;
let audioChunks         = [];
let recordingStartTime  = null;
let savedAudioPath      = '';
let summaryText         = '';
let nextStepsText       = '';

// ─── Éléments DOM ─────────────────────────────────────────────────────────────
const dotServer     = document.getElementById('dot-server');
const dotLm         = document.getElementById('dot-lmstudio');
const dotMic        = document.getElementById('dot-mic');
const btnStart      = document.getElementById('btn-start');
const btnStop       = document.getElementById('btn-stop');
const btnReset      = document.getElementById('btn-reset');
const btnCsv        = document.getElementById('btn-csv');
const btnSrt        = document.getElementById('btn-srt');
const urlInput      = document.getElementById('lmstudio-url');
const transcriptEl  = document.getElementById('transcript-area');
const questionsList = document.getElementById('questions-list');
const actionsList   = document.getElementById('actions-list');
const tsBody        = document.getElementById('timestamps-body');
const meetingCtxBar = document.getElementById('meeting-context-bar');
const ctxCompany    = document.getElementById('ctx-company');
const ctxTitle      = document.getElementById('ctx-title');
const btnChangeMeeting = document.getElementById('btn-change-meeting');

// ─── Polling serveur / LMStudio ───────────────────────────────────────────────
let serverReady = false;

async function pollServer() {
  try {
    const r = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(1500) });
    if (r.ok) {
      const j = await r.json();
      serverReady = j.model_ready === true;
      setDot(dotServer, serverReady ? 'green' : 'orange');
      if (!serverReady) setTimeout(pollServer, POLL_INTERVAL);
      return;
    }
  } catch (_) {}
  setDot(dotServer, 'red');
  serverReady = false;
  setTimeout(pollServer, POLL_INTERVAL);
}

async function checkLmStudio() {
  const url = urlInput.value.trim();
  try {
    const r = await fetch(url + '/models', { signal: AbortSignal.timeout(2000) });
    if (r.ok) {
      const j  = await r.json();
      llmModelId   = j.data?.[0]?.id ?? 'local-model';
      llmConnected = true;
      setDot(dotLm, 'green');
      return;
    }
  } catch (_) {}
  llmConnected = false;
  setDot(dotLm, 'red');
}

// ─── WebSocket ASR ────────────────────────────────────────────────────────────
function connectWS() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  ws = new WebSocket(WS_URL);
  ws.binaryType = 'arraybuffer';

  ws.onopen = () => {
    const sr = audioCtx ? audioCtx.sampleRate : 16000;
    ws.send(JSON.stringify({ type: 'config', sampleRate: sr }));
  };

  ws.onmessage = (evt) => {
    try {
      const msg = JSON.parse(evt.data);
      if (msg.type === 'transcript') handleTranscript(msg);
    } catch (e) { console.warn('[ws]', e); }
  };

  ws.onclose = () => { if (recording) setTimeout(connectWS, 3000); };
  ws.onerror = (e) => console.error('[ws]', e);
}

// ─── Gestion transcription ────────────────────────────────────────────────────
function handleTranscript(msg) {
  allSentences = msg.sentences || [];
  transcriptEl.value = msg.fullText || '';
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
  renderTimestamps();
  maybeTriggerQuestions();

  if (msg.final) {
    setDot(dotMic, 'red');
    btnCsv.disabled = allSentences.length === 0;
    btnSrt.disabled = allSentences.length === 0;
    detectActions(msg.fullText || '').then(() => {
      if (currentMeetingId !== null) {
        generateSummary(msg.fullText || '').then(() => autoSave());
      }
    });
  }
}

function renderTimestamps() {
  tsBody.innerHTML = '';
  allSentences.forEach((s, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${i + 1}</td><td>${s.start}</td><td>${s.end}</td><td>${escHtml(s.segment)}</td><td><button class="btn-delete-row" data-idx="${i}" title="Supprimer">&#10005;</button></td>`;
    tsBody.appendChild(tr);
  });
  tsBody.querySelectorAll('.btn-delete-row').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.currentTarget.dataset.idx, 10);
      allSentences.splice(idx, 1);
      transcriptEl.value = allSentences.map(s => s.segment).join(' ');
      if (lastSentIdx > allSentences.length) lastSentIdx = allSentences.length;
      renderTimestamps();
      btnCsv.disabled = allSentences.length === 0;
      btnSrt.disabled = allSentences.length === 0;
    });
  });
}

// ─── LLM — Détection questions (temps réel) ───────────────────────────────────
function maybeTriggerQuestions() {
  const newSents = allSentences.slice(lastSentIdx);
  if (!newSents.length) return;
  const fragment = newSents.map(s => s.segment).join(' ');
  lastSentIdx = allSentences.length;
  llmQueueQ.push(fragment);
  processQuestionQueue();
}

async function processQuestionQueue() {
  if (llmBusyQ || llmQueueQ.length === 0) return;
  llmBusyQ = true;

  const fragment = llmQueueQ.shift();
  llmHistoryQ.push({ role: 'user', content: fragment });

  try {
    await checkLmStudio();
    if (!llmConnected) { llmHistoryQ.pop(); llmBusyQ = false; return; }

    const url  = urlInput.value.trim();
    const resp = await fetch(url + '/chat/completions', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer lm-studio' },
      body:    JSON.stringify({
        model: llmModelId, messages: llmHistoryQ,
        temperature: 0.1, max_tokens: 256, stream: true,
      }),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const { fullResponse } = await streamSSE(resp, (line) => {
      if (line.toUpperCase().startsWith('QUESTION:')) {
        const text = line.slice(9).trim();
        if (text && !questions.find(q => q.text === text)) {
          const q = { text, answer: null, answering: true };
          questions.push(q);
          renderQuestions();
          llmQueueAns.push(q);
          processAnswerQueue();
        }
      }
    });

    llmHistoryQ.push({ role: 'assistant', content: fullResponse });
  } catch (e) {
    console.error('[llm-q]', e);
    llmHistoryQ.pop();
  }

  llmBusyQ = false;
  if (llmQueueQ.length > 0) processQuestionQueue();
}

// ─── LLM — Réponses aux questions ────────────────────────────────────────────
async function processAnswerQueue() {
  if (llmBusyAns || llmQueueAns.length === 0) return;
  llmBusyAns = true;

  const qObj = llmQueueAns.shift();
  const url  = urlInput.value.trim();

  try {
    await checkLmStudio();
    if (!llmConnected) {
      qObj.answering = false;
      renderQuestions();
      llmBusyAns = false;
      return;
    }

    const messages = [
      { role: 'system', content: promptAnswer() },
      { role: 'user',   content: qObj.text },
    ];

    const resp = await fetch(url + '/chat/completions', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer lm-studio' },
      body:    JSON.stringify({
        model: llmModelId, messages,
        temperature: 0.3, max_tokens: 200, stream: true,
      }),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    // Streaming progressif — la réponse s'affiche token par token
    const reader  = resp.body.getReader();
    const decoder = new TextDecoder();
    let sseBuf = '';
    let answer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      sseBuf += decoder.decode(value, { stream: true });
      const lines = sseBuf.split('\n');
      sseBuf = lines.pop();
      for (const line of lines) {
        const t = line.trim();
        if (!t || t === 'data: [DONE]' || !t.startsWith('data:')) continue;
        try {
          const j     = JSON.parse(t.slice(5).trim());
          const token = j.choices?.[0]?.delta?.content ?? '';
          if (token) { answer += token; qObj.answer = answer; renderQuestions(); }
        } catch (_) {}
      }
    }
    qObj.answering = false;
    renderQuestions();

  } catch (e) {
    console.error('[llm-ans]', e);
    qObj.answering = false;
    renderQuestions();
  }

  llmBusyAns = false;
  if (llmQueueAns.length > 0) processAnswerQueue();
}

// ─── LLM — Détection actions (fin de réunion) ─────────────────────────────────
async function detectActions(fullText) {
  if (!fullText.trim()) return;

  actionsList.innerHTML = '<div class="detecting">Analyse des actions en cours…</div>';

  try {
    await checkLmStudio();
    if (!llmConnected) {
      actionsList.innerHTML = '<div class="detecting muted">LMStudio non disponible</div>';
      return;
    }

    const url      = urlInput.value.trim();
    const messages = [
      { role: 'system', content: promptActions() },
      { role: 'user',   content: fullText },
    ];

    const resp = await fetch(url + '/chat/completions', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer lm-studio' },
      body:    JSON.stringify({
        model: llmModelId, messages,
        temperature: 0.1, max_tokens: 512, stream: true,
      }),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    await streamSSE(resp, (line) => {
      if (line.toUpperCase().startsWith('ACTION:')) {
        const text = line.slice(7).trim();
        if (text && !actions.includes(text)) {
          actions.push(text);
          renderActions();
        }
      }
    });

    if (actions.length === 0) {
      actionsList.innerHTML = '<div class="detecting muted">Aucune action détectée</div>';
    }
  } catch (e) {
    console.error('[llm-actions]', e);
    actionsList.innerHTML = '<div class="detecting muted">Erreur d\'analyse</div>';
  }
}

// ─── LLM — Génération synthèse (fin de réunion, one-shot) ────────────────────
async function generateSummary(fullText) {
  if (!fullText.trim() || !llmConnected) return;

  const qSummary = questions.map((q, i) =>
    `Q${i + 1}: ${q.text}\nR: ${q.answer || '(sans réponse)'}`
  ).join('\n');
  const aSummary = actions.map((a, i) => `${i + 1}. ${a}`).join('\n');

  const userContent = [
    'TRANSCRIPTION:\n' + fullText,
    qSummary ? 'QUESTIONS/RÉPONSES:\n' + qSummary : '',
    aSummary ? 'ACTIONS:\n' + aSummary : '',
  ].filter(Boolean).join('\n\n');

  const url      = urlInput.value.trim();
  const messages = [
    { role: 'system', content: promptSummary() },
    { role: 'user',   content: userContent },
  ];

  try {
    const resp = await fetch(url + '/chat/completions', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer lm-studio' },
      body:    JSON.stringify({
        model: llmModelId, messages,
        temperature: 0.2, max_tokens: 512, stream: false,
      }),
    });
    if (!resp.ok) return;

    const j   = await resp.json();
    const raw = j.choices?.[0]?.message?.content ?? '';
    // Extraire le JSON brut (au cas où le modèle ajoute du texte autour)
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed  = JSON.parse(match[0]);
      summaryText   = parsed.summary   || '';
      nextStepsText = parsed.next_steps || '';
    }
  } catch (e) {
    console.error('[llm-summary]', e);
  }
}

// ─── Auto-save en DB ──────────────────────────────────────────────────────────
async function autoSave() {
  if (currentMeetingId === null) return;
  const duration = recordingStartTime ? (Date.now() - recordingStartTime) / 1000 : 0;

  try {
    await window.electronAPI.db.saveMeetingData(currentMeetingId, {
      sentences: allSentences,
      questions: questions.map(q => ({ text: q.text, answer: q.answer || '' })),
      actions,
      summary:   summaryText,
      nextSteps: nextStepsText,
      duration,
      audioPath: savedAudioPath,
    });
    showNotification('Réunion sauvegardée ✓');
  } catch (e) {
    console.error('[autoSave]', e);
  }
}

// ─── Notification toast ───────────────────────────────────────────────────────
function showNotification(msg) {
  let el = document.getElementById('toast-notification');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast-notification';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('visible');
  setTimeout(() => el.classList.remove('visible'), 3000);
}

// ─── Helper SSE streaming ─────────────────────────────────────────────────────
async function streamSSE(resp, onLine) {
  const reader  = resp.body.getReader();
  const decoder = new TextDecoder();
  let sseBuf       = '';
  let tokenBuf     = '';
  let fullResponse = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    sseBuf += decoder.decode(value, { stream: true });
    const lines = sseBuf.split('\n');
    sseBuf = lines.pop();
    for (const line of lines) {
      const t = line.trim();
      if (!t || t === 'data: [DONE]' || !t.startsWith('data:')) continue;
      try {
        const j     = JSON.parse(t.slice(5).trim());
        const token = j.choices?.[0]?.delta?.content ?? '';
        if (!token) continue;
        fullResponse += token;
        tokenBuf     += token;
        while (tokenBuf.includes('\n')) {
          const nl = tokenBuf.indexOf('\n');
          onLine(tokenBuf.slice(0, nl));
          tokenBuf = tokenBuf.slice(nl + 1);
        }
      } catch (_) {}
    }
  }
  if (tokenBuf.trim()) onLine(tokenBuf);
  return { fullResponse };
}

// ─── Rendu UI ─────────────────────────────────────────────────────────────────
function renderQuestions() {
  if (questions.length === 0) { questionsList.innerHTML = ''; return; }
  questionsList.innerHTML = questions.map((q, i) => `
    <div class="qa-item">
      <div class="qa-question">
        <span class="list-idx">${i + 1}</span>
        <span>${escHtml(q.text)}</span>
        <button class="btn-delete-item" data-idx="${i}" title="Supprimer">&#10005;</button>
      </div>
      ${q.answering && !q.answer
        ? '<div class="qa-answer answering">Génération de la réponse…</div>'
        : q.answer
          ? `<div class="qa-answer">${escHtml(q.answer)}</div>`
          : ''
      }
    </div>
  `).join('');
  questionsList.querySelectorAll('.btn-delete-item').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.currentTarget.dataset.idx, 10);
      questions.splice(idx, 1);
      renderQuestions();
    });
  });
}

function renderActions() {
  actionsList.innerHTML = actions.map((t, i) => `
    <div class="list-item">
      <span class="list-idx">${i + 1}</span>
      <span>${escHtml(t)}</span>
      <button class="btn-delete-item" data-idx="${i}" title="Supprimer">&#10005;</button>
    </div>
  `).join('');
  actionsList.querySelectorAll('.btn-delete-item').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.currentTarget.dataset.idx, 10);
      actions.splice(idx, 1);
      renderActions();
    });
  });
}

// ─── Sources audio ────────────────────────────────────────────────────────────
async function loadAudioSources() {
  const sel = document.getElementById('audio-source-select');
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = '';

  const grpMic = document.createElement('optgroup');
  grpMic.label = 'Microphone';
  try {
    const devices = (await navigator.mediaDevices.enumerateDevices())
      .filter(d => d.kind === 'audioinput');
    if (!devices.length) {
      grpMic.appendChild(new Option('Micro système', 'mic:default'));
    } else {
      devices.forEach((d, i) =>
        grpMic.appendChild(new Option(d.label || `Micro ${i + 1}`, `mic:${d.deviceId}`)));
    }
  } catch (_) {
    grpMic.appendChild(new Option('Micro système', 'mic:default'));
  }
  sel.appendChild(grpMic);

  if (window.electronAPI?.desktopCapturer) {
    const grpSys = document.createElement('optgroup');
    grpSys.label = 'Réunions en ligne';
    grpSys.appendChild(new Option('🖥️ Audio système (Zoom, Teams, Meet…)', 'system'));
    sel.appendChild(grpSys);
  }

  const grpOther = document.createElement('optgroup');
  grpOther.label = 'Autres sources';
  grpOther.appendChild(new Option('🌐 YouTube / URL Web', 'url'));
  grpOther.appendChild(new Option('📁 Fichier audio (wav, mp3, mp4, ogg…)', 'file'));
  sel.appendChild(grpOther);

  // Rétablir la sélection précédente si encore disponible
  if ([...sel.options].some(o => o.value === prev)) sel.value = prev;
}

async function getAudioStream() {
  const sel = document.getElementById('audio-source-select');
  const val = sel ? sel.value : 'mic:default';

  if (val === 'system' || val === 'url') {
    const sources = await window.electronAPI.desktopCapturer.getSources();
    const src = sources.find(s => /screen|entire/i.test(s.name)) || sources[0];
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: src.id } },
      video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: src.id,
                            maxWidth: 1, maxHeight: 1 } },
    });
    stream.getVideoTracks().forEach(t => t.stop()); // supprimer la piste vidéo
    return stream;
  }

  const deviceId = val.startsWith('mic:') ? val.slice(4) : undefined;
  return navigator.mediaDevices.getUserMedia(
    deviceId && deviceId !== 'default'
      ? { audio: { deviceId: { exact: deviceId } }, video: false }
      : { audio: true, video: false }
  );
}

// ─── Transcription depuis un fichier audio ────────────────────────────────────
async function startFileTranscription(file) {
  setDot(dotMic, 'orange');
  transcriptEl.value = '⏳ Décodage du fichier audio…';

  // 1. Décoder le fichier
  let pcmData;
  try {
    const buf = await file.arrayBuffer();
    const decodeCtx = new AudioContext();
    const decoded   = await decodeCtx.decodeAudioData(buf);
    await decodeCtx.close();

    // Rééchantillonner à 16 000 Hz mono (OfflineAudioContext)
    const SR      = 16000;
    const offCtx  = new OfflineAudioContext(1, Math.ceil(decoded.duration * SR), SR);
    const bufSrc  = offCtx.createBufferSource();
    bufSrc.buffer = decoded;
    bufSrc.connect(offCtx.destination);
    bufSrc.start(0);
    const resampled = await offCtx.startRendering();
    pcmData = resampled.getChannelData(0); // Float32Array à 16 kHz
    transcriptEl.value = '';
  } catch (e) {
    alert('Impossible de décoder ce fichier audio : ' + e.message);
    setDot(dotMic, 'red');
    return;
  }

  // 2. S'assurer que le WS est connecté
  if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
    connectWS();
  }
  // Attendre max 5 s que le WS soit prêt
  const wsReady = await new Promise(resolve => {
    if (ws && ws.readyState === WebSocket.OPEN) { resolve(true); return; }
    let elapsed = 0;
    const id = setInterval(() => {
      elapsed += 50;
      if      (ws && ws.readyState === WebSocket.OPEN)   { clearInterval(id); resolve(true);  }
      else if (elapsed >= 5000)                           { clearInterval(id); resolve(false); }
    }, 50);
  });
  if (!wsReady) {
    alert('Serveur ASR non disponible.');
    setDot(dotMic, 'red');
    return;
  }

  // 3. Envoyer la config (au cas où le WS était déjà ouvert)
  ws.send(JSON.stringify({ type: 'config', sampleRate: 16000 }));

  // 4. Initialiser l'état d'enregistrement
  recording          = true;
  recordingStartTime = Date.now();
  savedAudioPath     = '';
  summaryText        = '';
  nextStepsText      = '';
  audioChunks        = [];
  btnStart.disabled  = true;
  btnStop.disabled   = false;
  btnCsv.disabled    = true;
  btnSrt.disabled    = true;

  // 5. Streamer les chunks PCM vers le WS (≈ 32× temps réel)
  const CHUNK = 4096;
  for (let i = 0; i < pcmData.length; i += CHUNK) {
    if (!recording) break;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(pcmData.slice(i, i + CHUNK).buffer);
    }
    // Céder au event-loop toutes les 100 chunks (pour garder l'UI réactive)
    if (((i / CHUNK) % 100) === 0) await new Promise(r => setTimeout(r, 0));
  }

  // 6. Signaler la fin au serveur
  if (recording && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'stop' }));
  }
  recording         = false;
  btnStart.disabled = false;
  btnStop.disabled  = true;
  setDot(dotMic, 'red');
}

// ─── Audio capture ────────────────────────────────────────────────────────────
async function startRecording() {
  if (!serverReady) {
    alert('Le serveur ASR n\'est pas encore prêt. Attendez le point vert "Serveur ASR".');
    return;
  }

  // Si pas de réunion active, ouvrir le modal setup
  if (currentMeetingId === null) {
    openMeetingSetup();
    return;
  }

  // Source = fichier audio → déclencher le sélecteur de fichier
  const sourceVal = document.getElementById('audio-source-select')?.value || 'mic:default';
  if (sourceVal === 'file') {
    document.getElementById('audio-file-input').click();
    return;
  }

  try {
    mediaStream = await getAudioStream();
    await loadAudioSources(); // refresh labels après permission accordée
  } catch (e) {
    alert('Accès audio refusé : ' + e.message);
    return;
  }

  // ScriptProcessor → WebSocket ASR
  audioCtx  = new AudioContext({ sampleRate: 16000 });
  const src = audioCtx.createMediaStreamSource(mediaStream);
  processor = audioCtx.createScriptProcessor(BUFFER_SIZE, 1, 1);

  processor.onaudioprocess = (evt) => {
    if (!recording) return;
    const data = evt.inputBuffer.getChannelData(0);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    const rms = Math.sqrt(sum / data.length);
    if (rms < VAD_THRESHOLD) return;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(data.buffer.slice(0));
  };

  src.connect(processor);
  processor.connect(audioCtx.destination);

  // MediaRecorder → audio file
  audioChunks = [];
  savedAudioPath = '';
  summaryText = '';
  nextStepsText = '';
  recordingStartTime = Date.now();

  try {
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';
    mediaRecorder = new MediaRecorder(mediaStream, { mimeType });
    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.push(e.data); };
    mediaRecorder.onstop = handleMediaRecorderStop;
    mediaRecorder.start(1000);
  } catch (e) {
    console.warn('[mediaRecorder]', e);
    mediaRecorder = null;
  }

  recording = true;
  connectWS();
  setDot(dotMic, 'orange');
  btnStart.disabled = true;
  btnStop.disabled  = false;
  btnCsv.disabled   = true;
  btnSrt.disabled   = true;
}

async function handleMediaRecorderStop() {
  if (!audioChunks.length || currentMeetingId === null) return;
  try {
    const blob   = new Blob(audioChunks, { type: 'audio/webm' });
    const buffer = await blob.arrayBuffer();
    const bytes  = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    const base64 = btoa(binary);
    const result = await window.electronAPI.audio.save(currentMeetingId, base64);
    if (result && result.audioPath) savedAudioPath = result.audioPath;
  } catch (e) {
    console.error('[audio-save]', e);
  }
}

function stopRecording() {
  recording = false;
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  if (processor)   { processor.disconnect(); processor = null; }
  if (mediaStream) { mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null; }
  if (audioCtx)    { audioCtx.close(); audioCtx = null; }
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'stop' }));
  btnStart.disabled = false;
  btnStop.disabled  = true;
  setDot(dotMic, 'red');
}

function resetAll() {
  stopRecording();
  if (ws) { ws.close(); ws = null; }

  currentMeetingId    = null;
  currentCompanyName  = '';
  currentMeetingTitle = '';
  audioChunks         = [];
  savedAudioPath      = '';
  summaryText         = '';
  nextStepsText       = '';
  recordingStartTime  = null;
  meetingCtxBar.classList.add('hidden');

  allSentences = [];
  lastSentIdx  = 0;
  questions    = [];
  actions      = [];
  llmHistoryQ  = [{ role: 'system', content: promptQuestions() }];
  llmQueueQ    = [];
  llmBusyQ     = false;
  llmQueueAns  = [];
  llmBusyAns   = false;

  transcriptEl.value      = '';
  questionsList.innerHTML = '';
  actionsList.innerHTML   = '';
  tsBody.innerHTML        = '';
  btnCsv.disabled         = true;
  btnSrt.disabled         = true;
  setDot(dotMic, 'red');
}

// ─── Gestion contexte réunion ─────────────────────────────────────────────────
function setCurrentMeeting(meetingId, companyName, meetingTitle) {
  currentMeetingId    = meetingId;
  currentCompanyName  = companyName;
  currentMeetingTitle = meetingTitle;
  ctxCompany.textContent = companyName;
  ctxTitle.textContent   = meetingTitle;
  meetingCtxBar.classList.remove('hidden');
}

// Exposé pour library.js
window._appSetCurrentMeeting = setCurrentMeeting;
window._appStartRecording    = startRecording;

// ─── Export ───────────────────────────────────────────────────────────────────
function ts() {
  const d = new Date();
  return d.getFullYear()
    + String(d.getMonth() + 1).padStart(2, '0')
    + String(d.getDate()).padStart(2, '0')
    + '_'
    + String(d.getHours()).padStart(2, '0')
    + String(d.getMinutes()).padStart(2, '0')
    + String(d.getSeconds()).padStart(2, '0');
}

function buildCSV() {
  const rows = ['Index,Start (s),End (s),Segment'];
  allSentences.forEach((s, i) =>
    rows.push(`${i + 1},${s.start},${s.end},"${s.segment.replace(/"/g, '""')}"`)
  );
  return rows.join('\r\n');
}

function fmtSRT(sec) {
  sec = parseFloat(sec);
  const h  = Math.floor(sec / 3600);
  const m  = Math.floor((sec % 3600) / 60);
  const s  = Math.floor(sec % 60);
  const ms = Math.round((sec % 1) * 1000);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms).padStart(3,'0')}`;
}

function buildSRT() {
  return allSentences.map((s, i) =>
    `${i + 1}\n${fmtSRT(s.start)} --> ${fmtSRT(s.end)}\n${s.segment}\n`
  ).join('\n');
}

async function exportFile(content, defaultName, filters) {
  if (window.electronAPI) {
    await window.electronAPI.saveFile({ defaultName, content, filters });
  } else {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type: 'text/plain' }));
    a.download = defaultName;
    a.click();
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function setDot(el, cls) { el.className = 'dot ' + cls; }

function escHtml(str) {
  return str
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Événements ───────────────────────────────────────────────────────────────
btnStart.addEventListener('click', startRecording);
btnStop.addEventListener ('click', stopRecording);
btnReset.addEventListener('click', resetAll);

btnCsv.addEventListener('click', () =>
  exportFile(buildCSV(), `transcription_${ts()}.csv`, [{ name: 'CSV', extensions: ['csv'] }])
);
btnSrt.addEventListener('click', () =>
  exportFile(buildSRT(), `transcription_${ts()}.srt`, [{ name: 'SRT', extensions: ['srt'] }])
);

urlInput.addEventListener('change', () => {
  llmConnected = false;
  setDot(dotLm, 'red');
  checkLmStudio();
});

btnChangeMeeting.addEventListener('click', () => {
  openMeetingSetup();
});

document.querySelectorAll('.lang-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    language = btn.dataset.lang;
    document.querySelectorAll('.lang-btn').forEach(b => b.classList.toggle('active', b === btn));
    llmHistoryQ = [{ role: 'system', content: promptQuestions() }]; // reset historique
  });
});

document.getElementById('btn-refresh-sources').addEventListener('click', loadAudioSources);

// Afficher/masquer la ligne URL quand la source "url" est sélectionnée
document.getElementById('audio-source-select').addEventListener('change', (e) => {
  document.getElementById('url-source-row')
    .classList.toggle('hidden', e.target.value !== 'url');
});

// Ouvrir l'URL dans une BrowserWindow + basculer sur audio système
document.getElementById('btn-open-url').addEventListener('click', async () => {
  const raw = document.getElementById('url-web-input').value.trim();
  if (!raw) return;
  let url = raw;
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  try { new URL(url); } catch { alert('URL invalide.'); return; }

  if (window.electronAPI?.webview) {
    await window.electronAPI.webview.open(url);
    // Basculer automatiquement vers l'audio système
    const sel = document.getElementById('audio-source-select');
    if ([...sel.options].some(o => o.value === 'system')) {
      sel.value = 'system';
      document.getElementById('url-source-row').classList.add('hidden');
    }
  } else {
    window.open(url, '_blank');
  }
});

// Fermer la fenêtre URL
document.getElementById('btn-close-url').addEventListener('click', () => {
  if (window.electronAPI?.webview) window.electronAPI.webview.close();
  document.getElementById('url-source-row').classList.add('hidden');
  const sel = document.getElementById('audio-source-select');
  sel.value = sel.options[0]?.value || 'mic:default';
});

// Fichier audio sélectionné → lancer la transcription
document.getElementById('audio-file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = ''; // permettre de re-sélectionner le même fichier
  if (!file) return;
  if (currentMeetingId === null) {
    alert('Veuillez configurer une réunion avant de transcrire un fichier.');
    return;
  }
  await startFileTranscription(file);
});

// openMeetingSetup est défini dans library.js
function openMeetingSetup() {
  if (typeof window._libOpenMeetingSetup === 'function') {
    window._libOpenMeetingSetup();
  }
}

// ─── Thème ────────────────────────────────────────────────────────────────────
function applyTheme(theme) {
  document.body.dataset.theme = theme;
  localStorage.setItem('parakeet-theme', theme);
  document.querySelectorAll('.theme-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.theme === theme));
}

document.querySelectorAll('.theme-btn').forEach(btn => {
  btn.addEventListener('click', () => applyTheme(btn.dataset.theme));
});

// ─── Init ─────────────────────────────────────────────────────────────────────
applyTheme(localStorage.getItem('parakeet-theme') || 'dark');
pollServer();
checkLmStudio();
setInterval(checkLmStudio, 10000);
loadAudioSources();
