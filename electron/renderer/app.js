'use strict';

// ─── Configuration ────────────────────────────────────────────────────────────
const WS_URL             = 'ws://127.0.0.1:8765/ws/transcribe';
const HEALTH_URL         = 'http://127.0.0.1:8765/health';
const RETRANSCRIBE_URL   = 'http://127.0.0.1:8765/transcribe-full';
const POLL_INTERVAL      = 2000;
const BUFFER_SIZE        = 4096;
const VAD_THRESHOLD      = 0.004;  // RMS below which the chunk is ignored (silence)

// ─── LLM Prompts — French (used when lang = FR) ───────────────────────────────
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

const SYSTEM_PROMPT_ACTIONS = `Tu es un assistant expert en analyse de réunion professionnelle.
Voici la transcription COMPLÈTE d'une réunion. Identifie TOUTES les actions à réaliser — sois EXHAUSTIF.

Détecte en particulier :
- Les impératifs directs : "envoie X", "vérifie Y", "prépare Z", "contacte..."
- Les obligations indirectes : "il faudra que...", "tu dois...", "il faut...", "n'oublie pas de...", "pense à..."
- Les assignations à une personne : "[Prénom/Titre], tu t'occupes de...", "[Prénom] devra...", "[Prénom] se charge de..."
- Les engagements pris : "je vais faire...", "on va préparer...", "je m'en occupe", "nous allons..."
- Les décisions actionnables : "on se réunit dans X jours", "on va définir...", "il faudra valider..."
- Les accords conclus qui impliquent un suivi concret

Quand une personne est nommée pour une tâche, inclus son nom ou titre dans l'action.

RÈGLES ABSOLUES DE FORMAT :
- Une ligne par action, préfixe obligatoire "ACTION: ".
- Formule chaque action de façon concrète et claire.
- Pas de titre, pas de numérotation, pas de tableau, pas de markdown, pas d'explication.
- Si vraiment aucune action dans la transcription : répondre uniquement RIEN.

Exemples valides :
ACTION: Madame Jeanne — Préparer une proposition détaillée sur les menus et les tarifs.
ACTION: Organiser une réunion de suivi dans 10 jours pour donner la réponse finale.
ACTION: Établir le contrat de location des locaux avec l'entreprise Au Café.
ACTION: Valider le montant du loyer mensuel proposé par l'entreprise Au Café.

Exemple si rien :
RIEN`;

const SYSTEM_PROMPT_SUMMARY = `Tu es un assistant expert en analyse et synthèse de réunion professionnelle.
Voici la transcription complète de la réunion, les questions/réponses détectées et les actions identifiées.

Produis une synthèse RICHE et COMPLÈTE en JSON strict (sans markdown, sans balise, sans backtick) :
{"summary":"Résumé substantiel en 6 à 10 phrases couvrant : le contexte et l'objectif de la réunion, les principaux sujets abordés, les arguments et positions de chaque partie, les points de tension ou désaccords, les accords trouvés et la décision finale ou prochaine étape.","next_steps":"Liste numérotée de TOUTES les actions et décisions concrètes issues de la réunion — relis attentivement la transcription pour ne rien manquer : obligations, engagements nominatifs, délais mentionnés, décisions à valider."}

IMPORTANT : Le summary doit être substantiel et refléter fidèlement la richesse des échanges.
Réponds UNIQUEMENT avec le JSON valide.`;

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

const SYSTEM_PROMPT_ACTIONS_EN = `You are an expert meeting analysis assistant.
Here is the COMPLETE transcript of a meeting. Identify ALL actions to be taken — be EXHAUSTIVE.

Detect in particular:
- Direct imperatives: "send X", "check Y", "prepare Z", "contact..."
- Indirect obligations: "you'll need to...", "you should...", "don't forget to...", "make sure to...", "we need to..."
- Assignments to a person: "[Name/Title], you handle...", "[Name] will...", "[Name] is responsible for..."
- Commitments made: "I'll do...", "we'll prepare...", "I'll take care of it", "we're going to..."
- Actionable decisions: "we'll meet in X days", "we'll define...", "we need to validate..."
- Concluded agreements that imply concrete follow-up

When a person is named for a task, include their name or title in the action.

ABSOLUTE FORMAT RULES:
- One line per action, mandatory prefix "ACTION: ".
- Phrase each action concretely and clearly.
- No title, no numbering, no table, no markdown, no explanation.
- If truly no action in the transcript: reply only NOTHING.

Valid examples:
ACTION: Ms. Jeanne — Prepare a detailed proposal on menus and pricing.
ACTION: Schedule a follow-up meeting in 10 days to give the final answer.
ACTION: Draft the premises rental agreement with Au Café company.
ACTION: Validate the monthly rent amount proposed by Au Café.

Example if nothing:
NOTHING`;

const SYSTEM_PROMPT_SUMMARY_EN = `You are an expert professional meeting analysis and summary assistant.
Here is the full transcript, detected questions/answers and identified actions.

Produce a RICH and COMPLETE summary in strict JSON (no markdown, no backtick, no code block):
{"summary":"Substantial summary in 6 to 10 sentences covering: the context and objective of the meeting, the main topics discussed, arguments and positions from each party, points of tension or disagreement, agreements reached and the final decision or next milestone.","next_steps":"Numbered list of ALL concrete actions and decisions from the meeting — carefully re-read the transcript to miss nothing: obligations, named commitments, deadlines mentioned, decisions to validate."}

IMPORTANT: The summary must be substantial and faithfully reflect the richness of the exchanges.
Reply ONLY with valid JSON.`;

// ─── Key-points prompts (real-time incremental, FR + EN) ──────────────────────
const SYSTEM_PROMPT_KEYPOINTS = `Tu es un assistant de réunion local, spécialisé en synthèse fiable et extraction d'éléments actionnables.
Tu reçois les fragments successifs d'une transcription audio en cours.

À chaque nouveau fragment, identifie UNIQUEMENT les nouveaux points clés dans CE fragment : \
décisions prises, faits importants, chiffres, dates, engagements, risques ou sujets clés mentionnés.

RÈGLES ABSOLUES DE FORMAT :
- Une ligne par point clé, préfixe obligatoire "POINT: ".
- Pas de titre, numérotation, tableau, markdown, explication.
- Ne JAMAIS inventer : si une info (chiffre, date, owner) n'est pas explicite dans le texte, ne l'inclus pas.
- Déduplique : si un point est déjà connu des échanges précédents, ne le répète pas.
- Détecte la langue du fragment (FR/EN) et réponds dans cette même langue.
- Si aucun nouveau point clé : répondre uniquement RIEN.

Exemples valides :
POINT: Décision de migrer vers le nouveau système d'ici Q2.
POINT: Budget alloué : 50 000 € pour la phase 1.
POINT: Risque identifié — délai fournisseur pourrait décaler la livraison.

Exemple si rien :
RIEN`;

const SYSTEM_PROMPT_KEYPOINTS_EN = `You are a local meeting assistant specialized in reliable synthesis and actionable extraction.
You receive successive fragments of an ongoing audio transcription.

For each new fragment, identify ONLY the new key points in THIS fragment: \
decisions made, important facts, figures, dates, commitments, risks, or key topics mentioned.

ABSOLUTE FORMAT RULES:
- One line per key point, mandatory prefix "POINT:".
- No title, numbering, table, markdown, explanation.
- NEVER invent: if information (figure, date, owner) is not explicit in the text, do not include it.
- Deduplicate: if a point is already known from previous exchanges, do not repeat it.
- Detect the language of the fragment (FR/EN) and reply in that same language.
- If no new key points: reply only NOTHING.

Valid examples:
POINT: Decision to migrate to the new system by Q2.
POINT: Allocated budget: $50,000 for phase 1.
POINT: Risk identified — supplier delay could push back delivery.

Example if nothing:
NOTHING`;

// ─── Prompt final unifié — UN seul appel LLM pour toute l'analyse de fin de réunion ─────────────────

const SYSTEM_PROMPT_FINAL_ANALYSIS = `Tu es un assistant expert en analyse de réunion professionnelle.
Analyse la transcription et réponds UNIQUEMENT avec un JSON valide (sans markdown, sans backtick, sans texte avant ou après) ayant exactement ces champs :
- "key_points": array de strings — décisions, faits, chiffres, engagements, risques (exhaustif)
- "questions": array de {"text":"...","answer":"..."} — toutes les questions posées avec réponse contextuelle (2-4 phrases)
- "actions": array de strings — "Responsable — description" pour chaque action/tâche assignée
- "discovery_questions": array de 3 à 7 strings — questions ouvertes à poser au prochain échange (pas déjà posées)
- "summary": string markdown avec sections : Synthèse globale, Points abordés, État actuel, Actions réalisées ✓, Actions en attente ⏳, Points de vigilance ⚠, Recommandations. Listes uniquement, pas de tableaux.
Réponds UNIQUEMENT avec le JSON valide. Zéro texte avant ou après.`;

const SYSTEM_PROMPT_FINAL_ANALYSIS_EN = `You are an expert professional meeting analysis assistant.
Analyze the transcript and reply ONLY with valid JSON (no markdown, no backtick, no text before or after) with exactly these fields:
- "key_points": array of strings — decisions, facts, figures, commitments, risks (exhaustive)
- "questions": array of {"text":"...","answer":"..."} — all questions asked with contextual answer (2-4 sentences)
- "actions": array of strings — "Owner — description" for each assigned action/task
- "discovery_questions": array of 3 to 7 strings — open-ended questions for the next meeting (not already asked)
- "summary": markdown string with sections: Global Summary, Topics Covered, Current Status, Completed Actions ✓, Pending Actions ⏳, Watch Points ⚠, Recommendations. Lists only, no tables.
Reply ONLY with valid JSON. Zero text before or after.`;

// ─── Prompts finaux dédiés — transcription COMPLÈTE (distincts des prompts incrémentaux temps-réel) ───

const SYSTEM_PROMPT_FINAL_KEYPOINTS = `Tu es un assistant expert en analyse de réunion professionnelle.
Voici la transcription COMPLÈTE d'une réunion. Extrais TOUS les points clés importants.

Inclure sans exception :
- Décisions prises (même provisoires)
- Faits et chiffres cités (pourcentages, montants, délais, statistiques)
- Engagements pris par chaque partie
- Points de tension, objections ou désaccords
- Opportunités ou bénéfices identifiés
- Risques ou contraintes mentionnés
- Accords conclus et conditions associées

RÈGLES ABSOLUES DE FORMAT :
- Une ligne par point clé, préfixe obligatoire "POINT: ".
- Sois exhaustif — liste tous les éléments factuels pertinents, même brièvement mentionnés.
- Pas de titre, pas de numérotation, pas de tableau, pas de markdown, pas d'explication.
- Ne jamais inventer d'information absente de la transcription.
- Si aucun point clé : répondre uniquement RIEN.

Exemples valides :
POINT: Décision d'organiser une réunion de suivi dans 10 jours pour donner la réponse finale.
POINT: 60% des salariés se sentent exploités, 65% ont perdu confiance en l'entreprise.
POINT: L'entreprise Au Café propose de gérer l'équipement, les machines et le recrutement.
POINT: Condition posée : définir les menus, les tarifs et le montant du loyer.
POINT: Plusieurs études démontrent que la valorisation du personnel améliore le rendement.`;

const SYSTEM_PROMPT_FINAL_QUESTIONS = `Tu es un assistant expert en analyse de réunion professionnelle.
Voici la transcription COMPLÈTE d'une réunion. Extrais TOUTES les questions posées par les participants.

Inclure :
- Les questions directes (avec "?" explicite)
- Les questions indirectes ("je me demande si...", "on devrait vérifier si...", "il faudrait savoir...")
- Les interrogations rhétoriques révélant un doute ou une objection
- Les sujets ouverts pour lesquels une réponse a été demandée ou attendue

Reformule chaque question sous forme directe et claire si nécessaire.

RÈGLES ABSOLUES DE FORMAT :
- Une ligne par question, préfixe obligatoire "QUESTION: ".
- Pas de titre, pas de numérotation, pas de tableau, pas de markdown, pas d'explication.
- Si aucune question dans la transcription : répondre uniquement RIEN.

Exemples valides :
QUESTION: Que gagne l'entreprise en investissant dans ce projet de cafétéria ?
QUESTION: Pourquoi partager les locaux plutôt qu'ouvrir un espace détente interne ?
QUESTION: Les capacités financières sont-elles suffisantes pour ce projet ?
QUESTION: Avons-nous fait le bon choix en sollicitant une entreprise extérieure ?`;

const SYSTEM_PROMPT_FINAL_KEYPOINTS_EN = `You are an expert professional meeting analysis assistant.
Here is the COMPLETE transcript of a meeting. Extract ALL important key points.

Include without exception:
- Decisions made (even provisional ones)
- Facts and figures cited (percentages, amounts, deadlines, statistics)
- Commitments made by each party
- Points of tension, objections or disagreements
- Opportunities or benefits identified
- Risks or constraints mentioned
- Agreements reached and associated conditions

ABSOLUTE FORMAT RULES:
- One line per key point, mandatory prefix "POINT:".
- Be exhaustive — list all relevant factual elements, even briefly mentioned ones.
- No title, no numbering, no table, no markdown, no explanation.
- Never invent information absent from the transcript.
- If no key points: reply only NOTHING.

Valid examples:
POINT: Decision to hold a follow-up meeting in 10 days to give the final answer.
POINT: 60% of employees feel exploited, 65% have lost confidence in the company.
POINT: Au Café company offers to manage equipment, machines, and recruitment.
POINT: Condition set: define menus, prices, and rent amount before final decision.`;

const SYSTEM_PROMPT_FINAL_QUESTIONS_EN = `You are an expert professional meeting analysis assistant.
Here is the COMPLETE transcript of a meeting. Extract ALL questions asked by participants.

Include:
- Direct questions (with explicit "?")
- Indirect questions ("I wonder if...", "we should check if...", "we need to know...")
- Rhetorical questions revealing doubt or objection
- Open topics for which an answer was requested or expected

Rephrase each question in a direct and clear form if necessary.

ABSOLUTE FORMAT RULES:
- One line per question, mandatory prefix "QUESTION:".
- No title, no numbering, no table, no markdown, no explanation.
- If no questions in the transcript: reply only NOTHING.

Valid examples:
QUESTION: What does the company gain by investing in the cafeteria project?
QUESTION: Why share premises rather than open an internal relaxation space?
QUESTION: Are the financial resources sufficient for this project?
QUESTION: Did we make the right choice by involving an external company?`;

// ─── Discovery prompts (questions ouvertes pour approfondir la découverte, FR + EN) ──
const SYSTEM_PROMPT_DISCOVERY = `Tu es un coach commercial expert en phase de découverte client.
Tu reçois les fragments successifs d'une transcription d'entretien commercial en cours.

À chaque fragment, repère les déclarations du prospect ou client qui révèlent : une expérience vécue, un résultat (positif ou négatif), un problème ou irritant, un projet ou ambition, une contrainte, une décision passée, ou une hésitation.

Pour chaque déclaration intéressante, propose UNE question ouverte, bienveillante et naturelle qui invite le prospect à développer — sans qu'il se sente interrogé.

Style des questions :
- Ouverte (commence par "Qu'est-ce qui...", "Comment...", "Qu'avez-vous...", "Quel a été...", "Dans quelle mesure...", "Qu'est-ce que cela...")
- Conversationnelle et empathique, pas formelle ni inquisitrice
- Invite à raconter une expérience plutôt qu'à justifier une position
- Varie les formulations pour éviter l'effet interrogatoire
- Maximum 2 questions par fragment

RÈGLES ABSOLUES DE FORMAT :
- Une ligne par question, préfixe obligatoire "DISCOVERY: ".
- Pas de titre, pas de numérotation, pas de tableau, pas de markdown, pas d'explication.
- Ne génère des questions QUE si le fragment contient une déclaration significative du prospect/client.
- Si aucune déclaration intéressante : répondre uniquement RIEN.

Exemples valides :
DISCOVERY: Quel bilan tirez-vous de ces deux mois de test sur AWS Bedrock ?
DISCOVERY: Qu'est-ce qui vous a amené à choisir cette solution plutôt qu'une autre ?
DISCOVERY: Comment cela se manifeste-t-il concrètement dans votre quotidien ?
DISCOVERY: Qu'est-ce que vous auriez voulu faire différemment avec le recul ?

Exemple si rien d'intéressant :
RIEN`;

const SYSTEM_PROMPT_DISCOVERY_EN = `You are an expert sales coach specializing in the discovery phase.
You receive successive fragments of an ongoing business meeting transcription.

For each fragment, identify statements from the prospect or client that reveal: a lived experience, a result (positive or negative), a problem or pain point, a project or ambition, a constraint, a past decision, or a hesitation.

For each interesting statement, suggest ONE open-ended, empathetic, and natural question that invites the prospect to elaborate — without feeling interrogated.

Question style:
- Open-ended (starts with "What...", "How...", "Tell me more about...", "What led you to...", "How has that...", "What was your experience...")
- Conversational and empathetic, not formal or inquisitive
- Invites storytelling rather than justifying a position
- Varies the phrasing to avoid feeling like an interrogation
- Maximum 2 questions per fragment

ABSOLUTE FORMAT RULES:
- One line per question, mandatory prefix "DISCOVERY: ".
- No title, no numbering, no table, no markdown, no explanation.
- Only generate questions if the fragment contains a significant statement from the prospect/client.
- If no interesting statement: reply only NOTHING.

Valid examples:
DISCOVERY: What has been your experience with AWS Bedrock over these two months?
DISCOVERY: What led you to choose this solution over the alternatives?
DISCOVERY: How does that impact your day-to-day operations concretely?
DISCOVERY: What would you have done differently with hindsight?

Example if nothing interesting:
NOTHING`;

// ─── Prompt getters (dynamic by language) ────────────────────────────────────
function promptQuestions()       { return language === 'fr' ? SYSTEM_PROMPT_QUESTIONS        : SYSTEM_PROMPT_QUESTIONS_EN; }
function promptAnswer()          { return language === 'fr' ? SYSTEM_PROMPT_ANSWER           : SYSTEM_PROMPT_ANSWER_EN; }
function promptActions()         { return language === 'fr' ? SYSTEM_PROMPT_ACTIONS          : SYSTEM_PROMPT_ACTIONS_EN; }
function promptSummary()         { return language === 'fr' ? SYSTEM_PROMPT_SUMMARY          : SYSTEM_PROMPT_SUMMARY_EN; }
function promptKeyPoints()       { return language === 'fr' ? SYSTEM_PROMPT_KEYPOINTS        : SYSTEM_PROMPT_KEYPOINTS_EN; }
function promptDiscovery()       { return language === 'fr' ? SYSTEM_PROMPT_DISCOVERY        : SYSTEM_PROMPT_DISCOVERY_EN; }
// Prompt unique pour toute l'analyse finale (un seul appel LLM, JSON complet)
function promptFinalAnalysis()   { return language === 'fr' ? SYSTEM_PROMPT_FINAL_ANALYSIS   : SYSTEM_PROMPT_FINAL_ANALYSIS_EN; }
// Prompts dédiés à l'analyse finale (transcription complète — distincts des prompts temps-réel incrémentaux)
function promptFinalKeyPoints()  { return language === 'fr' ? SYSTEM_PROMPT_FINAL_KEYPOINTS  : SYSTEM_PROMPT_FINAL_KEYPOINTS_EN; }
function promptFinalQuestions()  { return language === 'fr' ? SYSTEM_PROMPT_FINAL_QUESTIONS  : SYSTEM_PROMPT_FINAL_QUESTIONS_EN; }

// ─── Global state ─────────────────────────────────────────────────────────────
let ws          = null;
let audioCtx    = null;
let mediaStream = null;
let processor   = null;
let recording   = false;
let language    = localStorage.getItem('parakeet-analysis-lang') || 'en';  // 'fr' | 'en'

let allSentences = [];
let lastSentIdx  = 0;
let speakerNames = {};  // { "SPEAKER_0": "Alice", "SPEAKER_1": "Bob" }

// Key points: [string] — real-time incremental
let keyPoints = [];
let lastKIdx  = 0;

// ─── Word-buffer settings ─────────────────────────────────────────────────────
let bufSizeQ        = parseInt(localStorage.getItem('parakeet-buf-q') || '200', 10);
let bufSizeK        = parseInt(localStorage.getItem('parakeet-buf-k') || '400', 10);
// scan pointers : avancent à chaque appel pour éviter le double-comptage des mots
let lastSentScanIdx = 0;
let lastKScanIdx    = 0;
// compteurs de mots accumulés depuis le dernier déclenchement LLM
let wordBufQ        = 0;
let wordBufK        = 0;

// Questions: [{ text, answer, answering }]
let questions = [];
// Actions: [string] — detected at the end of a meeting
let actions   = [];

// LLM — real-time key-point extraction (with history)
let llmHistoryK = [{ role: 'system', content: promptKeyPoints() }];
let llmQueueK   = [];
let llmBusyK    = false;

// LLM — real-time question detection (with history)
let llmHistoryQ = [{ role: 'system', content: promptQuestions() }];
let llmQueueQ   = [];
let llmBusyQ    = false;

// LLM — question answers (no history, one-shot per question)
let llmQueueAns = [];
let llmBusyAns  = false;

// LLM — real-time discovery questions (with history)
let discoveryQuestions = [];  // [string]
let llmHistoryD = [{ role: 'system', content: promptDiscovery() }];
let llmQueueD   = [];
let llmBusyD    = false;

// LLM — shared AbortController for all real-time streaming requests
// Aborted when retranscribeAndAnalyze() starts so the final analysis
// gets exclusive access to LMStudio's KV cache.
let _realtimeLLMCtrl = new AbortController();

// LLM — global mutex: only one real-time streaming request at a time.
// Prevents simultaneous key-points + questions + discovery requests from
// exhausting LMStudio's KV cache ("Context size has been exceeded").
let _llmSharedBusy = false;

// LLM — connection
let llmModelId   = 'local-model';
let llmConnected = false;

// ─── Current meeting state ────────────────────────────────────────────────────
let currentMeetingId    = null;
let currentCompanyName  = '';
let currentMeetingTitle = '';
let currentNumSpeakers  = 2;
let mediaRecorder          = null;
let audioChunks            = [];
let allPcmChunks           = [];   // all raw Float32 chunks — for post-recording re-transcription
let retranscribeAbortCtrl  = null; // AbortController for /transcribe-full fetch
let isRetranscribing       = false;
let recordingStartTime     = null;
let savedAudioPath         = '';
let summaryText            = '';
let nextStepsText          = '';

// Normalize next_steps: LLM may return a string or an array of objects/strings
function normalizeNextSteps(val) {
  if (!val) return '';
  if (typeof val === 'string') return val;
  if (Array.isArray(val)) {
    return val.map(item => {
      if (typeof item === 'string') return item;
      return item.text || item.action || item.description || item.step || JSON.stringify(item);
    }).join('\n');
  }
  return String(val);
}

// ─── DOM elements ─────────────────────────────────────────────────────────────
const dotServer     = document.getElementById('dot-server');
const dotLm         = document.getElementById('dot-lmstudio');
const dotMic        = document.getElementById('dot-mic');
const btnStart      = document.getElementById('btn-start');
const btnStop       = document.getElementById('btn-stop');
const btnReset      = document.getElementById('btn-reset');
const btnCsv        = document.getElementById('btn-csv');
const btnSrt        = document.getElementById('btn-srt');
const btnTxt        = document.getElementById('btn-txt');
function setExportBtns(disabled) { btnCsv.disabled = disabled; btnSrt.disabled = disabled; if (btnTxt) btnTxt.disabled = disabled; }
const urlInput      = document.getElementById('lmstudio-url');
const transcriptEl  = document.getElementById('transcript-area');
const keypointsList = document.getElementById('keypoints-list');
const questionsList = document.getElementById('questions-list');
const actionsList   = document.getElementById('actions-list');
const discoveryList = document.getElementById('discovery-list');
const tsBody        = document.getElementById('timestamps-body');
const meetingCtxBar = document.getElementById('meeting-context-bar');
const ctxCompany    = document.getElementById('ctx-company');
const ctxTitle      = document.getElementById('ctx-title');
const btnChangeMeeting = document.getElementById('btn-change-meeting');

// ─── Server / LMStudio polling ────────────────────────────────────────────────
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
  if (!recording) return;  // never open a WS connection outside of an active recording
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  ws = new WebSocket(WS_URL);
  ws.binaryType = 'arraybuffer';

  ws.onopen = () => {
    const sr = audioCtx ? audioCtx.sampleRate : 16000;
    ws.send(JSON.stringify({ type: 'config', sampleRate: sr, numSpeakers: currentNumSpeakers }));
  };

  ws.onmessage = (evt) => {
    try {
      const msg = JSON.parse(evt.data);
      if (msg.type === 'transcript') handleTranscript(msg);
    } catch (e) { console.warn('[ws]', e); }
  };

  ws.onclose = () => { ws = null; if (recording) setTimeout(connectWS, 3000); };
  ws.onerror = (e) => console.error('[ws]', e);
}

// ─── Transcript handling ──────────────────────────────────────────────────────
function handleTranscript(msg) {
  // Ignore all WS messages while re-transcription is running — retranscribeAndAnalyze()
  // owns allSentences from this point and must not be overwritten by stale WS data.
  if (isRetranscribing) return;

  allSentences = msg.sentences || [];
  transcriptEl.value = msg.fullText || '';
  renderTranscriptDisplay();
  renderSpeakersPanel();
  renderTimestamps();
  maybeTriggerKeyPoints();
  maybeTriggerQuestions();

  if (msg.final) {
    setDot(dotMic, 'red');
    setExportBtns(allSentences.length === 0);

    // If re-transcription is in progress, skip WS-based analysis —
    // retranscribeAndAnalyze() will call finalAnalysis + autoSave itself.
    if (isRetranscribing) return;

    const speakerText = buildSpeakerText(allSentences) || msg.fullText || '';

    (async () => {
      // Vider les queues temps-réel : l'analyse finale prend le pas sur tout
      llmQueueK   = [];
      llmQueueQ   = [];
      llmQueueAns = [];
      // Attendre la fin des appels LLM déjà en cours (le courant, pas les queued)
      await waitForQueues();

      // Analyse complète de la transcription — UN seul appel LLM (KP + questions + actions + summary)
      await finalAnalysis(speakerText);

      if (currentMeetingId !== null) {
        await autoSave();
      }
    })().catch(e => {
      console.error('[handleTranscript final]', e);
      if (currentMeetingId !== null) autoSave().catch(() => {});
    });
  }
}

function renderTranscriptDisplay() {
  const div = document.getElementById('transcript-display');
  if (!div) return;
  div.innerHTML = '';
  let lastSpk = null, group = null;
  allSentences.forEach(s => {
    const spk = s.speaker || '__none__';
    if (spk !== lastSpk) {
      group = document.createElement('div');
      group.className = 'speaker-turn';
      if (s.speaker) {
        const badge = document.createElement('div');
        badge.className = `speaker-badge spk-color-${getSpeakerIndex(s.speaker) % 6}`;
        badge.textContent = getDisplayName(s.speaker);
        group.appendChild(badge);
      }
      div.appendChild(group);
      lastSpk = spk;
    }
    const span = document.createElement('span');
    span.className = 'speaker-segment';
    span.textContent = s.segment + ' ';
    group.appendChild(span);
  });
  div.scrollTop = div.scrollHeight;
}

function renderSpeakersPanel() {
  const detected = [...new Set(allSentences.map(s => s.speaker).filter(Boolean))];
  const panel = document.getElementById('speakers-panel');
  if (!panel) return;
  if (!detected.length) { panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');
  panel.querySelector('#speakers-list').innerHTML = detected.map(spk => `
    <div class="speaker-row">
      <span class="speaker-badge spk-color-${getSpeakerIndex(spk) % 6}">${toFriendlyLabel(spk)}</span>
      <input class="speaker-name-input" data-spk="${spk}" type="text"
        placeholder="${toFriendlyLabel(spk)}" value="${escHtml(speakerNames[spk] || '')}" />
    </div>
  `).join('');
  panel.querySelectorAll('.speaker-name-input').forEach(inp => {
    inp.addEventListener('input', () => {
      const val = inp.value.trim();
      if (val) speakerNames[inp.dataset.spk] = val;
      else delete speakerNames[inp.dataset.spk];
      renderTranscriptDisplay();
      renderTimestamps();
    });
  });
}

// ─── Speaker helpers ──────────────────────────────────────────────────────────
function toFriendlyLabel(id) {
  const n = parseInt(id.replace('SPEAKER_', ''), 10);
  return `Speaker ${n + 1}`;
}
function getDisplayName(id) {
  if (!id) return null;
  return speakerNames[id] || toFriendlyLabel(id);
}
function getSpeakerIndex(id) {
  return parseInt(id.replace('SPEAKER_', ''), 10) || 0;
}

function buildSpeakerText(sentences) {
  let out = '', lastSpk = null;
  for (const s of sentences) {
    const name = s.speaker ? getDisplayName(s.speaker) : null;
    if (name && name !== lastSpk) { out += `\n[${name}]: `; lastSpk = name; }
    out += s.segment + ' ';
  }
  return out.trim();
}

function renderTimestamps() {
  tsBody.innerHTML = '';
  allSentences.forEach((s, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${i + 1}</td><td>${s.start}</td><td>${s.end}</td>
      <td>${s.speaker
        ? `<span class="speaker-badge spk-color-${getSpeakerIndex(s.speaker) % 6}">${escHtml(getDisplayName(s.speaker))}</span>`
        : '—'}</td>
      <td>${escHtml(s.segment)}</td>
      <td><button class="btn-delete-row" data-idx="${i}">&#10005;</button></td>
    `;
    tsBody.appendChild(tr);
  });
  tsBody.querySelectorAll('.btn-delete-row').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.currentTarget.dataset.idx, 10);
      allSentences.splice(idx, 1);
      transcriptEl.value = allSentences.map(s => s.segment).join(' ');
      if (lastSentIdx > allSentences.length) lastSentIdx = allSentences.length;
      renderTimestamps();
      setExportBtns(allSentences.length === 0);
    });
  });
}

// ─── LLM — Real-time key-point extraction ────────────────────────────────────
function countWords(text) {
  return text ? text.trim().split(/\s+/).filter(Boolean).length : 0;
}

function maybeTriggerKeyPoints(flush = false) {
  const unscanned = allSentences.slice(lastKScanIdx);
  wordBufK       += unscanned.reduce((n, s) => n + countWords(s.segment), 0);
  lastKScanIdx    = allSentences.length;          // scan pointer — avance toujours

  if (wordBufK >= bufSizeK || (flush && wordBufK > 0)) {
    const fragment = buildSpeakerText(allSentences.slice(lastKIdx))
                     || allSentences.slice(lastKIdx).map(s => s.segment).join(' ');
    lastKIdx = allSentences.length;               // trigger pointer — avance au déclenchement
    wordBufK = 0;
    if (fragment.trim()) { llmQueueK.push(fragment); processKeyPointsQueue(); }
  }
}

// Drain whichever real-time queue has pending items (priority: K > Q > Ans > D).
// Called after each processor finishes so the shared mutex is passed along.
function drainRealtimeLLMQueues() {
  if (_llmSharedBusy) return;
  if (llmQueueK.length   > 0) { processKeyPointsQueue(); return; }
  if (llmQueueQ.length   > 0) { processQuestionQueue();  return; }
  if (llmQueueAns.length > 0) { processAnswerQueue();    return; }
  if (llmQueueD.length   > 0) { processDiscoveryQueue(); return; }
}

async function processKeyPointsQueue() {
  if (llmBusyK || llmQueueK.length === 0 || _llmSharedBusy) return;
  llmBusyK = true;
  _llmSharedBusy = true;

  const fragment = llmQueueK.shift();
  llmHistoryK.push({ role: 'user', content: fragment });

  try {
    await checkLmStudio();
    if (!llmConnected) { llmHistoryK.pop(); }
    else {
      const url  = urlInput.value.trim();
      const resp = await fetch(url + '/chat/completions', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer lm-studio' },
        body:    JSON.stringify({
          model: llmModelId, messages: llmHistoryK,
          temperature: 0.1, max_tokens: 400, stream: true,
        }),
        signal: _realtimeLLMCtrl.signal,
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const { fullResponse } = await streamSSE(resp, (line) => {
        if (line.toUpperCase().startsWith('POINT:')) {
          const text = line.slice(6).trim();
          if (text && !keyPoints.includes(text)) {
            keyPoints.push(text);
            renderKeyPoints();
          }
        }
      });

      llmHistoryK.push({ role: 'assistant', content: fullResponse });
    }
  } catch (e) {
    if (e.name !== 'AbortError') console.error('[llm-kp]', e);
    llmHistoryK.pop();
  }

  llmBusyK = false;
  _llmSharedBusy = false;
  drainRealtimeLLMQueues();
}

function renderKeyPoints() {
  if (!keypointsList) return;
  if (keyPoints.length === 0) { keypointsList.innerHTML = ''; return; }
  keypointsList.innerHTML = keyPoints.map((t, i) => `
    <div class="list-item">
      <span class="list-idx kp-dot">•</span>
      <span>${escHtml(t)}</span>
      <button class="btn-delete-item" data-idx="${i}" title="Delete">&#10005;</button>
    </div>
  `).join('');
  keypointsList.querySelectorAll('.btn-delete-item').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.currentTarget.dataset.idx, 10);
      keyPoints.splice(idx, 1);
      renderKeyPoints();
    });
  });
}

// ─── LLM — Real-time question detection ──────────────────────────────────────
function maybeTriggerQuestions(flush = false) {
  const unscanned  = allSentences.slice(lastSentScanIdx);
  wordBufQ        += unscanned.reduce((n, s) => n + countWords(s.segment), 0);
  lastSentScanIdx  = allSentences.length;         // scan pointer — avance toujours

  if (wordBufQ >= bufSizeQ || (flush && wordBufQ > 0)) {
    const fragment = buildSpeakerText(allSentences.slice(lastSentIdx))
                     || allSentences.slice(lastSentIdx).map(s => s.segment).join(' ');
    lastSentIdx = allSentences.length;            // trigger pointer — avance au déclenchement
    wordBufQ    = 0;
    if (fragment.trim()) {
      llmQueueQ.push(fragment); processQuestionQueue();
      llmQueueD.push(fragment); processDiscoveryQueue();
    }
  }
}

async function processQuestionQueue() {
  if (llmBusyQ || llmQueueQ.length === 0 || _llmSharedBusy) return;
  llmBusyQ = true;
  _llmSharedBusy = true;

  const fragment = llmQueueQ.shift();
  llmHistoryQ.push({ role: 'user', content: fragment });

  try {
    await checkLmStudio();
    if (!llmConnected) { llmHistoryQ.pop(); }
    else {
      const url  = urlInput.value.trim();
      const resp = await fetch(url + '/chat/completions', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer lm-studio' },
        body:    JSON.stringify({
          model: llmModelId, messages: llmHistoryQ,
          temperature: 0.1, max_tokens: 256, stream: true,
        }),
        signal: _realtimeLLMCtrl.signal,
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
          }
        }
      });

      llmHistoryQ.push({ role: 'assistant', content: fullResponse });
    }
  } catch (e) {
    if (e.name !== 'AbortError') console.error('[llm-q]', e);
    llmHistoryQ.pop();
  }

  llmBusyQ = false;
  _llmSharedBusy = false;
  drainRealtimeLLMQueues();
}

// ─── LLM — Question answers ───────────────────────────────────────────────────
async function processAnswerQueue() {
  if (llmBusyAns || llmQueueAns.length === 0 || _llmSharedBusy) return;
  llmBusyAns = true;
  _llmSharedBusy = true;

  const qObj = llmQueueAns.shift();
  const url  = urlInput.value.trim();

  try {
    await checkLmStudio();
    if (!llmConnected) {
      qObj.answering = false;
      renderQuestions();
    } else {
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
        signal: _realtimeLLMCtrl.signal,
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      // Progressive streaming — response displays token by token
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
    }
  } catch (e) {
    if (e.name !== 'AbortError') console.error('[llm-ans]', e);
    qObj.answering = false;
    renderQuestions();
  }

  llmBusyAns = false;
  _llmSharedBusy = false;
  drainRealtimeLLMQueues();
}

// ─── LLM — Real-time discovery questions ─────────────────────────────────────
async function processDiscoveryQueue() {
  if (llmBusyD || llmQueueD.length === 0 || _llmSharedBusy) return;
  llmBusyD = true;
  _llmSharedBusy = true;

  const fragment = llmQueueD.shift();
  llmHistoryD.push({ role: 'user', content: fragment });

  try {
    await checkLmStudio();
    if (!llmConnected) { llmHistoryD.pop(); }
    else {
      const url  = urlInput.value.trim();
      const resp = await fetch(url + '/chat/completions', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer lm-studio' },
        body:    JSON.stringify({
          model: llmModelId, messages: llmHistoryD,
          temperature: 0.4, max_tokens: 256, stream: true,
        }),
        signal: _realtimeLLMCtrl.signal,
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const { fullResponse } = await streamSSE(resp, (line) => {
        if (line.toUpperCase().startsWith('DISCOVERY:')) {
          const text = line.slice(10).trim();
          if (text && !discoveryQuestions.includes(text)) {
            discoveryQuestions.push(text);
            renderDiscovery();
          }
        }
      });

      llmHistoryD.push({ role: 'assistant', content: fullResponse });
    }
  } catch (e) {
    if (e.name !== 'AbortError') console.error('[llm-d]', e);
    llmHistoryD.pop();
  }

  llmBusyD = false;
  _llmSharedBusy = false;
  drainRealtimeLLMQueues();
}

// ─── Wait for all real-time LLM queues to be idle ────────────────────────────
// Résout quand les 3 queues (key-points, questions, réponses) sont vides et inactives.
// Timeout de sécurité : 120 s (au-delà, on sauvegarde ce qu'on a).
function waitForQueues(timeoutMs = 120000) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    (function check() {
      const idle = !llmBusyK   && llmQueueK.length   === 0
                && !llmBusyQ   && llmQueueQ.length   === 0
                && !llmBusyAns && llmQueueAns.length === 0
                && !llmBusyD   && llmQueueD.length   === 0;
      if (idle) {
        resolve();
      } else if (Date.now() >= deadline) {
        console.warn('[waitForQueues] timeout — sauvegarde avec données partielles');
        resolve();
      } else {
        setTimeout(check, 300);
      }
    })();
  });
}

// ─── Analyse finale — transcription complète (écrase les résultats temps-réel) ─

// ─── Analyse finale — UN seul appel LLM, transcription complète → JSON structuré ─────────────────────
async function finalAnalysis(fullText) {
  console.log(`[finalAnalysis] appelé — fullText: ${fullText.length} chars, trim: ${fullText.trim().length}`);
  if (!fullText.trim()) {
    console.warn('[finalAnalysis] ABANDON — transcript vide, rien à analyser');
    showNotification(language === 'fr'
      ? '⚠ Transcript vide — analyse IA ignorée'
      : '⚠ Empty transcript — AI analysis skipped');
    return;
  }

  // Vérifier LMStudio — un retry après 4 s si indisponible
  await checkLmStudio();
  if (!llmConnected) {
    await new Promise(r => setTimeout(r, 4000));
    await checkLmStudio();
  }
  if (!llmConnected) {
    console.warn('[finalAnalysis] LMStudio indisponible — analyse finale ignorée');
    showNotification(language === 'fr'
      ? '⚠ LMStudio non disponible — analyse IA ignorée, transcription sauvegardée'
      : '⚠ LMStudio not available — AI analysis skipped, transcript saved');
    return;
  }

  // Tronquer le transcript pour ne pas dépasser la fenêtre de contexte du LLM.
  // Budget token conservateur : system prompt ≈ 700 tokens, laisser ≥ 1500 pour la réponse.
  // À 4096 tokens de contexte (LMStudio default) : 4096 - 700 (prompt) - 1500 (réponse) ≈ 1900 tokens input
  // → ~5500 caractères max. On garde début + fin de la transcription.
  const MAX_TRANSCRIPT_CHARS = 8000;
  let inputText = fullText;
  if (inputText.length > MAX_TRANSCRIPT_CHARS) {
    const half = MAX_TRANSCRIPT_CHARS / 2;
    inputText = inputText.slice(0, half)
      + '\n\n[...TRANSCRIPTION TRONQUÉE — MILIEU OMIS POUR RAISON DE CONTEXTE...]\n\n'
      + inputText.slice(-half);
    console.warn(`[finalAnalysis] Transcript tronqué : ${fullText.length} → ~${MAX_TRANSCRIPT_CHARS} chars`);
  }
  console.log(`[finalAnalysis] Lancement — texte: ${inputText.length} chars`);

  // Sauvegarder l'analyse temps-réel comme fallback avant de réinitialiser
  const prevKeyPoints = [...keyPoints];
  const prevQuestions = questions.map(q => ({ ...q }));
  const prevActions   = [...actions];
  const prevSummary   = summaryText;
  const prevNextSteps = nextStepsText;

  // Réinitialiser toutes les sections + afficher indicateur de génération
  keyPoints = []; renderKeyPoints();
  questions = []; llmQueueAns = []; renderQuestions();
  actions   = []; renderActions();
  actionsList.innerHTML = `<div class="detecting">${language === 'fr' ? 'Analyse finale en cours…' : 'Running final analysis…'}</div>`;

  const card    = document.getElementById('summary-card');
  const content = document.getElementById('summary-content');
  if (card && content) {
    card.classList.remove('hidden');
    content.innerHTML = `<div class="summary-generating">${language === 'fr' ? 'Génération en cours…' : 'Generating…'}</div>`;
  }

  let finishReason = '';
  try {
    const url      = urlInput.value.trim();
    const messages = [
      { role: 'system', content: promptFinalAnalysis() },
      { role: 'user',   content: inputText },
    ];

    const resp = await fetch(url + '/chat/completions', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer lm-studio' },
      body:    JSON.stringify({ model: llmModelId, messages, temperature: 0.1, stream: false, max_tokens: 1500 }),
      signal:  AbortSignal.timeout(180000),  // 3-min safety timeout — prevents infinite hang
    });
    console.log(`[finalAnalysis] Réponse LMStudio : HTTP ${resp.status}`);
    if (!resp.ok) {
      const errBody = await resp.text().catch(() => '');
      throw new Error(`HTTP ${resp.status} — ${errBody.slice(0, 200)}`);
    }

    const j   = await resp.json();
    const raw = j.choices?.[0]?.message?.content ?? '';
    finishReason      = j.choices?.[0]?.finish_reason ?? '';
    if (finishReason === 'length') {
      console.warn('[finalAnalysis] finish_reason=length — réponse tronquée par le modèle (contexte trop court)');
    }

    // Strip <think>…</think> blocks produced by reasoning models (e.g. ministral-reasoning)
    // before attempting JSON extraction — they consume context and confuse all parsers.
    const stripped = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

    // Extraire le JSON — plusieurs stratégies par ordre de fiabilité
    let parsed = null;

    // 1. Parse direct (modèle bien cadré qui renvoie JSON pur)
    try { parsed = JSON.parse(stripped); } catch (_) {}

    // 2. Bloc markdown ```json ... ```
    if (!parsed) {
      const mdMatch = stripped.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (mdMatch) try { parsed = JSON.parse(mdMatch[1]); } catch (_) {}
    }

    // 3. Extraction greedy : du premier { jusqu'au dernier } (JSON complet)
    if (!parsed) {
      const m = stripped.match(/\{[\s\S]*\}/);
      if (m) try { parsed = JSON.parse(m[0]); } catch (_) {}
    }

    // 4. Modèles reasoning : le dernier bloc JSON valide dans la réponse
    if (!parsed) {
      const allMatches = [...stripped.matchAll(/\{[\s\S]*?\}/gs)];
      for (let i = allMatches.length - 1; i >= 0; i--) {
        try { parsed = JSON.parse(allMatches[i][0]); break; } catch (_) {}
      }
    }

    // 5. Réparation JSON tronqué : fermer les accolades/crochets ouverts
    if (!parsed) {
      const start = stripped.indexOf('{');
      if (start !== -1) {
        let fragment = raw.slice(start);
        // Supprimer une éventuelle virgule finale avant de fermer
        fragment = fragment.replace(/,\s*$/, '');
        // Compter les niveaux ouverts non fermés
        let depth = 0; let inStr = false; let esc = false;
        for (const ch of fragment) {
          if (esc)            { esc = false; continue; }
          if (ch === '\\' && inStr) { esc = true; continue; }
          if (ch === '"')    { inStr = !inStr; continue; }
          if (inStr)         continue;
          if (ch === '{' || ch === '[') depth++;
          else if (ch === '}' || ch === ']') depth--;
        }
        if (inStr)   fragment += '"';   // fermer la chaîne ouverte
        if (depth > 0) fragment += '}'.repeat(depth);
        try { parsed = JSON.parse(fragment); } catch (_) {}
      }
    }

    if (!parsed) {
      console.error('[finalAnalysis] Réponse LLM brute (500 premiers chars) :', raw.slice(0, 500));
      console.error('[finalAnalysis] Après strip <think> (500 premiers chars) :', stripped.slice(0, 500));
      throw new Error('Aucun JSON valide dans la réponse LLM');
    }

    // Points clés
    keyPoints = (parsed.key_points || []).filter(s => typeof s === 'string' && s.trim());
    renderKeyPoints();

    // Questions avec réponses déjà générées dans le même appel
    questions = (parsed.questions || []).map(q => ({
      text:      typeof q === 'string' ? q.trim()     : (q.text   || '').trim(),
      answer:    typeof q === 'string' ? null          : (q.answer || null),
      answering: false,
    })).filter(q => q.text);
    renderQuestions();

    // Actions
    actions = (parsed.actions || []).filter(s => typeof s === 'string' && s.trim());
    renderActions();
    if (actions.length === 0) {
      actionsList.innerHTML = `<div class="detecting muted">${language === 'fr' ? 'Aucune action détectée' : 'No actions detected'}</div>`;
    }

    // Questions de découverte (pour le prochain échange)
    if (parsed.discovery_questions && parsed.discovery_questions.length) {
      discoveryQuestions = parsed.discovery_questions.filter(s => typeof s === 'string' && s.trim());
      renderDiscovery();
    }

    // Résumé (rapport structuré complet) — next_steps désormais intégré dans summary
    summaryText   = parsed.summary || '';
    nextStepsText = '';   // déprécié : tout est dans summaryText
    renderSummary();

  } catch (e) {
    console.error('[finalAnalysis]', e);

    // Restaurer l'analyse temps-réel comme fallback pour que autoSave() sauvegarde quelque chose
    if (prevKeyPoints.length) { keyPoints = prevKeyPoints; renderKeyPoints(); }
    if (prevQuestions.length) { questions = prevQuestions; renderQuestions(); }
    if (prevActions.length)   { actions   = prevActions;   renderActions(); }
    if (prevSummary)          { summaryText   = prevSummary; }
    if (prevNextSteps)        { nextStepsText = prevNextSteps; }
    renderSummary();

    const hint = finishReason === 'length'
      ? (language === 'fr' ? ' (contexte LLM trop court — réponse tronquée)' : ' (LLM context too short — response truncated)')
      : '';
    actionsList.innerHTML = `<div class="detecting muted">Analysis error: ${e.message}${hint}</div>`;
    showNotification('⚠ Analyse finale échouée — données temps-réel conservées');
  }
}

// ─── Rich summary markdown renderer (partagé avec library.js) ─────────────────
function _inlineHtml(text) {
  // Échapper d'abord, puis appliquer les transformations inline
  let s = escHtml(text);
  s = s.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');    // **gras**
  s = s.replace(/\*(.*?)\*/g,     '<em>$1</em>');            // *italique*
  return s;
}

window.formatRichSummary = function formatRichSummary(text) {
  if (!text || !text.trim()) return '';
  const lines = text.split('\n');
  const out   = [];
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    if (/^## /.test(line)) {
      out.push(`<h3 class="sr-section">${_inlineHtml(line.slice(3).trim())}</h3>`);
    } else if (/^### /.test(line)) {
      out.push(`<h4 class="sr-subsection">${_inlineHtml(line.slice(4).trim())}</h4>`);
    } else if (/^\d+\.\s/.test(line)) {
      out.push(`<div class="sr-item sr-numbered">${_inlineHtml(line.replace(/^\d+\.\s+/, ''))}</div>`);
    } else if (/^[-•]\s/.test(line)) {
      out.push(`<div class="sr-item sr-bullet">${_inlineHtml(line.replace(/^[-•]\s+/, ''))}</div>`);
    } else {
      out.push(`<p class="sr-para">${_inlineHtml(line)}</p>`);
    }
  }
  return out.join('');
};

// ─── Summary rendering ────────────────────────────────────────────────────────
function renderSummary() {
  const card    = document.getElementById('summary-card');
  const content = document.getElementById('summary-content');
  if (!card || !content) return;
  if (!summaryText) { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');
  content.innerHTML = `<div class="summary-rich">${formatRichSummary(summaryText)}</div>`;
}

// ─── Auto-save to DB ──────────────────────────────────────────────────────────
async function autoSave() {
  if (currentMeetingId === null) return;
  const duration = recordingStartTime ? (Date.now() - recordingStartTime) / 1000 : 0;

  try {
    await window.electronAPI.db.saveMeetingData(currentMeetingId, {
      sentences:         allSentences,
      keyPoints,
      questions:         questions.map(q => ({ text: q.text, answer: q.answer || '' })),
      actions,
      discoveryQuestions,
      summary:           summaryText,
      nextSteps:         nextStepsText,
      duration,
      audioPath:         savedAudioPath,
      speakerNames,
    });
    showNotification('Meeting saved ✓');
  } catch (e) {
    console.error('[autoSave]', e);
    showNotification('⚠ Save failed — check the console');
  }
}

// ─── Toast notification ───────────────────────────────────────────────────────
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

// ─── SSE streaming helper ─────────────────────────────────────────────────────
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

// ─── UI rendering ─────────────────────────────────────────────────────────────
function renderQuestions() {
  if (questions.length === 0) { questionsList.innerHTML = ''; return; }
  questionsList.innerHTML = questions.map((q, i) => `
    <div class="qa-item">
      <div class="qa-question">
        <span class="list-idx">${i + 1}</span>
        <span>${escHtml(q.text)}</span>
        <button class="btn-delete-item" data-idx="${i}" title="Delete">&#10005;</button>
      </div>
      ${q.answering && !q.answer
        ? '<div class="qa-answer answering">Generating answer…</div>'
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
      <button class="btn-delete-item" data-idx="${i}" title="Delete">&#10005;</button>
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

function renderDiscovery() {
  if (!discoveryList) return;
  if (discoveryQuestions.length === 0) { discoveryList.innerHTML = ''; return; }
  discoveryList.innerHTML = discoveryQuestions.map((q, i) => `
    <div class="discovery-item">
      <span class="discovery-icon">?</span>
      <span class="discovery-text">${escHtml(q)}</span>
      <button class="btn-copy-discovery" data-text="${escHtml(q)}" title="Copy">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
      </button>
      <button class="btn-delete-item" data-idx="${i}" title="Delete">&#10005;</button>
    </div>
  `).join('');
  discoveryList.querySelectorAll('.btn-copy-discovery').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const text = e.currentTarget.dataset.text;
      navigator.clipboard.writeText(text).catch(() => {});
      e.currentTarget.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
      setTimeout(() => {
        e.currentTarget.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>';
      }, 1500);
    });
  });
  discoveryList.querySelectorAll('.btn-delete-item').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.currentTarget.dataset.idx, 10);
      discoveryQuestions.splice(idx, 1);
      renderDiscovery();
    });
  });
}

// ─── Audio sources ────────────────────────────────────────────────────────────
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
      grpMic.appendChild(new Option('System microphone', 'mic:default'));
    } else {
      devices.forEach((d, i) =>
        grpMic.appendChild(new Option(d.label || `Mic ${i + 1}`, `mic:${d.deviceId}`)));
    }
  } catch (_) {
    grpMic.appendChild(new Option('System microphone', 'mic:default'));
  }
  sel.appendChild(grpMic);

  if (window.electronAPI?.desktopCapturer) {
    const grpSys = document.createElement('optgroup');
    grpSys.label = 'Online meetings';
    grpSys.appendChild(new Option('🖥️ System audio (Zoom, Teams, Meet…)', 'system'));
    sel.appendChild(grpSys);
  }

  const grpOther = document.createElement('optgroup');
  grpOther.label = 'Other sources';
  grpOther.appendChild(new Option('🌐 YouTube / Web URL', 'url'));
  grpOther.appendChild(new Option('📁 Audio file (wav, mp3, mp4, ogg…)', 'file'));
  sel.appendChild(grpOther);

  // Restore previous selection if still available
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
    stream.getVideoTracks().forEach(t => t.stop()); // drop the video track
    return stream;
  }

  const deviceId = val.startsWith('mic:') ? val.slice(4) : undefined;
  return navigator.mediaDevices.getUserMedia(
    deviceId && deviceId !== 'default'
      ? { audio: { deviceId: { exact: deviceId } }, video: false }
      : { audio: true, video: false }
  );
}

// ─── File audio transcription ─────────────────────────────────────────────────
async function startFileTranscription(file) {
  setDot(dotMic, 'orange');
  transcriptEl.value = '⏳ Decoding audio file…';

  // 1. Decode the file
  let pcmData;
  try {
    const buf = await file.arrayBuffer();
    const decodeCtx = new AudioContext();
    const decoded   = await decodeCtx.decodeAudioData(buf);
    await decodeCtx.close();

    // Resample to 16 000 Hz mono (OfflineAudioContext)
    const SR      = 16000;
    const offCtx  = new OfflineAudioContext(1, Math.ceil(decoded.duration * SR), SR);
    const bufSrc  = offCtx.createBufferSource();
    bufSrc.buffer = decoded;
    bufSrc.connect(offCtx.destination);
    bufSrc.start(0);
    const resampled = await offCtx.startRendering();
    pcmData = resampled.getChannelData(0); // Float32Array at 16 kHz
    transcriptEl.value = '';
  } catch (e) {
    alert('Unable to decode audio file: ' + e.message);
    setDot(dotMic, 'red');
    return;
  }

  // 2. Ensure WebSocket is connected
  if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
    connectWS();
  }
  // Wait up to 5s for WS to be ready
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
    alert('ASR server unavailable.');
    setDot(dotMic, 'red');
    return;
  }

  // 3. Send config (in case WS was already open)
  ws.send(JSON.stringify({ type: 'config', sampleRate: 16000, numSpeakers: currentNumSpeakers }));

  // 4. Initialize recording state
  recording          = true;
  recordingStartTime = Date.now();
  savedAudioPath     = '';
  summaryText        = '';
  nextStepsText      = '';
  audioChunks        = [];
  document.getElementById('nav-record').classList.add('recording');
  btnStart.disabled  = true;
  btnStop.disabled   = false;
  setExportBtns(true);

  // 5. Stream PCM chunks to WS (≈ 32× real-time)
  const CHUNK = 4096;
  for (let i = 0; i < pcmData.length; i += CHUNK) {
    if (!recording) break;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(pcmData.slice(i, i + CHUNK).buffer);
    }
    // Yield to event loop every 100 chunks (keeps UI responsive)
    if (((i / CHUNK) % 100) === 0) await new Promise(r => setTimeout(r, 0));
  }

  // 6. Signal end to server
  if (recording && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'stop' }));
  }
  recording         = false;
  document.getElementById('nav-record').classList.remove('recording');
  btnStart.disabled = false;
  btnStop.disabled  = true;
  setDot(dotMic, 'red');
}

// ─── Audio capture ────────────────────────────────────────────────────────────
async function startRecording() {
  if (!serverReady) {
    alert('ASR server is not ready yet. Wait for the green "ASR Server" dot.');
    return;
  }

  // If no active meeting, open the setup modal
  if (currentMeetingId === null) {
    openMeetingSetup();
    return;
  }

  // Source is an audio file → trigger the file picker
  const sourceVal = document.getElementById('audio-source-select')?.value || 'mic:default';
  if (sourceVal === 'file') {
    document.getElementById('audio-file-input').click();
    return;
  }

  // ── URL / web player source ───────────────────────────────────────────────
  // Audio comes from the urlWindow preload (url-preload.js) via IPC.
  // The preload taps the <video> element directly — no MediaStream/ScriptProcessor.
  if (sourceVal === 'url') {
    audioChunks        = [];
    allPcmChunks       = [];
    savedAudioPath     = '';
    summaryText        = '';
    nextStepsText      = '';
    recordingStartTime = Date.now();

    // Fresh AbortController so real-time LLM fetches can be cancelled later
    _realtimeLLMCtrl = new AbortController();

    // Force-close stale WS before creating a fresh server-side session
    if (ws) { ws.onclose = null; ws.close(); ws = null; }
    recording = true;
    connectWS();

    // Receive PCM chunks forwarded from urlWindow preload → main → renderer
    window.electronAPI.onUrlAudioPcm((rawBuffer) => {
      if (!recording) return;
      // IPC delivers the buffer as Uint8Array in the renderer (context isolation).
      // new Float32Array(uint8Array) would wrongly treat each *byte* as a float
      // (N bytes → N floats instead of N/4 floats).  We must reinterpret the
      // underlying bytes as IEEE 754 float32 by going through the ArrayBuffer.
      const ab  = ArrayBuffer.isView(rawBuffer)
        ? rawBuffer.buffer.slice(rawBuffer.byteOffset, rawBuffer.byteOffset + rawBuffer.byteLength)
        : rawBuffer;
      const pcm = new Float32Array(ab);
      allPcmChunks.push(pcm);  // keep for post-recording re-transcription
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(rawBuffer);
    });

    setDot(dotMic, 'orange');
    document.getElementById('nav-record').classList.add('recording');
    btnStart.disabled = true;
    btnStop.disabled  = false;
    setExportBtns(true);
    return;
  }

  try {
    mediaStream = await getAudioStream();
    await loadAudioSources(); // refresh labels after permission granted
  } catch (e) {
    alert('Audio access denied: ' + e.message);
    return;
  }

  // ScriptProcessor → WebSocket ASR
  audioCtx  = new AudioContext({ sampleRate: 16000 });
  const src = audioCtx.createMediaStreamSource(mediaStream);
  processor = audioCtx.createScriptProcessor(BUFFER_SIZE, 1, 1);

  processor.onaudioprocess = (evt) => {
    if (!recording) return;
    const data = evt.inputBuffer.getChannelData(0);
    // Accumulate ALL audio for post-recording re-transcription (no VAD filter here)
    allPcmChunks.push(new Float32Array(data));
    // Apply VAD before sending to real-time WebSocket stream
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    const rms = Math.sqrt(sum / data.length);
    if (rms < VAD_THRESHOLD) return;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(data.buffer.slice(0));
  };

  src.connect(processor);
  processor.connect(audioCtx.destination);

  // MediaRecorder → audio file
  audioChunks    = [];
  allPcmChunks   = [];
  savedAudioPath = '';
  summaryText    = '';
  nextStepsText  = '';
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

  // Force-close any leftover WS from the previous session before opening a new
  // one.  connectWS() returns early when ws.readyState === OPEN, which would
  // reuse the old server-side handler whose asr_thread has already been killed
  // by the previous 'stop' message → audio received but never transcribed.
  if (ws) {
    ws.onclose = null;  // prevent the auto-reconnect loop from firing
    ws.close();
    ws = null;
  }

  // Fresh AbortController so real-time LLM fetches can be cancelled later
  _realtimeLLMCtrl = new AbortController();

  recording = true;
  connectWS();
  setDot(dotMic, 'orange');
  document.getElementById('nav-record').classList.add('recording');
  btnStart.disabled = true;
  btnStop.disabled  = false;
  setExportBtns(true);
}

async function handleMediaRecorderStop() {
  if (!audioChunks.length || currentMeetingId === null) return;
  try {
    const blob   = new Blob(audioChunks, { type: 'audio/webm' });
    // Use FileReader.readAsDataURL — non-blocking async conversion to base64.
    // The previous byte-by-byte loop was synchronous and froze the JS event loop
    // for large recordings (tens of MB), preventing fetch responses from being
    // processed (causing the final transcription to appear stuck on macOS).
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    const result = await window.electronAPI.audio.save(currentMeetingId, base64);
    if (result && result.audioPath) savedAudioPath = result.audioPath;
  } catch (e) {
    console.error('[audio-save]', e);
  }
}

function stopRecording({ skipRetranscribe = false } = {}) {
  if (!recording) return;
  recording = false;
  document.getElementById('nav-record').classList.remove('recording');
  btnStart.disabled = false;
  btnStop.disabled  = true;
  setDot(dotMic, 'red');

  // Capture PCM snapshot synchronously before any async code can clear it
  const pcmSnapshot = allPcmChunks.slice();
  allPcmChunks = [];

  // Clean up URL audio IPC listener (url source path — no MediaStream/processor)
  window.electronAPI.offUrlAudioPcm?.();

  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  if (processor)   { processor.disconnect(); processor = null; }
  if (mediaStream) { mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null; }
  if (audioCtx)    { audioCtx.close(); audioCtx = null; }
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'stop' }));

  // Launch re-transcription unless caller asked to skip (e.g. resetAll)
  if (!skipRetranscribe && pcmSnapshot.length > 0) {
    // Close the WS immediately: /transcribe-full will return the full transcript,
    // so the WS final message is not needed. Closing now prevents any late WS
    // messages from overwriting allSentences during re-transcription.
    if (ws) { ws.onclose = null; ws.close(); ws = null; }
    isRetranscribing = true;
    retranscribeAndAnalyze(pcmSnapshot);  // fire-and-forget async
  }
}

function resetAll() {
  // Abort any in-progress re-transcription
  if (retranscribeAbortCtrl) { retranscribeAbortCtrl.abort(); retranscribeAbortCtrl = null; }
  isRetranscribing = false;
  hideProcessingOverlay();

  stopRecording({ skipRetranscribe: true });
  if (ws) { ws.close(); ws = null; }

  currentMeetingId    = null;
  currentCompanyName  = '';
  currentMeetingTitle = '';
  currentNumSpeakers  = 2;
  audioChunks         = [];
  allPcmChunks        = [];
  savedAudioPath      = '';
  summaryText         = '';
  nextStepsText       = '';
  recordingStartTime  = null;
  meetingCtxBar.classList.add('hidden');

  allSentences    = [];
  lastSentIdx     = 0;
  lastKIdx        = 0;
  lastSentScanIdx = 0;
  lastKScanIdx    = 0;
  wordBufQ        = 0;
  wordBufK        = 0;
  speakerNames = {};
  keyPoints    = [];
  questions    = [];
  actions      = [];
  llmHistoryK  = [{ role: 'system', content: promptKeyPoints() }];
  llmQueueK    = [];
  llmBusyK     = false;
  llmHistoryQ      = [{ role: 'system', content: promptQuestions() }];
  llmQueueQ        = [];
  llmBusyQ         = false;
  llmQueueAns      = [];
  llmBusyAns       = false;
  discoveryQuestions = [];
  llmHistoryD      = [{ role: 'system', content: promptDiscovery() }];
  llmQueueD        = [];
  llmBusyD         = false;
  _llmSharedBusy   = false;

  transcriptEl.value      = '';
  const tDisplay = document.getElementById('transcript-display');
  if (tDisplay) tDisplay.innerHTML = '';
  const sPanel = document.getElementById('speakers-panel');
  if (sPanel) sPanel.classList.add('hidden');
  if (keypointsList) keypointsList.innerHTML = '';
  questionsList.innerHTML = '';
  actionsList.innerHTML   = '';
  if (discoveryList) discoveryList.innerHTML = '';
  tsBody.innerHTML        = '';
  const summaryCard = document.getElementById('summary-card');
  if (summaryCard) summaryCard.classList.add('hidden');
  const summaryContent = document.getElementById('summary-content');
  if (summaryContent) summaryContent.innerHTML = '';
  setExportBtns(true);
  setDot(dotMic, 'red');
}

// ─── Meeting context management ───────────────────────────────────────────────
function setCurrentMeeting(meetingId, companyName, meetingTitle, numSpeakers) {
  currentMeetingId    = meetingId;
  currentCompanyName  = companyName;
  currentMeetingTitle = meetingTitle;
  currentNumSpeakers  = numSpeakers || 2;
  ctxCompany.textContent = companyName;
  ctxTitle.textContent   = meetingTitle;
  meetingCtxBar.classList.remove('hidden');
}

// Exposed for library.js
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
  const rows = ['Index,Speaker,Start (s),End (s),Segment'];
  allSentences.forEach((s, i) => {
    const spk = s.speaker ? getDisplayName(s.speaker) : '';
    rows.push(`${i + 1},"${spk.replace(/"/g, '""')}",${s.start},${s.end},"${s.segment.replace(/"/g, '""')}"`);
  });
  return rows.join('\r\n');
}

function buildTXT() {
  return allSentences.map(s => {
    const spk = s.speaker ? getDisplayName(s.speaker) : null;
    return spk ? `[${spk}] ${s.segment}` : s.segment;
  }).join('\n');
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

// ─── Processing overlay helpers ───────────────────────────────────────────────
let _progressTimer = null;
let _progressCurrent = 0;

function showProcessingOverlay(message) {
  const overlay = document.getElementById('processing-overlay');
  if (!overlay) return;
  document.getElementById('processing-message').textContent = message;
  overlay.classList.remove('hidden');
  _setProgress(0);
}

function updateProcessingOverlay(message) {
  const el = document.getElementById('processing-message');
  if (el) el.textContent = message;
}

function hideProcessingOverlay() {
  const overlay = document.getElementById('processing-overlay');
  if (overlay) overlay.classList.add('hidden');
  _clearProgressTimer();
}

function _setProgress(pct) {
  _progressCurrent = Math.min(100, Math.max(0, pct));
  const bar = document.getElementById('processing-progress-bar');
  const label = document.getElementById('processing-percent');
  if (bar) bar.style.width = _progressCurrent + '%';
  if (label) label.textContent = Math.round(_progressCurrent) + '%';
}

function _clearProgressTimer() {
  if (_progressTimer) { clearInterval(_progressTimer); _progressTimer = null; }
}

/**
 * Simulate progress from `from` toward `target` over time.
 * The bar never actually reaches `target` — it slows exponentially.
 * Call _setProgress(100) when the step truly completes.
 */
function startProgressSimulation(from, target) {
  _clearProgressTimer();
  _setProgress(from);
  _progressTimer = setInterval(() => {
    const remaining = target - _progressCurrent;
    if (remaining <= 0.3) return;
    _setProgress(_progressCurrent + remaining * 0.05);
  }, 200);
}

function completeProgress(pct = 100) {
  _clearProgressTimer();
  _setProgress(pct);
}

// ─── PCM → WAV encoder ────────────────────────────────────────────────────────
function pcmToWav(f32, sampleRate = 16000) {
  const dataLen = f32.length * 2; // 16-bit mono = 2 bytes/sample
  const buf = new ArrayBuffer(44 + dataLen);
  const v = new DataView(buf);
  const str = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + dataLen, true);
  str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true);       // PCM, mono
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);       // blockAlign, bitsPerSample
  str(36, 'data'); v.setUint32(40, dataLen, true);
  let off = 44;
  for (let i = 0; i < f32.length; i++) {
    v.setInt16(off, Math.max(-32768, Math.min(32767, f32[i] * 32767 | 0)), true);
    off += 2;
  }
  return buf;
}

// ─── Post-recording re-transcription & analysis ───────────────────────────────
async function retranscribeAndAnalyze(chunks) {
  retranscribeAbortCtrl = new AbortController();
  const { signal } = retranscribeAbortCtrl;

  const msgTranscribing = language === 'fr' ? 'Transcription en cours…'    : 'Transcription in progress…';
  const msgAnalyzing    = language === 'fr' ? 'Analyse IA en cours…'        : 'AI analysis in progress…';
  const msgSaving       = language === 'fr' ? 'Sauvegarde…'                 : 'Saving…';

  showProcessingOverlay(msgTranscribing);
  startProgressSimulation(0, 85);

  try {
    // Build a single contiguous Float32Array from all accumulated chunks
    const totalSamples = chunks.reduce((s, c) => s + c.length, 0);
    const combined = new Float32Array(totalSamples);
    let offset = 0;
    for (const c of chunks) { combined.set(c, offset); offset += c.length; }
    console.log(`[retranscribe] PCM snapshot: ${chunks.length} chunks, ${totalSamples} samples (${(totalSamples/16000).toFixed(1)}s), allSentences avant fetch: ${allSentences.length}`);

    // Save WAV audio before transcription — works for both mic and URL capture.
    // Uses the same PCM data sent to /transcribe-full, so audio and transcript always match.
    if (currentMeetingId !== null && !savedAudioPath) {
      try {
        const wavBuf    = pcmToWav(combined);
        const wavBase64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload  = () => resolve(reader.result.split(',')[1]);
          reader.onerror = reject;
          reader.readAsDataURL(new Blob([wavBuf], { type: 'audio/wav' }));
        });
        const ar = await window.electronAPI.audio.save(currentMeetingId, wavBase64, 'recording.wav');
        if (ar?.audioPath) savedAudioPath = ar.audioPath;
        console.log(`[retranscribe] Audio WAV sauvegardé : ${savedAudioPath}`);
      } catch (e) {
        console.error('[retranscribe] Audio WAV save failed:', e);
      }
    }

    // POST raw PCM to the server for a clean full transcription
    const resp = await fetch(RETRANSCRIBE_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body:    combined.buffer,
      signal,
    });

    if (!isRetranscribing) return;
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const result = await resp.json();
    if (!isRetranscribing) return;
    console.log(`[retranscribe] /transcribe-full → sentences: ${result.sentences?.length ?? 'N/A'}, fullText: ${result.fullText?.length ?? 0} chars`);

    completeProgress(100);

    // Replace real-time transcription with the clean re-transcription.
    // Fall back to the real-time sentences if the server returned nothing
    // (e.g. corrupt PCM — avoids overwriting good data with an empty array).
    if (result.sentences && result.sentences.length > 0) {
      allSentences = result.sentences;
      transcriptEl.value = result.fullText || '';
      renderTranscriptDisplay();
      renderSpeakersPanel();
      renderTimestamps();
    }
    setExportBtns(allSentences.length === 0);

    const speakerText = buildSpeakerText(allSentences) || result.fullText || transcriptEl.value || '';
    console.log(`[retranscribe] speakerText: ${speakerText.length} chars, allSentences: ${allSentences.length}, transcriptEl: ${transcriptEl.value.length} chars`);

    // Early save: persist the clean transcript immediately so data is never lost
    // even if finalAnalysis fails or LMStudio is unavailable.
    // At this point keyPoints/questions/actions still hold the real-time analysis values,
    // so the save is meaningful even before the final analysis runs.
    if (currentMeetingId !== null) {
      try { await autoSave(); } catch (_) {}
    }

    // Flush real-time LLM queues and abort any in-flight streaming requests
    // so the final analysis gets exclusive access to LMStudio's KV cache.
    // The AbortError thrown inside each processor sets llmBusyX = false,
    // so waitForQueues() resolves quickly (no 120-second spin).
    llmQueueK   = [];
    llmQueueQ   = [];
    llmQueueAns = [];
    llmQueueD   = [];
    _realtimeLLMCtrl.abort();
    _realtimeLLMCtrl = new AbortController();   // fresh controller for future recordings
    _llmSharedBusy   = false;                   // released by AbortError catch blocks, but reset here as safety net
    console.log('[retranscribe] Attente fin queues LLM temps-réel…');
    await waitForQueues(15000);
    console.log('[retranscribe] Queues inactives → lancement analyse finale');

    // Run single-call LLM analysis on the clean transcription
    updateProcessingOverlay(msgAnalyzing);
    startProgressSimulation(0, 90);
    // Small delay so the overlay message is visible before finalAnalysis fires
    await new Promise(r => setTimeout(r, 300));
    await finalAnalysis(speakerText);
    completeProgress(100);

    // Persist to DB — always save after analysis, regardless of isRetranscribing.
    // autoSave() already guards against null meetingId; the isRetranscribing check
    // here was causing silent data loss when reset() raced against a long LLM call.
    updateProcessingOverlay(msgSaving);
    if (currentMeetingId !== null) await autoSave();

  } catch (e) {
    if (signal.aborted) return;
    console.error('[retranscribe]', e);
    showNotification('⚠ Re-transcription error: ' + e.message);
    // Save whatever real-time data we have, even if re-transcription or analysis failed.
    if (currentMeetingId !== null) try { await autoSave(); } catch (_) {}
  } finally {
    isRetranscribing      = false;
    retranscribeAbortCtrl = null;
    hideProcessingOverlay();
  }
}

// ─── Events ───────────────────────────────────────────────────────────────────
btnStart.addEventListener('click', startRecording);
btnStop.addEventListener ('click', stopRecording);
btnReset.addEventListener('click', resetAll);

btnCsv.addEventListener('click', () =>
  exportFile(buildCSV(), `transcription_${ts()}.csv`, [{ name: 'CSV', extensions: ['csv'] }])
);
btnSrt.addEventListener('click', () =>
  exportFile(buildSRT(), `transcription_${ts()}.srt`, [{ name: 'SRT', extensions: ['srt'] }])
);
if (btnTxt) btnTxt.addEventListener('click', () =>
  exportFile(buildTXT(), `transcript_${ts()}.txt`, [{ name: 'Text', extensions: ['txt'] }])
);

urlInput.addEventListener('change', () => {
  llmConnected = false;
  setDot(dotLm, 'red');
  checkLmStudio();
});

btnChangeMeeting.addEventListener('click', () => {
  openMeetingSetup();
});

// Analysis language toggle (controls which LLM prompts are used)
document.querySelectorAll('.lang-btn').forEach(btn => {
  btn.classList.toggle('active', btn.dataset.lang === language);
  btn.addEventListener('click', () => {
    language = btn.dataset.lang;
    localStorage.setItem('parakeet-analysis-lang', language);
    document.querySelectorAll('.lang-btn').forEach(b => b.classList.toggle('active', b === btn));
    llmHistoryQ = [{ role: 'system', content: promptQuestions() }]; // reset history
    llmHistoryD = [{ role: 'system', content: promptDiscovery() }]; // reset discovery history
  });
});

// UI language toggle (controls interface text via i18n)
document.querySelectorAll('.ui-lang-btn').forEach(btn => {
  btn.classList.toggle('active', btn.dataset.uiLang === (localStorage.getItem('parakeet-ui-lang') || 'en'));
  btn.addEventListener('click', () => {
    document.querySelectorAll('.ui-lang-btn').forEach(b => b.classList.toggle('active', b === btn));
    if (typeof window.setUiLang === 'function') window.setUiLang(btn.dataset.uiLang);
  });
});

// Word-buffer size selectors
const bufQSel = document.getElementById('buf-q-select');
const bufKSel = document.getElementById('buf-k-select');
if (bufQSel) {
  bufQSel.value = String(bufSizeQ);
  bufQSel.addEventListener('change', () => {
    bufSizeQ = parseInt(bufQSel.value, 10);
    localStorage.setItem('parakeet-buf-q', bufQSel.value);
  });
}
if (bufKSel) {
  bufKSel.value = String(bufSizeK);
  bufKSel.addEventListener('change', () => {
    bufSizeK = parseInt(bufKSel.value, 10);
    localStorage.setItem('parakeet-buf-k', bufKSel.value);
  });
}

const exportFmtSel = document.getElementById('export-format-select');
if (exportFmtSel) {
  exportFmtSel.value = localStorage.getItem('parakeet-export-format') || 'docx';
  exportFmtSel.addEventListener('change', () => {
    localStorage.setItem('parakeet-export-format', exportFmtSel.value);
  });
}
window.getExportFormat = () => localStorage.getItem('parakeet-export-format') || 'docx';

document.getElementById('btn-refresh-sources').addEventListener('click', loadAudioSources);

// Show/hide the URL row when the "url" source is selected
document.getElementById('audio-source-select').addEventListener('change', (e) => {
  document.getElementById('url-source-row')
    .classList.toggle('hidden', e.target.value !== 'url');
});

// Open URL in a BrowserWindow + switch to system audio
document.getElementById('btn-open-url').addEventListener('click', async () => {
  const raw = document.getElementById('url-web-input').value.trim();
  if (!raw) return;
  let url = raw;
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  try { new URL(url); } catch { alert('Invalid URL.'); return; }

  if (window.electronAPI?.webview) {
    await window.electronAPI.webview.open(url);
    // Keep source as 'url' — audio is captured directly from the web player
    // window via IPC (url-preload.js taps the <video> element).
    // Do NOT switch to 'system': macOS system audio capture cannot intercept
    // audio from Electron windows without a virtual loopback device.
    document.getElementById('url-source-row').classList.add('hidden');
  } else {
    window.open(url, '_blank');
  }
});

// Close the URL window
document.getElementById('btn-close-url').addEventListener('click', () => {
  if (window.electronAPI?.webview) window.electronAPI.webview.close();
  document.getElementById('url-source-row').classList.add('hidden');
  const sel = document.getElementById('audio-source-select');
  sel.value = sel.options[0]?.value || 'mic:default';
});

// Audio file selected → start transcription
document.getElementById('audio-file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = ''; // allow re-selecting the same file
  if (!file) return;
  if (currentMeetingId === null) {
    alert('Please configure a meeting before transcribing a file.');
    return;
  }
  await startFileTranscription(file);
});

// openMeetingSetup is defined in library.js
function openMeetingSetup() {
  if (typeof window._libOpenMeetingSetup === 'function') {
    window._libOpenMeetingSetup();
  }
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────
document.getElementById('nav-record').addEventListener('click', () => {
  // If library/history is open, just close it and return to capture view
  if (document.getElementById('shell').classList.contains('lib-open')) {
    if (typeof window._libToggle === 'function') window._libToggle();
    return;
  }
  if (recording) {
    stopRecording();
  } else {
    startRecording();
  }
});

document.getElementById('nav-history').addEventListener('click', () => {
  if (typeof window._libToggle === 'function') window._libToggle();
});

document.getElementById('btn-sidebar-toggle').addEventListener('click', () => {
  const sidebar  = document.getElementById('sidebar');
  const expanded = sidebar.classList.toggle('expanded');
  localStorage.setItem('sidebar-expanded', expanded ? '1' : '0');
});

// Restore sidebar state
if (localStorage.getItem('sidebar-expanded') === '1') {
  document.getElementById('sidebar').classList.add('expanded');
}

// ─── Q&A panel toggle ─────────────────────────────────────────────────────────
document.getElementById('btn-qa-toggle').addEventListener('click', () => {
  const panel      = document.getElementById('qa-panel');
  const isExpanded = panel.classList.toggle('expanded');
  localStorage.setItem('qa-panel-collapsed', isExpanded ? '0' : '1');
  if (isExpanded) {
    // Re-apply saved custom width when expanding
    const w = localStorage.getItem('qa-panel-width');
    if (w) panel.style.width = w;
  } else {
    // Clear inline width so the CSS rule (36 px) can take over
    panel.style.width = '';
  }
});

// Restore Q&A panel state (default: expanded)
(function () {
  const panel = document.getElementById('qa-panel');
  if (localStorage.getItem('qa-panel-collapsed') === '1') {
    panel.classList.remove('expanded');
    panel.style.width = ''; // ensure inline width doesn't override CSS
  } else {
    const w = localStorage.getItem('qa-panel-width');
    if (w) panel.style.width = w;
  }
})();

// ─── Resize: Q&A panel width (drag the divider-h) ────────────────────────────
(function () {
  const handle = document.getElementById('divider-qa');
  const panel  = document.getElementById('qa-panel');

  handle.addEventListener('mousedown', (e) => {
    // If panel is collapsed, just expand it
    if (!panel.classList.contains('expanded')) {
      panel.classList.add('expanded');
      localStorage.setItem('qa-panel-collapsed', '0');
      return;
    }
    e.preventDefault();
    const startX = e.clientX;
    const startW = panel.offsetWidth;

    panel.classList.add('resizing');
    document.body.style.userSelect = 'none';
    document.body.style.cursor     = 'col-resize';
    handle.classList.add('dragging');

    function onMove(e) {
      // Moving left → larger panel (we are to the left of the panel)
      const delta = startX - e.clientX;
      const newW  = Math.max(180, Math.min(560, startW + delta));
      panel.style.width = newW + 'px';
    }

    function onUp() {
      panel.classList.remove('resizing');
      handle.classList.remove('dragging');
      document.body.style.userSelect = '';
      document.body.style.cursor     = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
      localStorage.setItem('qa-panel-width', panel.style.width);
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  });
})();

// ─── Resize: transcript ↕ segments (drag the divider-v) ─────────────────────
(function () {
  const handle  = document.getElementById('divider-segments');
  const topEl   = document.getElementById('live-text');
  const bottomEl = document.getElementById('timestamps-card');

  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const startY  = e.clientY;
    const startH1 = topEl.offsetHeight;
    const startH2 = bottomEl.offsetHeight;

    handle.classList.add('dragging');
    document.body.style.userSelect = 'none';
    document.body.style.cursor     = 'row-resize';

    function onMove(e) {
      const delta = e.clientY - startY;
      const newH1 = Math.max(80, startH1 + delta);
      const newH2 = Math.max(80, startH2 - delta);
      topEl.style.flex    = `0 0 ${newH1}px`;
      bottomEl.style.flex = `0 0 ${newH2}px`;
    }

    function onUp() {
      handle.classList.remove('dragging');
      document.body.style.userSelect = '';
      document.body.style.cursor     = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  });
})();

document.getElementById('btn-toggle-segments').addEventListener('click', function () {
  const card    = document.getElementById('timestamps-card');
  const divider = document.getElementById('divider-segments');
  const app     = document.getElementById('app');
  const showing = !card.classList.contains('hidden');

  card.classList.toggle('hidden',   showing);
  divider.classList.toggle('hidden', showing);
  app.classList.toggle('show-segments', !showing);
  this.classList.toggle('active', !showing);

  // Reset inline sizes when hiding so CSS rules take over again
  if (showing) {
    document.getElementById('live-text').style.flex = '';
    card.style.flex = '';
  }
});

// ─── Theme ────────────────────────────────────────────────────────────────────
function applyTheme(theme) {
  document.body.dataset.theme = theme;
  localStorage.setItem('parakeet-theme', theme);
  document.querySelectorAll('.theme-option').forEach(b =>
    b.classList.toggle('active', b.dataset.theme === theme));
}

document.querySelectorAll('.theme-option').forEach(btn => {
  btn.addEventListener('click', () => applyTheme(btn.dataset.theme));
});

// ─── Settings panel ───────────────────────────────────────────────────────────
(function () {
  const panel  = document.getElementById('settings-panel');
  const navBtn = document.getElementById('nav-settings');

  navBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = panel.classList.toggle('open');
    navBtn.classList.toggle('active', isOpen);
  });

  // Close when clicking outside
  document.addEventListener('click', (e) => {
    if (!panel.contains(e.target) && e.target !== navBtn) {
      panel.classList.remove('open');
      navBtn.classList.remove('active');
    }
  });
})();

// ─── Q&A section collapse / expand ────────────────────────────────────────────
document.querySelectorAll('.qa-section-toggle').forEach(btn => {
  const section = document.getElementById(btn.dataset.target);
  if (!section) return;

  // Restore saved state
  const key = 'parakeet-qa-collapsed-' + btn.dataset.target;
  if (localStorage.getItem(key) === '1') section.classList.add('collapsed');

  btn.addEventListener('click', () => {
    const collapsed = section.classList.toggle('collapsed');
    localStorage.setItem(key, collapsed ? '1' : '0');
  });
});

// ─── Init ─────────────────────────────────────────────────────────────────────
applyTheme(localStorage.getItem('parakeet-theme') || 'light');
if (typeof window.applyI18n === 'function') window.applyI18n();
pollServer();
checkLmStudio();
setInterval(checkLmStudio, 10000);
loadAudioSources();
