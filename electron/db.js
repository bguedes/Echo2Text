'use strict';

/**
 * Pure JSON storage — no native dependencies, compatible with Electron without compilation.
 *
 * Disk structure:
 *   <dataDir>/
 *     companies.json     → [{ id, name, description, color, created_at }]
 *     meetings/
 *       <id>.json        → { ...meeting, sentences[], questions[], actions[], summary }
 *     audio/<id>/recording.webm
 */

const fs   = require('fs');
const path = require('path');

let dataDir = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function readJSON(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function writeJSON(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function companiesPath()   { return path.join(dataDir, 'companies.json'); }
function meetingPath(id)   { return path.join(dataDir, 'meetings', `${id}.json`); }
function meetingsDirPath() { return path.join(dataDir, 'meetings'); }

let _nextId = null;
function nextId() {
  if (_nextId === null) {
    // Determine the highest id already used
    const companies = readJSON(companiesPath(), []);
    let max = companies.reduce((m, c) => Math.max(m, c.id || 0), 0);
    try {
      const files = fs.readdirSync(meetingsDirPath());
      files.forEach(f => {
        const n = parseInt(f, 10);
        if (!isNaN(n)) max = Math.max(max, n);
        const m = readJSON(meetingPath(n), {});
        (m.questions || []).forEach(q => { max = Math.max(max, q.id || 0); });
        (m.actions   || []).forEach(a => { max = Math.max(max, a.id || 0); });
      });
    } catch (_) {}
    _nextId = max + 1;
  }
  return _nextId++;
}

// ─── Init ─────────────────────────────────────────────────────────────────────
function initDB(dir) {
  dataDir = dir;
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(meetingsDirPath(), { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'audio'), { recursive: true });
  // Init empty companies list if absent
  if (!fs.existsSync(companiesPath())) writeJSON(companiesPath(), []);
}

// ─── Companies ────────────────────────────────────────────────────────────────
function getCompanies() {
  return readJSON(companiesPath(), []).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

function createCompany(name, description = '', color = '#ff7c00') {
  const list = readJSON(companiesPath(), []);
  const id   = nextId();
  list.push({ id, name, description, color, created_at: new Date().toISOString() });
  writeJSON(companiesPath(), list);
  return { id };
}

function updateCompany(id, fields) {
  const list    = readJSON(companiesPath(), []);
  const allowed = ['name', 'description', 'color'];
  const idx     = list.findIndex(c => c.id === id);
  if (idx === -1) return;
  allowed.forEach(k => { if (k in fields) list[idx][k] = fields[k]; });
  writeJSON(companiesPath(), list);
}

function deleteCompany(id) {
  // Delete company
  const list = readJSON(companiesPath(), []).filter(c => c.id !== id);
  writeJSON(companiesPath(), list);
  // Cascade: delete all meetings belonging to this company
  try {
    const files = fs.readdirSync(meetingsDirPath());
    files.forEach(f => {
      const meetingFile = path.join(meetingsDirPath(), f);
      const m = readJSON(meetingFile, {});
      if (m.company_id === id) fs.unlinkSync(meetingFile);
    });
  } catch (_) {}
}

// ─── Meetings ─────────────────────────────────────────────────────────────────
function getMeetings(companyId) {
  const results = [];
  try {
    const files = fs.readdirSync(meetingsDirPath());
    files.forEach(f => {
      if (!f.endsWith('.json')) return;
      const m = readJSON(path.join(meetingsDirPath(), f), null);
      if (m && m.company_id === companyId) {
        // Return meeting header only (no sentences/questions/actions details)
        results.push({
          id:               m.id,
          company_id:       m.company_id,
          title:            m.title,
          description:      m.description,
          service:          m.service || '',
          recorded_at:      m.recorded_at,
          duration_seconds: m.duration_seconds,
          audio_path:       m.audio_path,
          status:           m.status,
          created_at:       m.created_at,
        });
      }
    });
  } catch (_) {}
  return results.sort((a, b) => (b.recorded_at || '').localeCompare(a.recorded_at || ''));
}

function getMeeting(id) {
  const m = readJSON(meetingPath(id), null);
  return m;
}

function createMeeting(companyId, title, description = '', service = '') {
  const id = nextId();
  const meeting = {
    id,
    company_id:       companyId,
    title,
    description,
    service,
    recorded_at:      new Date().toISOString(),
    duration_seconds: 0,
    audio_path:       '',
    status:           'recording',
    created_at:       new Date().toISOString(),
    sentences:        [],
    questions:        [],
    actions:          [],
    summary:          null,
    speaker_names:    {},
  };
  writeJSON(meetingPath(id), meeting);
  return { id };
}

function updateMeeting(id, fields) {
  const m = readJSON(meetingPath(id), null);
  if (!m) return;
  const allowed = ['title', 'description', 'status', 'duration_seconds', 'audio_path', 'recorded_at'];
  allowed.forEach(k => { if (k in fields) m[k] = fields[k]; });
  writeJSON(meetingPath(id), m);
}

function deleteMeeting(id) {
  try { fs.unlinkSync(meetingPath(id)); } catch (_) {}
}

// ─── Bulk save (atomic) ───────────────────────────────────────────────────────
function saveMeetingData(meetingId, { sentences, keyPoints, questions, actions, summary, nextSteps, duration, audioPath, speakerNames }) {
  const m = readJSON(meetingPath(meetingId), null);
  if (!m) return;

  m.sentences = (sentences || []).map((s, i) => ({
    id:         nextId(),
    meeting_id: meetingId,
    idx:        i,
    start_time: s.start   ?? 0,
    end_time:   s.end     ?? 0,
    segment:    s.segment ?? '',
    speaker:    s.speaker ?? null,
  }));

  if (speakerNames !== undefined) m.speaker_names = speakerNames;
  if (keyPoints    !== undefined) m.key_points    = (keyPoints || []).filter(Boolean);

  m.questions = (questions || []).map((q, i) => ({
    id:         nextId(),
    meeting_id: meetingId,
    idx:        i,
    text:       q.text   ?? '',
    answer:     q.answer ?? '',
  }));

  m.actions = (actions || []).map((a, i) => {
    const text   = typeof a === 'string' ? a : (a.text   ?? '');
    const status = typeof a === 'object' ? (a.status ?? 'todo') : 'todo';
    return { id: nextId(), meeting_id: meetingId, idx: i, text, status };
  });

  if (summary || nextSteps) {
    m.summary = {
      id:           nextId(),
      meeting_id:   meetingId,
      summary_text: summary   ?? '',
      next_steps:   nextSteps ?? '',
      generated_at: new Date().toISOString(),
    };
  }

  m.status           = 'done';
  m.duration_seconds = duration  ?? 0;
  m.audio_path       = audioPath ?? '';

  writeJSON(meetingPath(meetingId), m);
}

// ─── Action status toggle ─────────────────────────────────────────────────────
function toggleActionStatus(actionId, status) {
  // Scan all meeting files to find the action
  try {
    const files = fs.readdirSync(meetingsDirPath());
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const fp = path.join(meetingsDirPath(), f);
      const m  = readJSON(fp, null);
      if (!m || !m.actions) continue;
      const action = m.actions.find(a => a.id === actionId);
      if (action) {
        action.status = status;
        writeJSON(fp, m);
        return;
      }
    }
  } catch (_) {}
}

module.exports = {
  initDB,
  getCompanies, createCompany, updateCompany, deleteCompany,
  getMeetings, getMeeting, createMeeting, updateMeeting, deleteMeeting,
  saveMeetingData, toggleActionStatus,
};
