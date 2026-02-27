'use strict';

// ─── Library state ────────────────────────────────────────────────────────────
let libOpen            = false;
let companies          = [];
let selectedCompanyId  = null;
let meetings           = [];
let selectedMeetingId  = null;

// ─── DOM elements ─────────────────────────────────────────────────────────────
const libraryPanel        = document.getElementById('library-panel');
const libCompaniesList    = document.getElementById('lib-companies-list');
const libCompanyNameTitle = document.getElementById('lib-company-name-title');
const libTimelineList     = document.getElementById('lib-timeline-list');
const libTimelinePane     = document.getElementById('lib-timeline-pane');
const libMeetingDetail    = document.getElementById('lib-meeting-detail');
const libEmptyHint        = document.getElementById('lib-empty-hint');

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
      <span class="company-color-dot" style="background:${escHtml(c.color || '#ff7c00')}"></span>
      <span class="company-name">${escHtml(c.name)}</span>
      <button class="btn-delete-company" data-id="${c.id}" title="Delete">&#10005;</button>
    `;
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
  libEmptyHint.classList.add('hidden');
  libTimelinePane.classList.remove('hidden');
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
  libMeetingDetail.classList.remove('hidden');
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
    : `<span class="lib-empty" style="padding:0;font-style:italic">${_t('detail.audio_unavail')}</span>`;

  // ── Pane: Summary ──────────────────────────────────────────────────────────
  const pSummary = m.summary
    ? `<div class="detail-summary-text">${escHtml(m.summary.summary_text)}</div>
       ${m.summary.next_steps
         ? `<div class="detail-nextsteps-label">${_t('detail.next_steps')}</div>
            <div class="detail-summary-text detail-summary-muted">${escHtml(m.summary.next_steps)}</div>`
         : ''}`
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
        const idx  = typeof turn.speaker === 'number' ? turn.speaker : -1;
        const name = speakerNames[turn.speaker] || (idx >= 0 ? `Speaker ${idx + 1}` : null);
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
        const idx  = typeof s.speaker === 'number' ? s.speaker : -1;
        const name = speakerNames[s.speaker] || (idx >= 0 ? `Spk ${idx + 1}` : null);
        const badge = name ? `<span class="speaker-badge ${COLORS[idx % COLORS.length] || ''}" style="font-size:10px;padding:1px 7px">${escHtml(name)}</span>` : '';
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
      <button class="btn-delete-meeting btn-danger" data-id="${m.id}">${_t('detail.delete_btn')}</button>
    </div>

    <div class="md-audio">${audioHtml}</div>

    <div class="meeting-detail-tabs">
      <button class="meeting-detail-tab active" data-tab="summary">${_t('tab.summary')}</button>
      <button class="meeting-detail-tab" data-tab="keypoints">${_t('tab.keypoints')}</button>
      <button class="meeting-detail-tab" data-tab="questions">${_t('tab.questions')}</button>
      <button class="meeting-detail-tab" data-tab="actions">${_t('tab.actions')}</button>
      <button class="meeting-detail-tab" data-tab="transcript">${_t('tab.transcript')}</button>
      <button class="meeting-detail-tab" data-tab="segments">${_t('tab.segments')}</button>
    </div>

    <div class="meeting-detail-pane" data-pane="summary">${pSummary}</div>
    <div class="meeting-detail-pane hidden"  data-pane="keypoints">${pKeypoints}</div>
    <div class="meeting-detail-pane hidden"  data-pane="questions">${pQuestions}</div>
    <div class="meeting-detail-pane hidden"  data-pane="actions">${pActions}</div>
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

// ─── Events ───────────────────────────────────────────────────────────────────
document.getElementById('btn-close-library').addEventListener('click', closeLibrary);
document.getElementById('btn-new-company').addEventListener('click', createCompanyFromLib);
document.getElementById('btn-new-meeting-from-lib').addEventListener('click', () => {
  closeLibrary();
  openMeetingSetup();
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
