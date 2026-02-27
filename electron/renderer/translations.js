'use strict';

// ─── Translation dictionaries ─────────────────────────────────────────────────
const TRANSLATIONS = {

  en: {
    // Sidebar
    'nav.record':   'Record',
    'nav.history':  'History',
    'nav.settings': 'Settings',
    'nav.collapse': 'Collapse',

    // Header
    'header.title': 'Echo2Text — Transcription & Real Time Analysis',

    // Status bar
    'status.asr':      'ASR Server',
    'status.lmstudio': 'LMStudio',
    'status.mic':      'Microphone',

    // Main buttons
    'btn.start':    '▶ Start',
    'btn.stop':     '■ Stop',
    'btn.reset':    '↺ Reset',
    'btn.csv':      '↓ CSV',
    'btn.srt':      '↓ SRT',
    'btn.segments': '☰ Segments',

    // Audio source
    'audio.default_mic': 'System microphone',

    // Meeting context bar
    'ctx.active': 'Active meeting:',
    'ctx.change': 'Change',

    // Card labels
    'card.live':       'Live Transcription',
    'card.segments':   'Timestamped segments',
    'card.summary':    'Meeting Summary',
    'card.speakers':   'Speakers',
    'card.spk_hint':   '(click to rename)',

    // Segments table headers
    'seg.num':     '#',
    'seg.start':   'Start (s)',
    'seg.end':     'End (s)',
    'seg.speaker': 'Speaker',
    'seg.text':    'Segment',

    // QA panel
    'qa.keypoints': 'Key points',
    'qa.questions': 'Questions',
    'qa.actions':   'Actions',

    // Badges
    'badge.realtime':     'real-time',
    'badge.endofmeeting': 'end of meeting',

    // Settings panel
    'settings.ui_lang':      'Interface',
    'settings.analysis_lang':'Analysis language',
    'settings.lmstudio_url': 'LMStudio URL',
    'settings.theme':        'Theme',

    // Theme options
    'theme.dark.name':  'Dark',
    'theme.dark.desc':  'Dark background, vivid orange accents',
    'theme.light.name': 'Light',
    'theme.light.desc': 'Clean white background, orange accents',
    'theme.nord.name':  'Nord',
    'theme.nord.desc':  'Northern glacier blue, cool tones',
    'theme.sepia.name': 'Sépia',
    'theme.sepia.desc': 'Warm tones, soft brown on ivory',

    // Modal
    'modal.heading':         'New meeting',
    'modal.company_label':   'Company',
    'modal.btn_new_company': '+ New',
    'modal.company_name':    'Company name',
    'modal.company_ph':      'e.g. ACME Corp',
    'modal.title_label':     'Meeting title',
    'modal.title_ph':        'e.g. Q2 kick-off meeting',
    'modal.service_label':   'Service / Team',
    'modal.service_optional':'(optional)',
    'modal.service_ph':      'e.g. Product, Design, HR…',
    'modal.desc_label':      'Description',
    'modal.desc_optional':   '(optional)',
    'modal.desc_ph':         'Context, agenda…',
    'modal.speakers_label':  'Number of speakers',
    'modal.btn_cancel':      'Cancel',
    'modal.btn_confirm':     '▶ Start',

    // Library
    'lib.heading':           'Library',
    'lib.companies_col':     'Companies',
    'lib.btn_new_meeting':   '+ New meeting',
    'lib.empty_hint':        'Select a company to view its meetings.',
    'lib.empty_companies':   'No companies yet.\nCreate one with +',
    'lib.empty_meetings':    'No meetings for this company.',

    // Library detail tabs
    'tab.summary':    'Summary',
    'tab.keypoints':  'Key points',
    'tab.questions':  'Questions',
    'tab.actions':    'Actions',
    'tab.transcript': 'Transcript',
    'tab.segments':   'Segments',

    // Library detail content
    'detail.delete_btn':    'Delete',
    'detail.audio_unavail': 'Audio recording not available.',
    'detail.no_summary':    'No summary generated for this meeting.',
    'detail.next_steps':    'Next steps',
    'detail.no_keypoints':  'No key points extracted for this meeting.',
    'detail.no_questions':  'No questions detected.',
    'detail.no_actions':    'No actions detected.',
    'detail.no_transcript': 'No transcription available.',
    'detail.no_segments':   'No segments available.',

    // Timeline
    'tl.empty':        'No meetings for this company.',
    'tl.date_unknown': 'Unknown date',

    // Confirm dialogs
    'confirm.delete_meeting': 'Delete this meeting? This action cannot be undone.',
    'confirm.delete_company': 'Delete company "{name}" and ALL its meetings?',
    'confirm.new_company':    'New company name:',
  },

  fr: {
    'nav.record':   'Enregistrer',
    'nav.history':  'Historique',
    'nav.settings': 'Paramètres',
    'nav.collapse': 'Réduire',

    'header.title': 'Echo2Text — Transcription & Analyse en Temps Réel',

    'status.asr':      'Serveur ASR',
    'status.lmstudio': 'LMStudio',
    'status.mic':      'Microphone',

    'btn.start':    '▶ Démarrer',
    'btn.stop':     '■ Arrêter',
    'btn.reset':    '↺ Réinitialiser',
    'btn.csv':      '↓ CSV',
    'btn.srt':      '↓ SRT',
    'btn.segments': '☰ Segments',

    'audio.default_mic': 'Microphone système',

    'ctx.active': 'Réunion active :',
    'ctx.change': 'Changer',

    'card.live':     'Transcription en Direct',
    'card.segments': 'Segments horodatés',
    'card.summary':  'Synthèse de la Réunion',
    'card.speakers': 'Intervenants',
    'card.spk_hint': '(cliquer pour renommer)',

    'seg.num':     'N°',
    'seg.start':   'Début (s)',
    'seg.end':     'Fin (s)',
    'seg.speaker': 'Intervenant',
    'seg.text':    'Segment',

    'qa.keypoints': 'Points clés',
    'qa.questions': 'Questions',
    'qa.actions':   'Actions',

    'badge.realtime':     'temps réel',
    'badge.endofmeeting': 'fin de réunion',

    'settings.ui_lang':       'Interface',
    'settings.analysis_lang': "Langue d'analyse",
    'settings.lmstudio_url':  'URL LMStudio',
    'settings.theme':         'Thème',

    'theme.dark.name':  'Dark',
    'theme.dark.desc':  'Fond sombre, accents orange vif',
    'theme.light.name': 'Light',
    'theme.light.desc': 'Fond clair épuré, accents orange',
    'theme.nord.name':  'Nord',
    'theme.nord.desc':  'Bleu glacier nordique, tons froids',
    'theme.sepia.name': 'Sépia',
    'theme.sepia.desc': 'Tons chauds, brun doux sur ivoire',

    'modal.heading':         'Nouvelle réunion',
    'modal.company_label':   'Entreprise',
    'modal.btn_new_company': '+ Nouveau',
    'modal.company_name':    "Nom de l'entreprise",
    'modal.company_ph':      'ex : ACME Corp',
    'modal.title_label':     'Titre de la réunion',
    'modal.title_ph':        'ex : Réunion de lancement Q2',
    'modal.service_label':   'Service / Équipe',
    'modal.service_optional':'(optionnel)',
    'modal.service_ph':      'ex : Produit, Design, RH…',
    'modal.desc_label':      'Description',
    'modal.desc_optional':   '(optionnel)',
    'modal.desc_ph':         "Contexte, ordre du jour…",
    'modal.speakers_label':  "Nombre d'intervenants",
    'modal.btn_cancel':      'Annuler',
    'modal.btn_confirm':     '▶ Démarrer',

    'lib.heading':         'Bibliothèque',
    'lib.companies_col':   'Entreprises',
    'lib.btn_new_meeting': '+ Nouvelle réunion',
    'lib.empty_hint':      'Sélectionnez une entreprise pour voir ses réunions.',
    'lib.empty_companies': 'Aucune entreprise.\nCréez-en une avec +',
    'lib.empty_meetings':  'Aucune réunion pour cette entreprise.',

    'tab.summary':    'Synthèse',
    'tab.keypoints':  'Points clés',
    'tab.questions':  'Questions',
    'tab.actions':    'Actions',
    'tab.transcript': 'Transcription',
    'tab.segments':   'Segments',

    'detail.delete_btn':    'Supprimer',
    'detail.audio_unavail': 'Enregistrement audio non disponible.',
    'detail.no_summary':    'Aucune synthèse générée pour cette réunion.',
    'detail.next_steps':    'Prochaines étapes',
    'detail.no_keypoints':  'Aucun point clé extrait pour cette réunion.',
    'detail.no_questions':  'Aucune question détectée.',
    'detail.no_actions':    'Aucune action détectée.',
    'detail.no_transcript': 'Aucune transcription disponible.',
    'detail.no_segments':   'Aucun segment disponible.',

    'tl.empty':        'Aucune réunion pour cette entreprise.',
    'tl.date_unknown': 'Date inconnue',

    'confirm.delete_meeting': 'Supprimer cette réunion ? Cette action est irréversible.',
    'confirm.delete_company': 'Supprimer l\'entreprise "{name}" et TOUTES ses réunions ?',
    'confirm.new_company':    'Nom de la nouvelle entreprise :',
  },
};

// ─── State ────────────────────────────────────────────────────────────────────
let _uiLang = localStorage.getItem('parakeet-ui-lang') || 'en';

// ─── Core functions ───────────────────────────────────────────────────────────
function t(key) {
  const dict = TRANSLATIONS[_uiLang] || TRANSLATIONS.en;
  return dict[key] ?? TRANSLATIONS.en[key] ?? key;
}

function setUiLang(lang) {
  _uiLang = lang;
  localStorage.setItem('parakeet-ui-lang', lang);
  applyI18n();
}

function applyI18n() {
  // ── Targeted element updates ──────────────────────────────────────────────
  const set = (id, key) => { const el = document.getElementById(id); if (el) el.textContent = t(key); };
  const ph  = (id, key) => { const el = document.getElementById(id); if (el) el.placeholder  = t(key); };

  // Sidebar nav labels
  document.querySelectorAll('.nav-label').forEach(el => {
    const key = el.dataset.i18n;
    if (key) el.textContent = t(key);
  });

  // Header title (browser tab only — brand is now an SVG)
  document.title = t('header.title');

  // Status bar
  document.querySelectorAll('.status-item > span:last-child').forEach(el => {
    const key = el.dataset.i18n;
    if (key) el.textContent = t(key);
  });

  // Main buttons
  set('btn-start',           'btn.start');
  set('btn-stop',            'btn.stop');
  set('btn-reset',           'btn.reset');
  set('btn-csv',             'btn.csv');
  set('btn-srt',             'btn.srt');
  set('btn-toggle-segments', 'btn.segments');
  set('btn-change-meeting',  'ctx.change');

  // Audio source default option
  const defaultOpt = document.querySelector('#audio-source-select option[value="mic:default"]');
  if (defaultOpt) defaultOpt.textContent = t('audio.default_mic');

  // Meeting context bar
  document.querySelectorAll('.ctx-label').forEach(el => { el.textContent = t('ctx.active'); });

  // Card labels (with nested badge)
  document.querySelectorAll('.card-label[data-i18n]').forEach(el => {
    const key   = el.dataset.i18n;
    const badge = el.querySelector('.label-badge');
    const badgeKey = badge?.dataset.i18n;
    el.childNodes.forEach(n => { if (n.nodeType === 3) n.textContent = t(key) + ' '; });
    if (badge && badgeKey) badge.textContent = t(badgeKey);
  });

  // Speakers panel (has nested muted-label)
  const spkLabel = document.querySelector('#speakers-panel .card-label');
  if (spkLabel) {
    const hint = spkLabel.querySelector('.muted-label');
    spkLabel.childNodes.forEach(n => { if (n.nodeType === 3) n.textContent = t('card.speakers') + ' '; });
    if (hint) hint.textContent = t('card.spk_hint');
  }

  // Segment table headers
  document.querySelectorAll('thead th[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });

  // QA panel labels and badges
  document.querySelectorAll('.card-label > span[data-i18n], .qa-section .card-label[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });

  // Settings panel section labels
  document.querySelectorAll('.settings-section-label[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });

  // Theme option names and descriptions
  document.querySelectorAll('.theme-option[data-theme]').forEach(opt => {
    const theme = opt.dataset.theme;
    const nameEl = opt.querySelector('.theme-option-name');
    const descEl = opt.querySelector('.theme-option-desc');
    if (nameEl) nameEl.textContent = t(`theme.${theme}.name`);
    if (descEl) descEl.textContent = t(`theme.${theme}.desc`);
  });

  // Modal
  set('modal-company-name-heading', 'modal.heading');
  document.querySelectorAll('.modal-field > label[data-i18n]').forEach(el => {
    const key        = el.dataset.i18n;
    const muted      = el.querySelector('.muted-label');
    const mutedKey   = muted?.dataset.i18n;
    el.childNodes.forEach(n => { if (n.nodeType === 3) n.textContent = t(key); });
    if (muted && mutedKey) muted.textContent = t(mutedKey);
  });
  ph('modal-new-company-name', 'modal.company_ph');
  ph('modal-title',            'modal.title_ph');
  ph('modal-service',          'modal.service_ph');
  ph('modal-desc',             'modal.desc_ph');
  set('modal-btn-cancel',  'modal.btn_cancel');
  set('modal-btn-confirm', 'modal.btn_confirm');

  // Library
  const libTitle = document.querySelector('.lib-panel-title');
  if (libTitle) libTitle.textContent = t('lib.heading');
  set('btn-new-meeting-from-lib', 'lib.btn_new_meeting');

  // Library empty hint
  const hint = document.querySelector('#lib-empty-hint p');
  if (hint) hint.textContent = t('lib.empty_hint');

  // Library companies col header
  const compHeader = document.querySelector('#lib-companies-col .lib-col-header > span');
  if (compHeader) compHeader.textContent = t('lib.companies_col');

  // UI lang toggle active state
  document.querySelectorAll('.ui-lang-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.uiLang === _uiLang);
  });

  // Notify other modules (library.js re-renders if open)
  document.dispatchEvent(new CustomEvent('i18n:changed', { detail: { lang: _uiLang } }));
}

// ─── Expose globally ─────────────────────────────────────────────────────────
window.t          = t;
window.setUiLang  = setUiLang;
window.applyI18n  = applyI18n;
window.getUiLang  = () => _uiLang;
