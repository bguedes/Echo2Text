'use strict';

// ─── Meeting transcript export helpers ────────────────────────────────────────
function buildMeetingCSV(m) {
  const rows = ['Index,Speaker,Start (s),End (s),Segment'];
  (m.sentences || []).forEach((s, i) => {
    const name = _spkName(s.speaker, m.speaker_names);
    rows.push(`${i + 1},"${name.replace(/"/g, '""')}",${s.start_time ?? 0},${s.end_time ?? 0},"${(s.segment || '').replace(/"/g, '""')}"`);
  });
  return rows.join('\r\n');
}

function buildMeetingTXT(m) {
  return (m.sentences || []).map(s => {
    const name = _spkName(s.speaker, m.speaker_names);
    return name ? `[${name}] ${s.segment || ''}` : (s.segment || '');
  }).join('\n');
}

function _spkIdx(speaker) {
  if (speaker == null) return -1;
  if (typeof speaker === 'number') return speaker;
  const m = String(speaker).match(/(\d+)$/);
  return m ? parseInt(m[1], 10) : 0;
}

function _spkName(speaker, speakerNames) {
  if (speaker == null) return null;
  const key = String(speaker);
  if (speakerNames?.[key]) return speakerNames[key];
  const idx = _spkIdx(speaker);
  return idx >= 0 ? `Speaker ${idx + 1}` : key;
}

// ─── Global tooltip (avoids overflow:hidden clipping) ─────────────────────────
const _tip = document.createElement('div');
_tip.id = 'global-tooltip';
document.body.appendChild(_tip);

document.addEventListener('mouseover', e => {
  const el = e.target.closest('[data-tip]');
  if (!el) return;
  _tip.textContent = el.dataset.tip;
  _tip.classList.add('visible');
  _positionTip(el);
});
document.addEventListener('mouseout', e => {
  if (!e.target.closest('[data-tip]')) return;
  _tip.classList.remove('visible');
});
function _positionTip(el) {
  const r = el.getBoundingClientRect();
  const tw = 220, margin = 8;
  let left = r.right - tw;
  if (left < margin) left = margin;
  if (left + tw > window.innerWidth - margin) left = window.innerWidth - tw - margin;
  // Prefer below; if not enough room flip above
  const spaceBelow = window.innerHeight - r.bottom;
  if (spaceBelow >= 60) {
    _tip.style.top  = (r.bottom + 4) + 'px';
    _tip.style.left = left + 'px';
  } else {
    _tip.style.top  = (r.top - 4) + 'px';
    _tip.style.left = left + 'px';
    _tip.style.transform = 'translateY(-100%)';
    return;
  }
  _tip.style.transform = '';
}

// ─── Library state ────────────────────────────────────────────────────────────
let libOpen            = false;
let companies          = [];
let selectedCompanyId  = null;
let meetings           = [];
let selectedMeetingId  = null;
let analysisAbortCtrl  = null; // cancel in-flight generation

// ─── DOM elements ─────────────────────────────────────────────────────────────
const libraryPanel        = document.getElementById('library-panel');
const libCompaniesList    = document.getElementById('lib-companies-list');
const libCompanyNameTitle = document.getElementById('lib-company-name-title');
const libTimelineList     = document.getElementById('lib-timeline-list');
const libTimelinePane     = document.getElementById('lib-timeline-pane');
const libMeetingDetail    = document.getElementById('lib-meeting-detail');
const libEmptyHint        = document.getElementById('lib-empty-hint');

const libAnalysisPane     = document.getElementById('lib-analysis-pane');
const btnAnalysis         = document.getElementById('btn-analysis');

const meetingSetupModal     = document.getElementById('meeting-setup-modal');
const modalCompanySelect    = document.getElementById('modal-company-select');
const modalTitle            = document.getElementById('modal-title');
const modalService          = document.getElementById('modal-service');
const modalDesc             = document.getElementById('modal-desc');
const modalNumSpeakers      = document.getElementById('modal-num-speakers');
const modalNewCompanyForm   = document.getElementById('modal-new-company-form');
const modalNewCompanyName   = document.getElementById('modal-new-company-name');

// ─── Library open / close ─────────────────────────────────────────────────────
async function openLibrary() {
  libOpen = true;
  document.getElementById('shell').classList.add('lib-open');
  document.getElementById('nav-history').classList.add('active');
  await loadCompanies();
}

function closeLibrary() {
  libOpen = false;
  document.getElementById('shell').classList.remove('lib-open');
  document.getElementById('nav-history').classList.remove('active');
}

async function loadCompanies() {
  try {
    companies = await window.electronAPI.db.getCompanies();
  } catch (e) {
    console.error('[lib] getCompanies', e);
    companies = [];
  }
  renderCompanies();
}

function renderCompanies() {
  const _t = typeof window.t === 'function' ? window.t : (k => k);
  libCompaniesList.innerHTML = '';
  if (!companies.length) {
    libCompaniesList.innerHTML = `<div class="lib-empty">${_t('lib.empty_companies').replace('\\n', '<br>')}</div>`;
    return;
  }
  companies.forEach(c => {
    const el = document.createElement('div');
    el.className = 'lib-company-item' + (c.id === selectedCompanyId ? ' active' : '');
    el.dataset.id = c.id;
    el.innerHTML = `
      <span class="company-color-dot"></span>
      <span class="company-name">${escHtml(c.name)}</span>
      <button class="btn-delete-company" data-id="${c.id}" title="Delete">&#10005;</button>
    `;
    el.querySelector('.company-color-dot').style.background = c.color || '#ff7c00';
    el.addEventListener('click', (e) => {
      if (e.target.classList.contains('btn-delete-company')) return;
      selectCompany(c.id, c.name);
    });
    el.querySelector('.btn-delete-company').addEventListener('click', (e) => {
      e.stopPropagation();
      confirmDeleteCompany(c.id, c.name);
    });
    libCompaniesList.appendChild(el);
  });
}

async function selectCompany(id, name) {
  selectedCompanyId = id;
  selectedMeetingId = null;
  renderCompanies();
  libCompanyNameTitle.textContent = name || '';
  libMeetingDetail.classList.add('hidden');
  libAnalysisPane.classList.add('hidden');
  libEmptyHint.classList.add('hidden');
  libTimelinePane.classList.remove('hidden');
  btnAnalysis.disabled = false;
  // Cancel any in-flight analysis generation
  if (analysisAbortCtrl) { analysisAbortCtrl.abort(); analysisAbortCtrl = null; }
  await loadTimeline(id);
}

async function loadTimeline(companyId) {
  try {
    meetings = await window.electronAPI.db.getMeetings(companyId);
  } catch (e) {
    console.error('[lib] getMeetings', e);
    meetings = [];
  }
  renderTimeline(meetings);
}

function renderTimeline(list) {
  const _t    = typeof window.t === 'function' ? window.t : (k => k);
  const locale = (typeof window.getUiLang === 'function' ? window.getUiLang() : 'en') === 'fr' ? 'fr-FR' : 'en-GB';
  libTimelineList.innerHTML = '';
  if (!list.length) {
    libTimelineList.innerHTML = `<div class="lib-empty">${_t('tl.empty')}</div>`;
    return;
  }

  // Sort descending by date
  const sorted = [...list].sort((a, b) => (b.recorded_at || '').localeCompare(a.recorded_at || ''));

  // Group by calendar day
  const byDay = [];
  const dayMap = new Map();
  sorted.forEach(m => {
    const dt     = m.recorded_at ? new Date(m.recorded_at) : null;
    const dayKey = dt ? dt.toISOString().slice(0, 10) : 'unknown';
    if (!dayMap.has(dayKey)) {
      const entry = { date: dt, dayKey, meetings: [] };
      byDay.push(entry);
      dayMap.set(dayKey, entry);
    }
    dayMap.get(dayKey).meetings.push(m);
  });

  byDay.forEach(({ date, meetings: dayMeetings }) => {
    const dayEl  = document.createElement('div');
    dayEl.className = 'tl-day';
    const dateStr = date
      ? date.toLocaleDateString(locale, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })
      : _t('tl.date_unknown');

    // Group by service within the day
    const byService = [];
    const svcMap    = new Map();
    dayMeetings.forEach(m => {
      const svc = m.service || '';
      if (!svcMap.has(svc)) { const e = { service: svc, meetings: [] }; byService.push(e); svcMap.set(svc, e); }
      svcMap.get(svc).meetings.push(m);
    });

    let html = `<div class="tl-date-header">${escHtml(dateStr)}</div>`;

    byService.forEach(({ service: svcName, meetings: svcMeetings }) => {
      html += `<div class="tl-service-group">`;
      if (svcName) html += `<div class="tl-service-label">${escHtml(svcName)}</div>`;

      svcMeetings.forEach(m => {
        const dt2   = m.recorded_at ? new Date(m.recorded_at) : null;
        const time  = dt2 ? dt2.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : '';
        const dur   = m.duration_seconds ? formatDuration(m.duration_seconds) : '';
        const sel   = m.id === selectedMeetingId ? ' active' : '';
        const isDone = m.status === 'done';

        html += `
          <div class="tl-meeting-item${sel}" data-meeting-id="${m.id}">
            <div class="tl-meeting-aside">
              <span class="tl-time">${time}</span>
              <span class="tl-status ${isDone ? 'tl-done' : 'tl-rec'}">${isDone ? '✓' : '⏺'}</span>
            </div>
            <div class="tl-meeting-body">
              <div class="tl-meeting-title">${escHtml(m.title)}</div>
              ${dur ? `<div class="tl-meeting-meta">${dur}</div>` : ''}
            </div>
            <button class="tl-delete-btn" data-id="${m.id}" title="${_t('detail.delete_btn')}">&#10005;</button>
          </div>`;
      });

      html += '</div>'; // tl-service-group
    });

    dayEl.innerHTML = html;

    dayEl.querySelectorAll('.tl-meeting-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.tl-delete-btn')) return;
        selectMeeting(Number(item.dataset.meetingId));
      });
    });
    dayEl.querySelectorAll('.tl-delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); deleteMeeting(Number(btn.dataset.id)); });
    });

    libTimelineList.appendChild(dayEl);
  });
}

async function selectMeeting(id) {
  selectedMeetingId = id;
  renderTimeline(meetings); // refresh active state in timeline
  libAnalysisPane.classList.add('hidden');
  libMeetingDetail.classList.remove('hidden');
  // Cancel any in-flight analysis generation
  if (analysisAbortCtrl) { analysisAbortCtrl.abort(); analysisAbortCtrl = null; }
  try {
    const meeting = await window.electronAPI.db.getMeeting(id);
    if (meeting) renderMeetingDetail(meeting);
  } catch (e) {
    console.error('[lib] getMeeting', e);
  }
}

function renderMeetingDetail(m) {
  const _t    = typeof window.t === 'function' ? window.t : (k => k);
  const uiLang = typeof window.getUiLang === 'function' ? window.getUiLang() : 'en';
  const locale = uiLang === 'fr' ? 'fr-FR' : 'en-GB';

  libMeetingDetail.classList.remove('hidden');

  const date = m.recorded_at ? new Date(m.recorded_at).toLocaleDateString(locale, {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  }) : '';
  const dur = m.duration_seconds ? formatDuration(m.duration_seconds) : '';

  const COLORS = ['spk-color-0','spk-color-1','spk-color-2','spk-color-3','spk-color-4','spk-color-5'];
  const speakerNames = m.speaker_names || {};

  // ── Audio ──────────────────────────────────────────────────────────────────
  const audioHtml = m.audio_path
    ? `<audio controls src="file://${m.audio_path.replace(/\\/g, '/')}" class="detail-audio-player"></audio>`
    : `<span class="lib-empty detail-audio-unavail">${_t('detail.audio_unavail')}</span>`;

  // ── Pane: Summary ──────────────────────────────────────────────────────────
  const _sumText = m.summary?.summary_text || '';
  const _renderSummary = typeof formatRichSummary === 'function' ? formatRichSummary : escHtml;
  const pSummary = _sumText
    ? `<div class="summary-rich">${_renderSummary(_sumText)}</div>`
    : `<div class="lib-empty">${_t('detail.no_summary')}</div>`;

  // ── Pane: Key points ───────────────────────────────────────────────────────
  const kpList = m.key_points || [];
  const pKeypoints = kpList.length
    ? kpList.map(kp => `
        <div class="detail-kp-item">
          <span class="kp-dot">·</span>
          <span>${escHtml(kp)}</span>
        </div>`).join('')
    : `<div class="lib-empty">${_t('detail.no_keypoints')}</div>`;

  // ── Pane: Questions ────────────────────────────────────────────────────────
  const pQuestions = m.questions && m.questions.length
    ? m.questions.map((q, i) => `
        <div class="detail-qa-item">
          <div class="detail-q"><strong>Q${i + 1}.</strong> ${escHtml(q.text)}</div>
          ${q.answer ? `<div class="detail-a">${escHtml(q.answer)}</div>` : ''}
        </div>`).join('')
    : `<div class="lib-empty">${_t('detail.no_questions')}</div>`;

  // ── Pane: Discovery questions ──────────────────────────────────────────────
  const dqList = m.discovery_questions || [];
  const pDiscovery = dqList.length
    ? dqList.map((q, i) => `
        <div class="detail-discovery-item">
          <span class="discovery-index">${i + 1}</span>
          <span class="discovery-q-text">${escHtml(q)}</span>
        </div>`).join('')
    : `<div class="lib-empty">${_t('detail.no_discovery')}</div>`;

  // ── Pane: Actions ──────────────────────────────────────────────────────────
  const pActions = m.actions && m.actions.length
    ? m.actions.map(a => `
        <div class="detail-action-item ${a.status === 'done' ? 'action-done' : ''}">
          <input type="checkbox" class="action-checkbox" data-id="${a.id}" data-status="${a.status}"
            ${a.status === 'done' ? 'checked' : ''} />
          <span>${escHtml(a.text)}</span>
        </div>`).join('')
    : `<div class="lib-empty">${_t('detail.no_actions')}</div>`;

  // ── Pane: Transcript (grouped by speaker) ─────────────────────────────────
  let pTranscript = `<div class="lib-empty">${_t('detail.no_transcript')}</div>`;
  if (m.sentences && m.sentences.length) {
    const turns = [];
    let cur = null;
    for (const s of m.sentences) {
      const spk = s.speaker ?? null;
      if (!cur || cur.speaker !== spk) { cur = { speaker: spk, segs: [] }; turns.push(cur); }
      cur.segs.push(s.segment);
    }
    pTranscript = `<div class="detail-transcript-body">
      ${turns.map(turn => {
        const idx  = _spkIdx(turn.speaker);
        const name = _spkName(turn.speaker, speakerNames);
        const badge = name ? `<span class="speaker-badge ${COLORS[idx % COLORS.length] || ''}">${escHtml(name)}</span>` : '';
        return `<div class="speaker-turn">${badge}<div class="speaker-segment">${escHtml(turn.segs.join(' '))}</div></div>`;
      }).join('')}
    </div>`;
  }

  // ── Pane: Timed segments ───────────────────────────────────────────────────
  let pSegments = `<div class="lib-empty">${_t('detail.no_segments')}</div>`;
  if (m.sentences && m.sentences.length) {
    pSegments = `<div class="detail-segments-list">
      ${m.sentences.map(s => {
        const idx  = _spkIdx(s.speaker);
        const name = _spkName(s.speaker, speakerNames);
        const badge = name ? `<span class="speaker-badge speaker-badge-xs ${COLORS[idx % COLORS.length] || ''}">${escHtml(name)}</span>` : '';
        return `<div class="detail-seg-row">
          <span class="detail-seg-ts">${Number(s.start_time).toFixed(1)}s</span>
          ${badge}
          <span class="detail-seg-text">${escHtml(s.segment)}</span>
        </div>`;
      }).join('')}
    </div>`;
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  libMeetingDetail.innerHTML = `
    <div class="md-header">
      <div class="md-header-info">
        <div class="detail-title">${escHtml(m.title)}</div>
        <div class="detail-meta">${date}${dur ? ' · ' + dur : ''}</div>
        ${m.description ? `<div class="detail-desc">${escHtml(m.description)}</div>` : ''}
      </div>
      <div class="md-header-actions">
        <div class="md-export-row">
          <div class="export-btn-wrap">
            <button class="btn-export-pdf" data-id="${m.id}">↓ PDF</button>
            <span class="btn-help" data-tip="Export this meeting as a formatted PDF file (summary, action items, transcript)">?</span>
          </div>
          <div class="export-btn-wrap">
            <button class="btn-export-gdoc" data-id="${m.id}">↑ Doc</button>
            <span class="btn-help" data-tip="Export as Word (.docx) or Google Doc — format configurable in Settings">?</span>
          </div>
          <div class="export-btn-wrap">
            <button class="btn-export-csv">↓ CSV</button>
            <span class="btn-help" data-tip="Export transcript as spreadsheet (CSV) with speaker labels, timestamps and segments">?</span>
          </div>
          <div class="export-btn-wrap">
            <button class="btn-export-txt">↓ Transcript</button>
            <span class="btn-help" data-tip="Export raw transcript as plain text with speaker labels — useful for external processing">?</span>
          </div>
        </div>
        <div class="md-actions-delete-row">
          <button class="btn-delete-meeting btn-danger" data-id="${m.id}">${_t('detail.delete_btn')}</button>
        </div>
      </div>
    </div>

    <div class="md-audio">${audioHtml}</div>

    <div class="meeting-detail-tabs">
      <button class="meeting-detail-tab active" data-tab="summary">${_t('tab.summary')}</button>
      <button class="meeting-detail-tab" data-tab="keypoints">${_t('tab.keypoints')}</button>
      <button class="meeting-detail-tab" data-tab="questions">${_t('tab.questions')}</button>
      <button class="meeting-detail-tab" data-tab="discovery">${_t('tab.discovery')}</button>
      <button class="meeting-detail-tab" data-tab="actions">${_t('tab.actions')}</button>
      <button class="meeting-detail-tab" data-tab="email">${_t('tab.email')}</button>
      <button class="meeting-detail-tab" data-tab="transcript">${_t('tab.transcript')}</button>
      <button class="meeting-detail-tab" data-tab="segments">${_t('tab.segments')}</button>
    </div>

    <div class="meeting-detail-pane" data-pane="summary">${pSummary}</div>
    <div class="meeting-detail-pane hidden"  data-pane="keypoints">${pKeypoints}</div>
    <div class="meeting-detail-pane hidden"  data-pane="questions">${pQuestions}</div>
    <div class="meeting-detail-pane hidden"  data-pane="discovery">${pDiscovery}</div>
    <div class="meeting-detail-pane hidden"  data-pane="actions">${pActions}</div>
    <div class="meeting-detail-pane hidden"  data-pane="email" id="email-pane-${m.id}"></div>
    <div class="meeting-detail-pane hidden"  data-pane="transcript">${pTranscript}</div>
    <div class="meeting-detail-pane hidden"  data-pane="segments">${pSegments}</div>
  `;

  // Tab switching
  libMeetingDetail.querySelectorAll('.meeting-detail-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      libMeetingDetail.querySelectorAll('.meeting-detail-tab').forEach(t =>
        t.classList.toggle('active', t === tab));
      libMeetingDetail.querySelectorAll('.meeting-detail-pane').forEach(p =>
        p.classList.toggle('hidden', p.dataset.pane !== target));
      // Lazy-init email pane on first open
      if (target === 'email') initEmailPane(m);
    });
  });

  // Action checkboxes
  libMeetingDetail.querySelectorAll('.action-checkbox').forEach(cb => {
    cb.addEventListener('change', async (e) => {
      const actionId  = Number(e.target.dataset.id);
      const newStatus = e.target.checked ? 'done' : 'todo';
      try {
        await window.electronAPI.db.toggleAction(actionId, newStatus);
        e.target.dataset.status = newStatus;
        const item = e.target.closest('.detail-action-item');
        item.classList.toggle('action-done', newStatus === 'done');
      } catch (err) { console.error('[lib] toggleAction', err); }
    });
  });

  // Export PDF
  const pdfBtn = libMeetingDetail.querySelector('.btn-export-pdf');
  if (pdfBtn) pdfBtn.addEventListener('click', () => exportMeetingAsPdf(m));

  // Export Document (format from settings)
  const gdocBtn = libMeetingDetail.querySelector('.btn-export-gdoc');
  if (gdocBtn) gdocBtn.addEventListener('click', () => exportMeetingAsDocument(m));

  // Export CSV transcript
  const csvBtn = libMeetingDetail.querySelector('.btn-export-csv');
  if (csvBtn) csvBtn.addEventListener('click', () => {
    const slug = (m.title || 'transcript').replace(/[^a-z0-9]+/gi, '_').slice(0, 40);
    window.electronAPI.saveFile({
      defaultName: `${slug}.csv`,
      content:     buildMeetingCSV(m),
      filters:     [{ name: 'CSV', extensions: ['csv'] }],
    });
  });

  // Export plain-text transcript with speaker labels
  const txtBtn = libMeetingDetail.querySelector('.btn-export-txt');
  if (txtBtn) txtBtn.addEventListener('click', () => {
    const slug = (m.title || 'transcript').replace(/[^a-z0-9]+/gi, '_').slice(0, 40);
    window.electronAPI.saveFile({
      defaultName: `${slug}.txt`,
      content:     buildMeetingTXT(m),
      filters:     [{ name: 'Text', extensions: ['txt'] }],
    });
  });

  // Delete button
  const delBtn = libMeetingDetail.querySelector('.btn-delete-meeting');
  if (delBtn) delBtn.addEventListener('click', () => deleteMeeting(m.id));
}

async function deleteMeeting(id) {
  const _t = typeof window.t === 'function' ? window.t : (k => k);
  if (!confirm(_t('confirm.delete_meeting'))) return;
  try {
    await window.electronAPI.db.deleteMeeting(id);
    selectedMeetingId = null;
    libMeetingDetail.classList.add('hidden');
    if (selectedCompanyId !== null) await loadTimeline(selectedCompanyId);
  } catch (e) {
    console.error('[lib] deleteMeeting', e);
  }
}

async function confirmDeleteCompany(id, name) {
  const _t = typeof window.t === 'function' ? window.t : (k => k);
  if (!confirm(_t('confirm.delete_company').replace('{name}', name))) return;
  try {
    await window.electronAPI.db.deleteCompany(id);
    if (selectedCompanyId === id) {
      selectedCompanyId = null;
      selectedMeetingId = null;
      libTimelinePane.classList.add('hidden');
      libMeetingDetail.classList.add('hidden');
      libEmptyHint.classList.remove('hidden');
    }
    await loadCompanies();
  } catch (e) {
    console.error('[lib] deleteCompany', e);
  }
}

// ─── Meeting setup modal ──────────────────────────────────────────────────────
async function openMeetingSetup() {
  meetingSetupModal.classList.remove('hidden');
  modalTitle.value        = '';
  modalService.value      = '';
  modalDesc.value         = '';
  modalNumSpeakers.value  = '2';
  modalNewCompanyName.value = '';
  modalNewCompanyForm.classList.add('hidden');
  await populateCompanySelect();
}

function closeMeetingSetup() {
  meetingSetupModal.classList.add('hidden');
}

async function populateCompanySelect() {
  const _t = typeof window.t === 'function' ? window.t : (k => k);
  try { companies = await window.electronAPI.db.getCompanies(); }
  catch(e) { companies = []; }

  if (companies.length === 0) {
    modalCompanySelect.innerHTML = `<option value="">—</option>`;
    modalNewCompanyForm.classList.remove('hidden');
    document.getElementById('modal-btn-new-company').textContent = '− Cancel';
    setTimeout(() => modalNewCompanyName.focus(), 80);
  } else {
    modalCompanySelect.innerHTML = companies.map(c =>
      `<option value="${c.id}">${escHtml(c.name)}</option>`).join('');
    modalNewCompanyForm.classList.add('hidden');
    document.getElementById('modal-btn-new-company').textContent = _t('modal.btn_new_company');
  }
}

async function confirmNewMeeting() {
  let companyId = Number(modalCompanySelect.value);
  const companyNameField = modalNewCompanyName.value.trim();

  // Create a new company if the inline form is visible
  if (!modalNewCompanyForm.classList.contains('hidden') && companyNameField) {
    try {
      const result = await window.electronAPI.db.createCompany(companyNameField, '', '#ff7c00');
      companyId = result.id;
    } catch (e) {
      console.error('[lib] createCompany', e);
      return;
    }
  }

  const title = modalTitle.value.trim();
  if (!title) { modalTitle.focus(); return; }
  if (!companyId) { alert(typeof window.t === 'function' ? window.t('modal.company_label') + ' ?' : 'Please select or create a company.'); return; }

  const desc        = modalDesc.value.trim();
  const service     = modalService.value.trim();
  const numSpeakers = parseInt(modalNumSpeakers.value, 10) || 2;
  try {
    const result = await window.electronAPI.db.createMeeting(companyId, title, desc, service);
    const meetingId = result.id;

    // Find the company name
    let companyName = companyNameField || '';
    if (!companyName) {
      const found = companies.find(c => c.id === companyId);
      companyName = found ? found.name : String(companyId);
    }

    // Pass context to app.js
    if (typeof window._appSetCurrentMeeting === 'function') {
      window._appSetCurrentMeeting(meetingId, companyName, title, numSpeakers);
    }

    closeMeetingSetup();

    // Start recording automatically
    if (typeof window._appStartRecording === 'function') {
      window._appStartRecording();
    }
  } catch (e) {
    console.error('[lib] createMeeting', e);
  }
}

// ─── New meeting from library ──────────────────────────────────────────────────
function openNewMeetingFromLib() {
  closeLibrary();
  openMeetingSetup();
  // Pre-select the current company if applicable
  if (selectedCompanyId !== null) {
    // Will be applied after populateCompanySelect in openMeetingSetup
    const origPopulate = populateCompanySelect;
    openMeetingSetup().then(() => {
      if (selectedCompanyId) {
        const opt = modalCompanySelect.querySelector(`option[value="${selectedCompanyId}"]`);
        if (opt) modalCompanySelect.value = selectedCompanyId;
      }
    });
  }
}

// ─── Add company from library ─────────────────────────────────────────────────
async function createCompanyFromLib() {
  const _t = typeof window.t === 'function' ? window.t : (k => k);
  const name = prompt(_t('confirm.new_company'));
  if (!name || !name.trim()) return;
  try {
    await window.electronAPI.db.createCompany(name.trim(), '', '#ff7c00');
    await loadCompanies();
  } catch (e) {
    console.error('[lib] createCompany', e);
  }
}

// ─── Export helpers ───────────────────────────────────────────────────────────
function buildMeetingHtml(m) {
  const uiLang = typeof window.getUiLang === 'function' ? window.getUiLang() : 'en';
  const locale  = uiLang === 'fr' ? 'fr-FR' : 'en-GB';
  const esc     = str => String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');

  const company = companies.find(c => c.id === m.company_id);
  const companyName = company ? company.name : '';

  const date = m.recorded_at
    ? new Date(m.recorded_at).toLocaleDateString(locale, { weekday:'long', day:'2-digit', month:'long', year:'numeric', hour:'2-digit', minute:'2-digit' })
    : '';
  const dur = m.duration_seconds ? formatDuration(m.duration_seconds) : '';
  const speakerNames = m.speaker_names || {};

  // ── Summary ──────────────────────────────────────────────────────────────────
  let summaryHtml = '';
  if (m.summary?.summary_text) {
    const _expRender = typeof formatRichSummary === 'function' ? formatRichSummary : t => `<p>${esc(t)}</p>`;
    summaryHtml = `<div class="section">
      <h2>Summary</h2>
      <div class="summary-rich export-summary">${_expRender(m.summary.summary_text)}</div>
    </div>`;
  }

  // ── Key points ────────────────────────────────────────────────────────────────
  let kpHtml = '';
  if (m.key_points && m.key_points.length) {
    kpHtml = `<div class="section">
      <h2>Key Points</h2>
      <ul>${m.key_points.map(kp => `<li>${esc(kp)}</li>`).join('')}</ul>
    </div>`;
  }

  // ── Questions ─────────────────────────────────────────────────────────────────
  let qHtml = '';
  if (m.questions && m.questions.length) {
    qHtml = `<div class="section">
      <h2>Questions</h2>
      ${m.questions.map((q, i) => `
        <div class="q-item">
          <div class="q-text">Q${i + 1}. ${esc(q.text)}</div>
          ${q.answer ? `<div class="q-answer">${esc(q.answer)}</div>` : ''}
        </div>`).join('')}
    </div>`;
  }

  // ── Discovery questions ───────────────────────────────────────────────────────
  let discoveryHtml = '';
  if (m.discovery_questions && m.discovery_questions.length) {
    discoveryHtml = `<div class="section">
      <h2>Discovery — Questions pour le prochain échange</h2>
      <ol>${m.discovery_questions.map(q => `<li>${esc(q)}</li>`).join('')}</ol>
    </div>`;
  }

  // ── Actions ───────────────────────────────────────────────────────────────────
  let actHtml = '';
  if (m.actions && m.actions.length) {
    actHtml = `<div class="section">
      <h2>Actions</h2>
      ${m.actions.map(a => `
        <div class="action-item ${a.status === 'done' ? 'action-done' : ''}">
          <span class="action-check">${a.status === 'done' ? '☑' : '☐'}</span>
          <span>${esc(a.text)}</span>
        </div>`).join('')}
    </div>`;
  }

  // ── Transcript ────────────────────────────────────────────────────────────────
  let transcriptHtml = '';
  if (m.sentences && m.sentences.length) {
    const turns = [];
    let cur = null;
    for (const s of m.sentences) {
      const spk = s.speaker ?? null;
      if (!cur || cur.speaker !== spk) { cur = { speaker: spk, segs: [] }; turns.push(cur); }
      cur.segs.push(s.segment);
    }
    const COLORS = ['#e05c00','#0070c0','#107c10','#8764b8','#c4314b','#038387'];
    transcriptHtml = `<div class="section">
      <h2>Transcript</h2>
      ${turns.map(turn => {
        const idx  = typeof turn.speaker === 'number' ? turn.speaker : -1;
        const name = speakerNames[turn.speaker] || (idx >= 0 ? `Speaker ${idx + 1}` : null);
        const color = COLORS[idx % COLORS.length] || '#555';
        return `<div class="speaker-turn">
          ${name ? `<div class="speaker-name ${color}">${esc(name)}</div>` : ''}
          <div class="speaker-text">${esc(turn.segs.join(' '))}</div>
        </div>`;
      }).join('')}
    </div>`;
  }

  const css = `
    body { font-family: Arial, Helvetica, sans-serif; color: #222; max-width: 820px; margin: 0 auto; padding: 40px 32px; font-size: 14px; line-height: 1.55; }
    h1 { font-size: 22px; color: #111; border-bottom: 2px solid #e05c00; padding-bottom: 8px; margin-bottom: 4px; }
    h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.6px; color: #555; margin: 24px 0 8px; }
    h3 { font-size: 13px; color: #444; margin: 12px 0 6px; }
    .meta { color: #777; font-size: 13px; margin-bottom: 28px; }
    .section { margin-bottom: 28px; border-top: 1px solid #e8e8e8; padding-top: 16px; }
    ul { margin: 0; padding-left: 20px; }
    ul li { padding: 3px 0; }
    .summary-text { color: #333; }
    .q-item { padding: 8px 0; border-bottom: 1px solid #f0f0f0; }
    .q-item:last-child { border-bottom: none; }
    .q-text { font-weight: 600; }
    .q-answer { color: #555; margin-top: 4px; margin-left: 16px; }
    .action-item { display: flex; gap: 8px; align-items: baseline; padding: 4px 0; }
    .action-check { flex-shrink: 0; font-size: 16px; }
    .action-done span:last-child { text-decoration: line-through; color: #aaa; }
    .speaker-turn { margin-bottom: 14px; }
    .speaker-name { font-size: 12px; font-weight: 700; margin-bottom: 3px; }
    .speaker-text { color: #333; }
    @media print { body { padding: 20px; } }
  `;

  const safeName = esc(m.title || 'meeting');

  return `<!DOCTYPE html>
<html lang="${uiLang}">
<head>
  <meta charset="UTF-8">
  <title>${safeName}</title>
  <style>${css}</style>
</head>
<body>
  <h1>${safeName}</h1>
  <div class="meta">${companyName ? esc(companyName) + ' · ' : ''}${date}${dur ? ' · ' + dur : ''}</div>
  ${summaryHtml}${kpHtml}${qHtml}${discoveryHtml}${actHtml}${transcriptHtml}
</body>
</html>`;
}

async function exportMeetingAsPdf(m) {
  const safeName = (m.title || 'meeting').replace(/[<>:"/\\|?*]/g, '-');
  const html = buildMeetingHtml(m);
  const result = await window.electronAPI.export.pdf(html, `${safeName}.pdf`);
  if (result && result.success) console.log('[lib] PDF saved:', result.filePath);
}

async function exportMeetingAsDocument(m) {
  const safeName = (m.title || 'meeting').replace(/[<>:"/\\|?*]/g, '-');
  const format = typeof window.getExportFormat === 'function' ? window.getExportFormat() : 'docx';
  const result = await window.electronAPI.export.document(format, m, safeName);
  if (result && result.success) console.log('[lib] Document saved:', result.filePath);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatDuration(sec) {
  sec = Math.round(sec);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${String(s).padStart(2,'0')}s` : `${s}s`;
}

// ─── Email recap ──────────────────────────────────────────────────────────────

const EMAIL_SYSTEM_PROMPT = `Tu es un assistant expert en rédaction de comptes rendus professionnels.
Tu reçois une transcription audio (avec ou sans diarisation des locuteurs).
Tu dois produire un email de compte rendu clair, professionnel et actionnable.
Réponds UNIQUEMENT avec l'email, sans commentaire ni explication autour.`;

function buildEmailUserPrompt(m) {
  const uiLang  = typeof window.getUiLang === 'function' ? window.getUiLang() : 'en';
  const locale  = uiLang === 'fr' ? 'fr-FR' : 'en-GB';
  const date    = m.recorded_at
    ? new Date(m.recorded_at).toLocaleDateString(locale, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '';
  const dur = m.duration_seconds ? formatDuration(m.duration_seconds) : '';

  const speakerNames = m.speaker_names || {};
  const speakerList  = Object.values(speakerNames).filter(Boolean);
  const speakersStr  = speakerList.length ? speakerList.join(', ') : 'Non identifiés';

  // Build transcription with speaker labels
  let transcription = '';
  if (m.sentences && m.sentences.length) {
    const turns = [];
    let cur = null;
    for (const s of m.sentences) {
      const spk = s.speaker ?? null;
      if (!cur || cur.speaker !== spk) { cur = { speaker: spk, segs: [] }; turns.push(cur); }
      cur.segs.push(s.segment);
    }
    transcription = turns.map(turn => {
      const idx  = typeof turn.speaker === 'number' ? turn.speaker : -1;
      const name = speakerNames[turn.speaker] || (idx >= 0 ? `Speaker ${idx + 1}` : 'Participant');
      return `${name}: ${turn.segs.join(' ')}`;
    }).join('\n\n');
  } else {
    transcription = 'Transcription non disponible.';
  }

  return `Voici la transcription de la réunion/conversation :

<transcription>
${transcription}
</transcription>

Métadonnées :
- Date : ${date}
- Durée : ${dur}
- Participants identifiés : ${speakersStr}

Génère un email de compte rendu professionnel en français avec la structure suivante :

**Objet :** [Génère un objet d'email pertinent et concis]

---

Bonjour [prénom(s)],

**Résumé de la réunion**
[2-3 phrases résumant l'essentiel de la discussion, le contexte et l'objectif atteint ou non]

**Points clés abordés**
- [Point clé 1]
- [Point clé 2]
- [Point clé 3]
(autant que nécessaire)

**Décisions prises**
- [Décision 1]
- [Décision 2]
(si aucune, indiquer "Aucune décision formelle prise lors de cet échange.")

**Actions à réaliser**
| Action | Responsable | Échéance |
|--------|------------|----------|
| [action 1] | [personne] | [date ou "À définir"] |
| [action 2] | [personne] | [date ou "À définir"] |

**Questions ouvertes / Points en suspens**
- [Question ou point non résolu 1]
- [Question ou point non résolu 2]
(si aucune, supprimer cette section)

**Prochaines étapes**
[Description concise des prochaines étapes prévues, avec si possible une date de prochaine réunion ou jalon]

---
Cordialement,
[Signature automatique]

---
INSTRUCTIONS IMPORTANTES :
- Adopte un ton professionnel mais direct
- Sois factuel : ne déduis que ce qui est clairement exprimé dans la transcription
- Si un locuteur n'est pas identifié, utilise "Participant" ou le numéro de speaker (Speaker 1, Speaker 2...)
- Si la transcription est incomplète ou peu claire sur un point, indique "[À confirmer]" plutôt qu'inventer
- Longueur cible : email dense mais lisible, maximum 400 mots hors tableau`;
}

function renderEmailText(text) {
  const lines = text.split('\n');
  let html = '';
  let inTable = false;
  let tableRowCount = 0;
  let inList  = false;

  const closeTable = () => {
    if (inTable) { html += '</table>'; inTable = false; tableRowCount = 0; }
  };
  const closeList = () => {
    if (inList) { html += '</ul>'; inList = false; }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    // Blank line — close open structures, add spacing
    if (!line) {
      closeTable();
      closeList();
      html += '<div class="email-gap"></div>';
      continue;
    }

    // Horizontal rule
    if (line === '---') {
      closeTable();
      closeList();
      html += '<hr class="email-hr">';
      continue;
    }

    // Table row (starts with |)
    if (line.startsWith('|')) {
      closeList();
      // Skip separator rows (|---|---|)
      if (line.match(/^\|[-| :]+\|$/)) continue;
      const cells = line.split('|').slice(1, -1).map(c => c.trim());
      if (!inTable) {
        html += '<table class="email-table">';
        inTable = true;
        tableRowCount = 0;
      }
      const tag = tableRowCount === 0 ? 'th' : 'td';
      html += `<tr>${cells.map(c => `<${tag}>${inlineMd(c)}</${tag}>`).join('')}</tr>`;
      tableRowCount++;
      continue;
    }

    closeTable();

    // Bullet list item
    if (line.match(/^[ \t]*[-*] /)) {
      const content = line.replace(/^[ \t]*[-*] /, '');
      if (!inList) { html += '<ul class="email-list">'; inList = true; }
      html += `<li>${inlineMd(content)}</li>`;
      continue;
    }

    closeList();

    // Regular line → paragraph
    html += `<p>${inlineMd(line)}</p>`;
  }

  closeTable();
  closeList();
  return html;
}

function inlineMd(text) {
  let s = escHtml(text);
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*(.+?)\*/g,     '<em>$1</em>');
  return s;
}

let emailAbortCtrl = null;

function initEmailPane(m) {
  const _t  = typeof window.t === 'function' ? window.t : (k => k);
  const pane = document.getElementById(`email-pane-${m.id}`);
  if (!pane || pane.dataset.initialized) return;
  pane.dataset.initialized = '1';

  if (m.email_recap?.text) {
    renderEmailPane(pane, m.id, m.email_recap.text, m.email_recap.generated_at);
  } else {
    pane.innerHTML = `
      <div class="email-empty">
        <p>${_t('detail.email_generate_hint') || 'Aucun email généré pour cette réunion.'}</p>
        <button class="btn-primary email-generate-btn">${_t('detail.email_generate')}</button>
      </div>`;
    pane.querySelector('.email-generate-btn').addEventListener('click', () => generateEmailRecap(pane, m));
  }
}

function renderEmailPane(pane, meetingId, text, generatedAt) {
  const _t  = typeof window.t === 'function' ? window.t : (k => k);
  const date = generatedAt ? new Date(generatedAt).toLocaleString() : '';
  pane.innerHTML = `
    <div class="email-pane-header">
      ${date ? `<span class="email-date">${escHtml(date)}</span>` : ''}
      <div class="email-pane-actions">
        <button class="btn-sm email-copy-btn">${_t('detail.email_copy')}</button>
        <button class="btn-sm email-regen-btn">${_t('detail.email_regen')}</button>
      </div>
    </div>
    <div class="email-body" id="email-body-${meetingId}">${renderEmailText(text)}</div>`;

  pane.querySelector('.email-copy-btn').addEventListener('click', async (e) => {
    await navigator.clipboard.writeText(text).catch(() => {});
    const btn = e.currentTarget;
    btn.textContent = _t('detail.email_copied');
    setTimeout(() => { btn.textContent = _t('detail.email_copy'); }, 1800);
  });

  pane.querySelector('.email-regen-btn').addEventListener('click', () => {
    // Re-fetch full meeting to get latest data
    window.electronAPI.db.getMeeting(meetingId).then(full => {
      if (full) generateEmailRecap(pane, full);
    });
  });
}

async function generateEmailRecap(pane, m) {
  if (emailAbortCtrl) emailAbortCtrl.abort();
  emailAbortCtrl = new AbortController();
  const signal = emailAbortCtrl.signal;
  const lang   = getAnalysisLang();

  pane.innerHTML = `
    <div class="analysis-loading">
      <div class="analysis-spinner">⟳</div>
      <span>${lang === 'fr' ? 'Génération de l\'email…' : 'Generating email…'}</span>
    </div>`;

  const baseUrl = getLmStudioUrl();

  try {
    let lmAvailable = false;
    try {
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 2000);
      const check = await fetch(`${baseUrl}/models`, { signal: ctrl.signal });
      lmAvailable = check.ok;
    } catch (_) {}

    if (!lmAvailable) {
      pane.innerHTML = `<div class="analysis-error">⚠ ${lang === 'fr' ? 'LMStudio inaccessible.' : 'LMStudio unavailable.'}</div>`;
      return;
    }
    if (signal.aborted) return;

    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: EMAIL_SYSTEM_PROMPT },
          { role: 'user',   content: buildEmailUserPrompt(m) },
        ],
        stream: true,
        temperature: 0.3,
        max_tokens: 2048,
      }),
      signal,
    });

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    // Streaming display
    pane.innerHTML = `<div class="email-body" id="email-body-stream"></div>`;
    const bodyEl = pane.querySelector('#email-body-stream');

    let fullText = '';
    let renderTimer = null;
    const flush = () => { bodyEl.innerHTML = renderEmailText(fullText); };

    await libStreamSSE(resp, signal, chunk => {
      fullText += chunk;
      clearTimeout(renderTimer);
      renderTimer = setTimeout(flush, 60);
    });

    clearTimeout(renderTimer);
    flush();
    if (signal.aborted) return;

    // Save to DB
    await window.electronAPI.db.saveEmailRecap(m.id, fullText);

    // Re-render with header + copy/regen
    renderEmailPane(pane, m.id, fullText, new Date().toISOString());

  } catch (err) {
    if (err.name === 'AbortError') return;
    pane.innerHTML = `<div class="analysis-error">⚠ ${escHtml(String(err.message || err))}</div>`;
  }
}

// ─── Analysis helpers ──────────────────────────────────────────────────────────
const getLmStudioUrl  = () => (document.getElementById('lmstudio-url')?.value || '').trim() || 'http://localhost:1234/v1';
const getAnalysisLang = () => localStorage.getItem('parakeet-analysis-lang') || 'en';

function formatAnalysisHtml(text) {
  const lines = text.split('\n');
  let html = '';
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line) { html += '<br>'; continue; }
    // Section heading
    const hm = line.match(/^##\s+(.+)$/);
    if (hm) { html += `<h3 class="analysis-section-title">${escHtml(hm[1])}</h3>`; continue; }
    // Done badge [✓] or ✓
    const dm = line.match(/^\[✓\]\s*(.*)$/) || line.match(/^✓\s+(.+)$/);
    if (dm) { html += `<p><span class="badge-done">✓</span> ${escHtml(dm[1])}</p>`; continue; }
    // Pending badge [ ] or ☐
    const pm = line.match(/^\[ \]\s*(.*)$/) || line.match(/^☐\s+(.+)$/);
    if (pm) { html += `<p><span class="badge-pending">☐</span> ${escHtml(pm[1])}</p>`; continue; }
    // Warning ⚠
    const wm = line.match(/^⚠\s*(.+)$/);
    if (wm) { html += `<p><span class="badge-warn">⚠</span> ${escHtml(wm[1])}</p>`; continue; }
    // Default paragraph
    html += `<p>${escHtml(line)}</p>`;
  }
  return html;
}

function buildAnalysisPrompt(companyName, fullMeetings, lang) {
  // Sort meetings chronologically (oldest first)
  const sorted = [...fullMeetings].sort((a, b) =>
    (a.recorded_at || '').localeCompare(b.recorded_at || ''));

  // Group by service
  const byService = new Map();
  for (const m of sorted) {
    const svc = m.service || '—';
    if (!byService.has(svc)) byService.set(svc, []);
    byService.get(svc).push(m);
  }

  let userContent = `Company: ${companyName}\n\n`;
  for (const [svc, svcMeetings] of byService) {
    userContent += `### Team / Service: ${svc}\n\n`;
    for (const m of svcMeetings) {
      const date = m.recorded_at ? new Date(m.recorded_at).toLocaleDateString() : '?';
      userContent += `Meeting: "${m.title}" — ${date}\n`;
      if (m.summary?.summary_text) userContent += `Summary: ${m.summary.summary_text}\n`;
      if (m.key_points?.length) {
        userContent += `Key points:\n${m.key_points.map(k => `  - ${k}`).join('\n')}\n`;
      }
      if (m.actions?.length) {
        userContent += `Actions:\n${m.actions.map(a =>
          `  ${a.status === 'done' ? '[✓]' : '[ ]'} ${a.text}`).join('\n')}\n`;
      }
      if (m.questions?.length) {
        userContent += `Questions & answers:\n${m.questions.map((q, i) =>
          `  Q${i+1}: ${q.text}${q.answer ? `\n    A: ${q.answer}` : ''}`).join('\n')}\n`;
      }
      userContent += '\n';
    }
  }

  const systemFr = `Tu es un expert CRM et suivi relation client/prospect.
Analyse l'historique et produis un rapport avec EXACTEMENT ces sections :

## Synthèse globale
## Évolution du suivi
## Actions réalisées ✓
## Actions en attente ⏳
## Points de vigilance ⚠
## Recommandations & prochaines étapes

Sois précis, concret, actionnable. Appuie-toi uniquement sur les données fournies.`;

  const systemEn = `You are a CRM and client/prospect relationship expert.
Analyze the history and produce a report with EXACTLY these sections:

## Global summary
## Relationship progression
## Completed actions ✓
## Pending actions ⏳
## Watch points ⚠
## Recommendations & next steps

Be precise, concrete, actionable. Base yourself only on the provided data.`;

  return {
    system: lang === 'fr' ? systemFr : systemEn,
    user: userContent,
  };
}

async function libStreamSSE(resp, signal, onToken) {
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    if (signal?.aborted) break;
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') return;
      try {
        const parsed = JSON.parse(data);
        const chunk = parsed.choices?.[0]?.delta?.content;
        if (chunk) onToken(chunk);
      } catch (_) {}
    }
  }
}

async function runAnalysisLLM(companyId, companyName) {
  // Cancel any previous generation
  if (analysisAbortCtrl) { analysisAbortCtrl.abort(); }
  analysisAbortCtrl = new AbortController();
  const signal = analysisAbortCtrl.signal;

  // Show spinner
  libAnalysisPane.innerHTML = `
    <div class="analysis-header">
      <span class="analysis-title">${escHtml(companyName)}</span>
    </div>
    <div class="analysis-loading">
      <div class="analysis-spinner">⟳</div>
      <span>${getAnalysisLang() === 'fr' ? 'Analyse en cours…' : 'Generating analysis…'}</span>
    </div>`;

  try {
    // Fetch all full meetings for this company
    const meetingHeaders = meetings; // already loaded
    const fullMeetings = await Promise.all(
      meetingHeaders.map(m => window.electronAPI.db.getMeeting(m.id))
    );
    const validMeetings = fullMeetings.filter(Boolean);

    if (signal.aborted) return;

    const lang = getAnalysisLang();
    const { system, user } = buildAnalysisPrompt(companyName, validMeetings, lang);
    const baseUrl = getLmStudioUrl();

    // Check LMStudio availability
    let lmAvailable = false;
    try {
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 2000);
      const check = await fetch(`${baseUrl}/models`, { signal: ctrl.signal });
      lmAvailable = check.ok;
    } catch (_) {}

    if (!lmAvailable) {
      libAnalysisPane.innerHTML = `
        <div class="analysis-header">
          <span class="analysis-title">${escHtml(companyName)}</span>
        </div>
        <div class="analysis-error">${lang === 'fr'
          ? '⚠ LMStudio inaccessible. Vérifiez que le serveur est démarré sur ' + escHtml(baseUrl)
          : '⚠ LMStudio unavailable. Make sure the server is running at ' + escHtml(baseUrl)}</div>`;
      return;
    }

    if (signal.aborted) return;

    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: system },
          { role: 'user',   content: user },
        ],
        stream: true,
        temperature: 0.3,
        max_tokens: 1500,
      }),
      signal,
    });

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    // Show streaming body
    libAnalysisPane.innerHTML = `
      <div class="analysis-header">
        <span class="analysis-title">${escHtml(companyName)}</span>
      </div>
      <div class="analysis-body" id="analysis-body-content"></div>`;
    const bodyEl = libAnalysisPane.querySelector('#analysis-body-content');

    let fullText = '';
    let renderTimer = null;

    const flush = () => {
      bodyEl.innerHTML = formatAnalysisHtml(fullText);
      bodyEl.scrollTop = bodyEl.scrollHeight;
    };

    await libStreamSSE(resp, signal, (chunk) => {
      fullText += chunk;
      clearTimeout(renderTimer);
      renderTimer = setTimeout(flush, 60);
    });

    clearTimeout(renderTimer);
    flush();

    if (signal.aborted) return;

    // Save to DB
    await window.electronAPI.db.saveCompanyAnalysis(companyId, fullText);

    // Add header with date + Regenerate button
    const now = new Date().toLocaleString();
    libAnalysisPane.innerHTML = `
      <div class="analysis-header">
        <span class="analysis-title">${escHtml(companyName)}</span>
        <div class="analysis-header-right">
          <span class="analysis-date">${escHtml(now)}</span>
          <button class="btn-sm" id="btn-regen-analysis">${lang === 'fr' ? '⟳ Régénérer' : '⟳ Regenerate'}</button>
        </div>
      </div>
      <div class="analysis-body">${formatAnalysisHtml(fullText)}</div>`;
    libAnalysisPane.querySelector('#btn-regen-analysis')?.addEventListener('click', () => {
      runAnalysisLLM(selectedCompanyId, companyName);
    });

  } catch (err) {
    if (err.name === 'AbortError') return; // silently cancelled
    const lang = getAnalysisLang();
    libAnalysisPane.innerHTML = `
      <div class="analysis-header">
        <span class="analysis-title">${escHtml(companyName)}</span>
      </div>
      <div class="analysis-error">⚠ ${escHtml(String(err.message || err))}</div>`;
  }
}

async function showAnalysisPane(companyId, companyName) {
  libMeetingDetail.classList.add('hidden');
  libEmptyHint.classList.add('hidden');
  libAnalysisPane.classList.remove('hidden');

  const lang = getAnalysisLang();

  // Check for cached analysis
  let cached = null;
  try { cached = await window.electronAPI.db.getCompanyAnalysis(companyId); } catch (_) {}

  if (cached?.text) {
    const date = cached.generated_at ? new Date(cached.generated_at).toLocaleString() : '';
    libAnalysisPane.innerHTML = `
      <div class="analysis-header">
        <span class="analysis-title">${escHtml(companyName)}</span>
        <div class="analysis-header-right">
          ${date ? `<span class="analysis-date">${escHtml(date)}</span>` : ''}
          <button class="btn-sm" id="btn-regen-analysis">${lang === 'fr' ? '⟳ Régénérer' : '⟳ Regenerate'}</button>
        </div>
      </div>
      <div class="analysis-body">${formatAnalysisHtml(cached.text)}</div>`;
    libAnalysisPane.querySelector('#btn-regen-analysis')?.addEventListener('click', () => {
      runAnalysisLLM(companyId, companyName);
    });
  } else {
    // No cache — generate immediately
    await runAnalysisLLM(companyId, companyName);
  }
}

// ─── Events ───────────────────────────────────────────────────────────────────
document.getElementById('btn-close-library').addEventListener('click', closeLibrary);
document.getElementById('btn-new-company').addEventListener('click', createCompanyFromLib);
document.getElementById('btn-new-meeting-from-lib').addEventListener('click', () => {
  closeLibrary();
  openMeetingSetup();
});

btnAnalysis.addEventListener('click', () => {
  if (selectedCompanyId === null) return;
  const company = companies.find(c => c.id === selectedCompanyId);
  showAnalysisPane(selectedCompanyId, company?.name || String(selectedCompanyId));
});

document.getElementById('modal-btn-cancel').addEventListener('click', closeMeetingSetup);
document.getElementById('modal-btn-confirm').addEventListener('click', confirmNewMeeting);

document.getElementById('modal-btn-new-company').addEventListener('click', () => {
  const hidden = modalNewCompanyForm.classList.contains('hidden');
  if (hidden) {
    modalNewCompanyForm.classList.remove('hidden');
    document.getElementById('modal-btn-new-company').textContent = '- Cancel';
  } else {
    modalNewCompanyForm.classList.add('hidden');
    document.getElementById('modal-btn-new-company').textContent = '+ New';
    modalNewCompanyName.value = '';
  }
});

// Close modal on backdrop click
document.querySelector('#meeting-setup-modal .modal-backdrop').addEventListener('click', closeMeetingSetup);

// Re-render when UI language changes
document.addEventListener('i18n:changed', () => {
  renderCompanies();
  if (selectedCompanyId !== null) {
    renderTimeline(meetings);
    if (selectedMeetingId !== null) {
      const m = meetings.find(x => x.id === selectedMeetingId);
      if (m) {
        // Re-fetch full data to re-render detail with new language
        window.electronAPI.db.getMeeting(selectedMeetingId)
          .then(full => { if (full) renderMeetingDetail(full); })
          .catch(() => {});
      }
    }
  }
});

// Expose for app.js
window._libOpenMeetingSetup = openMeetingSetup;
window._libToggle = () => { if (libOpen) closeLibrary(); else openLibrary(); };
