'use strict';

// ─── État bibliothèque ────────────────────────────────────────────────────────
let libOpen            = false;
let companies          = [];
let selectedCompanyId  = null;
let meetings           = [];
let selectedMeetingId  = null;

// ─── Éléments DOM ─────────────────────────────────────────────────────────────
const libraryOverlay      = document.getElementById('library-overlay');
const libCompaniesList    = document.getElementById('lib-companies-list');
const libCompanyNameTitle = document.getElementById('lib-company-name-title');
const libMeetingsList     = document.getElementById('lib-meetings-list');
const libMeetingsPane     = document.getElementById('lib-meetings-pane');
const libMeetingDetail    = document.getElementById('lib-meeting-detail');
const libEmptyHint        = document.getElementById('lib-empty-hint');

const meetingSetupModal     = document.getElementById('meeting-setup-modal');
const modalCompanySelect    = document.getElementById('modal-company-select');
const modalTitle            = document.getElementById('modal-title');
const modalDesc             = document.getElementById('modal-desc');
const modalNewCompanyForm   = document.getElementById('modal-new-company-form');
const modalNewCompanyName   = document.getElementById('modal-new-company-name');

// ─── Library open / close ─────────────────────────────────────────────────────
async function openLibrary() {
  libOpen = true;
  libraryOverlay.classList.remove('hidden');
  await loadCompanies();
}

function closeLibrary() {
  libOpen = false;
  libraryOverlay.classList.add('hidden');
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
  libCompaniesList.innerHTML = '';
  if (!companies.length) {
    libCompaniesList.innerHTML = '<div class="lib-empty">Aucune entreprise.<br>Créez-en une avec +</div>';
    return;
  }
  companies.forEach(c => {
    const el = document.createElement('div');
    el.className = 'lib-company-item' + (c.id === selectedCompanyId ? ' active' : '');
    el.dataset.id = c.id;
    el.innerHTML = `
      <span class="company-color-dot" style="background:${escHtml(c.color || '#ff7c00')}"></span>
      <span class="company-name">${escHtml(c.name)}</span>
      <button class="btn-delete-company" data-id="${c.id}" title="Supprimer">&#10005;</button>
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
  libMeetingsPane.classList.remove('hidden');
  await loadMeetings(id);
}

async function loadMeetings(companyId) {
  try {
    meetings = await window.electronAPI.db.getMeetings(companyId);
  } catch (e) {
    console.error('[lib] getMeetings', e);
    meetings = [];
  }
  renderMeetings();
}

function renderMeetings() {
  libMeetingsList.innerHTML = '';
  if (!meetings.length) {
    libMeetingsList.innerHTML = '<div class="lib-empty">Aucune réunion pour cette entreprise.</div>';
    return;
  }
  meetings.forEach(m => {
    const el = document.createElement('div');
    el.className = 'lib-meeting-item' + (m.id === selectedMeetingId ? ' active' : '');
    const date = m.recorded_at ? new Date(m.recorded_at).toLocaleDateString('fr-FR', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    }) : '';
    const dur = m.duration_seconds ? formatDuration(m.duration_seconds) : '';
    el.innerHTML = `
      <div class="meeting-item-content">
        <div class="meeting-item-title">${escHtml(m.title)}</div>
        <div class="meeting-item-meta">
          ${date ? `<span>${date}</span>` : ''}
          ${dur  ? `<span class="meeting-dur">${dur}</span>` : ''}
          <span class="meeting-status status-${m.status}">${m.status === 'done' ? '✓' : '⏺'}</span>
        </div>
      </div>
      <button class="btn-delete-meeting-item" title="Supprimer">&#10005;</button>
    `;
    el.querySelector('.meeting-item-content').addEventListener('click', () => selectMeeting(m.id));
    el.querySelector('.btn-delete-meeting-item').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteMeeting(m.id);
    });
    libMeetingsList.appendChild(el);
  });
}

async function selectMeeting(id) {
  selectedMeetingId = id;
  renderMeetings();
  try {
    const meeting = await window.electronAPI.db.getMeeting(id);
    if (meeting) renderMeetingDetail(meeting);
  } catch (e) {
    console.error('[lib] getMeeting', e);
  }
}

function renderMeetingDetail(m) {
  libMeetingDetail.classList.remove('hidden');

  const date = m.recorded_at ? new Date(m.recorded_at).toLocaleDateString('fr-FR', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  }) : '';
  const dur  = m.duration_seconds ? formatDuration(m.duration_seconds) : '';

  // Transcription
  const transcriptHtml = m.sentences && m.sentences.length
    ? m.sentences.map(s => `<div class="detail-sentence">
        <span class="detail-ts">${Number(s.start_time).toFixed(1)}s</span>
        <span>${escHtml(s.segment)}</span>
      </div>`).join('')
    : '<div class="lib-empty">Aucune transcription.</div>';

  // Q&A
  const qaHtml = m.questions && m.questions.length
    ? m.questions.map((q, i) => `
        <div class="detail-qa-item">
          <div class="detail-q"><strong>Q${i + 1}.</strong> ${escHtml(q.text)}</div>
          ${q.answer ? `<div class="detail-a">${escHtml(q.answer)}</div>` : ''}
        </div>`).join('')
    : '<div class="lib-empty">Aucune question.</div>';

  // Actions
  const actionsHtml = m.actions && m.actions.length
    ? m.actions.map(a => `
        <div class="detail-action-item ${a.status === 'done' ? 'action-done' : ''}">
          <input type="checkbox" class="action-checkbox" data-id="${a.id}" data-status="${a.status}"
            ${a.status === 'done' ? 'checked' : ''} />
          <span>${escHtml(a.text)}</span>
        </div>`).join('')
    : '<div class="lib-empty">Aucune action.</div>';

  // Résumé
  const summaryHtml = m.summary
    ? `<div class="detail-summary-text">${escHtml(m.summary.summary_text)}</div>
       ${m.summary.next_steps ? `<div class="detail-nextsteps-label">Prochaines étapes</div>
       <div class="detail-summary-text">${escHtml(m.summary.next_steps)}</div>` : ''}`
    : '<div class="lib-empty">Aucune synthèse générée.</div>';

  // Audio player
  const audioHtml = m.audio_path
    ? `<audio controls src="file://${m.audio_path.replace(/\\/g, '/')}" class="detail-audio-player"></audio>`
    : '<div class="lib-empty">Enregistrement audio non disponible.</div>';

  libMeetingDetail.innerHTML = `
    <div class="detail-header">
      <div>
        <div class="detail-title">${escHtml(m.title)}</div>
        <div class="detail-meta">${date}${dur ? ' · ' + dur : ''}</div>
      </div>
      <button class="btn-delete-meeting btn-danger" data-id="${m.id}">Supprimer</button>
    </div>
    ${m.description ? `<div class="detail-desc">${escHtml(m.description)}</div>` : ''}

    <div class="detail-section">
      <div class="detail-section-label">&#127908; Audio</div>
      ${audioHtml}
    </div>

    <div class="detail-section">
      <div class="detail-section-label">&#128221; Transcription</div>
      <div class="detail-transcript">${transcriptHtml}</div>
    </div>

    <div class="detail-section">
      <div class="detail-section-label">&#10067; Questions &amp; Réponses</div>
      <div class="detail-qa">${qaHtml}</div>
    </div>

    <div class="detail-section">
      <div class="detail-section-label">&#9989; Actions</div>
      <div class="detail-actions">${actionsHtml}</div>
    </div>

    <div class="detail-section">
      <div class="detail-section-label">&#128196; Synthèse</div>
      ${summaryHtml}
    </div>
  `;

  // Bind checkboxes
  libMeetingDetail.querySelectorAll('.action-checkbox').forEach(cb => {
    cb.addEventListener('change', async (e) => {
      const actionId  = Number(e.target.dataset.id);
      const newStatus = e.target.checked ? 'done' : 'todo';
      try {
        await window.electronAPI.db.toggleAction(actionId, newStatus);
        e.target.dataset.status = newStatus;
        const item = e.target.closest('.detail-action-item');
        if (newStatus === 'done') item.classList.add('action-done');
        else item.classList.remove('action-done');
      } catch (err) {
        console.error('[lib] toggleAction', err);
      }
    });
  });

  // Bind delete button
  const delBtn = libMeetingDetail.querySelector('.btn-delete-meeting');
  if (delBtn) {
    delBtn.addEventListener('click', () => deleteMeeting(m.id));
  }
}

async function deleteMeeting(id) {
  if (!confirm('Supprimer cette réunion ? Cette action est irréversible.')) return;
  try {
    await window.electronAPI.db.deleteMeeting(id);
    selectedMeetingId = null;
    libMeetingDetail.classList.add('hidden');
    if (selectedCompanyId !== null) await loadMeetings(selectedCompanyId);
  } catch (e) {
    console.error('[lib] deleteMeeting', e);
  }
}

async function confirmDeleteCompany(id, name) {
  if (!confirm(`Supprimer l'entreprise "${name}" et TOUTES ses réunions ?`)) return;
  try {
    await window.electronAPI.db.deleteCompany(id);
    if (selectedCompanyId === id) {
      selectedCompanyId = null;
      selectedMeetingId = null;
      libMeetingsPane.classList.add('hidden');
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
  modalTitle.value = '';
  modalDesc.value  = '';
  modalNewCompanyName.value = '';
  modalNewCompanyForm.classList.add('hidden');
  await populateCompanySelect();
}

function closeMeetingSetup() {
  meetingSetupModal.classList.add('hidden');
}

async function populateCompanySelect() {
  try { companies = await window.electronAPI.db.getCompanies(); }
  catch(e) { companies = []; }

  if (companies.length === 0) {
    modalCompanySelect.innerHTML = '<option value="">— Aucune entreprise —</option>';
    modalNewCompanyForm.classList.remove('hidden');
    document.getElementById('modal-btn-new-company').textContent = '− Annuler';
    setTimeout(() => modalNewCompanyName.focus(), 80);
  } else {
    modalCompanySelect.innerHTML = companies.map(c =>
      `<option value="${c.id}">${escHtml(c.name)}</option>`).join('');
    modalNewCompanyForm.classList.add('hidden');
    document.getElementById('modal-btn-new-company').textContent = '+ Nouvelle';
  }
}

async function confirmNewMeeting() {
  let companyId = Number(modalCompanySelect.value);
  const companyNameField = modalNewCompanyName.value.trim();

  // Créer une nouvelle entreprise si le formulaire inline est visible
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
  if (!companyId) { alert('Sélectionnez ou créez une entreprise.'); return; }

  const desc = modalDesc.value.trim();
  try {
    const result = await window.electronAPI.db.createMeeting(companyId, title, desc);
    const meetingId = result.id;

    // Trouver le nom de l'entreprise
    let companyName = companyNameField || '';
    if (!companyName) {
      const found = companies.find(c => c.id === companyId);
      companyName = found ? found.name : String(companyId);
    }

    // Transmettre le contexte à app.js
    if (typeof window._appSetCurrentMeeting === 'function') {
      window._appSetCurrentMeeting(meetingId, companyName, title);
    }

    closeMeetingSetup();

    // Démarrer l'enregistrement automatiquement
    if (typeof window._appStartRecording === 'function') {
      window._appStartRecording();
    }
  } catch (e) {
    console.error('[lib] createMeeting', e);
  }
}

// ─── Nouveau meeting depuis bibliothèque ──────────────────────────────────────
function openNewMeetingFromLib() {
  closeLibrary();
  openMeetingSetup();
  // Pré-sélectionner l'entreprise courante si applicable
  if (selectedCompanyId !== null) {
    // Sera appliqué après populateCompanySelect dans openMeetingSetup
    const origPopulate = populateCompanySelect;
    openMeetingSetup().then(() => {
      if (selectedCompanyId) {
        const opt = modalCompanySelect.querySelector(`option[value="${selectedCompanyId}"]`);
        if (opt) modalCompanySelect.value = selectedCompanyId;
      }
    });
  }
}

// ─── Ajout entreprise depuis bibliothèque ─────────────────────────────────────
async function createCompanyFromLib() {
  const name = prompt('Nom de la nouvelle entreprise :');
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

// ─── Événements ───────────────────────────────────────────────────────────────
document.getElementById('btn-library').addEventListener('click', openLibrary);
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
    document.getElementById('modal-btn-new-company').textContent = '- Annuler';
  } else {
    modalNewCompanyForm.classList.add('hidden');
    document.getElementById('modal-btn-new-company').textContent = '+ Nouvelle';
    modalNewCompanyName.value = '';
  }
});

// Fermer modal sur clic backdrop
document.querySelector('#meeting-setup-modal .modal-backdrop').addEventListener('click', closeMeetingSetup);

// Exposer pour app.js
window._libOpenMeetingSetup = openMeetingSetup;
