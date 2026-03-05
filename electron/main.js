const { app, BrowserWindow, ipcMain, dialog, session, desktopCapturer, nativeImage, shell, systemPreferences } = require('electron');
const path  = require('path');
const fs    = require('fs');
const http  = require('http');
const { spawn } = require('child_process');
const db    = require('./db');

let mainWindow  = null;
let pythonProc  = null;

// ─── Python detection ─────────────────────────────────────────────────────────
function getPythonExe() {
  const isWin  = process.platform === 'win32';
  const venvPy = isWin
    ? path.join(__dirname, '..', 'venv', 'Scripts', 'python.exe')
    : path.join(__dirname, '..', 'venv', 'bin', 'python');
  if (fs.existsSync(venvPy)) return venvPy;
  return isWin ? 'python' : 'python3';
}

// ─── Check if ASR server is already running ───────────────────────────────────
function isServerRunning() {
  return new Promise((resolve) => {
    const req = http.get('http://127.0.0.1:8765/health', (res) => {
      resolve(res.statusCode === 200);
    });
    req.setTimeout(3000, () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

// ─── Python server launch ─────────────────────────────────────────────────────
async function startPythonServer() {
  if (await isServerRunning()) {
    console.log('[main] ASR server already running — skipping spawn.');
    return;
  }

  const pythonExe  = getPythonExe();
  const serverPath = path.join(__dirname, '..', 'server.py');
  const cwd        = path.join(__dirname, '..');

  console.log(`[main] Starting Python: ${pythonExe} ${serverPath}`);

  pythonProc = spawn(pythonExe, [serverPath], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  pythonProc.stdout.on('data', (d) => process.stdout.write(`[server] ${d}`));
  pythonProc.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));

  pythonProc.on('exit', (code) => {
    console.log(`[main] Python server exited (code ${code})`);
    pythonProc = null;
  });
}

// ─── Main window ──────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width:  1200,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0f1117',
    title: 'Echo2Text – Transcription & Analysis',
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // ── Window icon: render SVG → PNG via renderer Canvas, then set via nativeImage
  mainWindow.webContents.once('did-finish-load', () => {
    mainWindow.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width  = 256;
          canvas.height = 256;
          canvas.getContext('2d').drawImage(img, 0, 0, 256, 256);
          resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = () => resolve(null);
        img.src = 'assets/icon-echo2text.svg';
      })
    `).then(dataURL => {
      if (!dataURL || !mainWindow) return;
      const icon = nativeImage.createFromDataURL(dataURL);
      if (!icon.isEmpty()) mainWindow.setIcon(icon);
    }).catch(err => console.error('[icon]', err));
  });

  // Allow microphone
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (permission === 'media') return callback(true);
    callback(false);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    // If the YouTube/URL window is still open, close it so window-all-closed fires
    // and the Python ASR server is properly terminated.
    if (urlWindow && !urlWindow.isDestroyed()) {
      urlWindow.close();
    }
  });
}

// ─── Document generators ──────────────────────────────────────────────────────

function xmlEsc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildHtmlDocument(m) {
  const esc  = str => String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
  const speakerNames = m.speaker_names || {};

  const date = m.recorded_at ? new Date(m.recorded_at).toLocaleString() : '';
  const dur  = m.duration_seconds ? (() => {
    const s = Math.round(m.duration_seconds), mn = Math.floor(s/60);
    return mn > 0 ? `${mn}m ${String(s%60).padStart(2,'0')}s` : `${s}s`;
  })() : '';

  let body = '';

  if (m.summary) {
    body += `<div class="section"><h2>Summary</h2><p>${esc(m.summary.summary_text)}</p>`;
    if (m.summary.next_steps) {
      const steps = Array.isArray(m.summary.next_steps) ? m.summary.next_steps : [m.summary.next_steps];
      body += `<h3>Next Steps</h3><ul>${steps.map(i => `<li>${esc(typeof i==='string'?i:(i.text||i.action||JSON.stringify(i)))}</li>`).join('')}</ul>`;
    }
    body += `</div>`;
  }
  if (m.key_points && m.key_points.length)
    body += `<div class="section"><h2>Key Points</h2><ul>${m.key_points.map(k=>`<li>${esc(k)}</li>`).join('')}</ul></div>`;
  if (m.questions && m.questions.length)
    body += `<div class="section"><h2>Questions</h2>${m.questions.map((q,i)=>`<div class="q-item"><div class="q-text">Q${i+1}. ${esc(q.text)}</div>${q.answer?`<div class="q-answer">${esc(q.answer)}</div>`:''}</div>`).join('')}</div>`;
  if (m.actions && m.actions.length)
    body += `<div class="section"><h2>Actions</h2>${m.actions.map(a=>`<div class="action-item ${a.status==='done'?'done':''}"><span>${a.status==='done'?'☑':'☐'}</span><span>${esc(a.text)}</span></div>`).join('')}</div>`;
  if (m.sentences && m.sentences.length) {
    const turns=[]; let cur=null;
    for(const s of m.sentences){const spk=s.speaker??null;if(!cur||cur.speaker!==spk){cur={speaker:spk,segs:[]};turns.push(cur);}cur.segs.push(s.segment);}
    const COLORS=['#e05c00','#0070c0','#107c10','#8764b8','#c4314b','#038387'];
    body += `<div class="section"><h2>Transcript</h2>${turns.map(t=>{
      const idx=typeof t.speaker==='number'?t.speaker:-1;
      const name=speakerNames[t.speaker]||(idx>=0?`Speaker ${idx+1}`:null);
      const col=COLORS[idx%COLORS.length]||'#555';
      return `<div class="turn">${name?`<div class="spk" style="color:${col}">${esc(name)}</div>`:''}<div>${esc(t.segs.join(' '))}</div></div>`;
    }).join('')}</div>`;
  }

  const css=`body{font-family:Arial,sans-serif;color:#222;max-width:820px;margin:0 auto;padding:40px 32px;font-size:14px;line-height:1.55}h1{font-size:22px;border-bottom:2px solid #e05c00;padding-bottom:8px;margin-bottom:4px}h2{font-size:12px;text-transform:uppercase;letter-spacing:.6px;color:#666;margin:24px 0 8px}h3{font-size:13px;color:#444;margin:12px 0 6px}.meta{color:#888;font-size:13px;margin-bottom:28px}.section{border-top:1px solid #e8e8e8;padding-top:16px;margin-bottom:24px}ul{margin:0;padding-left:20px}ul li{padding:3px 0}.q-item{padding:8px 0;border-bottom:1px solid #f0f0f0}.q-text{font-weight:600}.q-answer{color:#555;margin:4px 0 0 16px}.action-item{display:flex;gap:8px;padding:4px 0}.action-item.done span:last-child{text-decoration:line-through;color:#aaa}.turn{margin-bottom:14px}.spk{font-size:12px;font-weight:700;margin-bottom:3px}@media print{body{padding:20px}}`;
  return `<!DOCTYPE html>\n<html>\n<head><meta charset="UTF-8"><title>${esc(m.title||'Meeting')}</title><style>${css}</style></head>\n<body>\n<h1>${esc(m.title||'Meeting')}</h1>\n<div class="meta">${date}${dur?' · '+dur:''}</div>\n${body}\n</body>\n</html>`;
}

async function buildDocxBuffer(m) {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = require('docx');
  const speakerNames = m.speaker_names || {};
  const children = [];

  const addH1  = t => children.push(new Paragraph({ text: String(t), heading: HeadingLevel.HEADING_1 }));
  const addH2  = t => children.push(new Paragraph({ text: String(t), heading: HeadingLevel.HEADING_2 }));
  const addH3  = t => children.push(new Paragraph({ text: String(t), heading: HeadingLevel.HEADING_3 }));
  const addP   = t => children.push(new Paragraph({ text: String(t ?? '') }));
  const addLi  = t => children.push(new Paragraph({ text: String(t), bullet: { level: 0 } }));
  const addBlank = () => children.push(new Paragraph({ text: '' }));

  addH1(m.title || 'Meeting');
  if (m.recorded_at) children.push(new Paragraph({ children: [new TextRun({ text: new Date(m.recorded_at).toLocaleString(), color: '888888', size: 20 })] }));
  addBlank();

  if (m.summary) {
    addH2('Summary'); addP(m.summary.summary_text || '');
    if (m.summary.next_steps) {
      addH3('Next Steps');
      const steps = Array.isArray(m.summary.next_steps) ? m.summary.next_steps : [m.summary.next_steps];
      steps.forEach(i => addLi(typeof i==='string' ? i : (i.text||i.action||JSON.stringify(i))));
    }
    addBlank();
  }
  if (m.key_points && m.key_points.length) {
    addH2('Key Points');
    m.key_points.forEach(addLi);
    addBlank();
  }
  if (m.questions && m.questions.length) {
    addH2('Questions');
    m.questions.forEach((q, i) => {
      children.push(new Paragraph({ children: [new TextRun({ text: `Q${i+1}. ${q.text}`, bold: true })] }));
      if (q.answer) addP(q.answer);
    });
    addBlank();
  }
  if (m.actions && m.actions.length) {
    addH2('Actions');
    m.actions.forEach(a => {
      children.push(new Paragraph({ children: [
        new TextRun({ text: a.status === 'done' ? '☑ ' : '☐ ' }),
        new TextRun({ text: String(a.text), strike: a.status === 'done', color: a.status === 'done' ? '999999' : '222222' }),
      ]}));
    });
    addBlank();
  }
  if (m.sentences && m.sentences.length) {
    addH2('Transcript');
    const turns=[]; let cur=null;
    for(const s of m.sentences){const spk=s.speaker??null;if(!cur||cur.speaker!==spk){cur={speaker:spk,segs:[]};turns.push(cur);}cur.segs.push(s.segment);}
    turns.forEach(t => {
      const idx = typeof t.speaker === 'number' ? t.speaker : -1;
      const name = speakerNames[t.speaker] || (idx >= 0 ? `Speaker ${idx+1}` : null);
      if (name) children.push(new Paragraph({ children: [new TextRun({ text: name, bold: true, color: 'E05C00' })] }));
      addP(t.segs.join(' '));
    });
  }

  const doc = new Document({ sections: [{ children }] });
  return Packer.toBuffer(doc);
}

async function buildOdtBuffer(m) {
  const JSZip = require('jszip');
  const speakerNames = m.speaker_names || {};

  const e = xmlEsc;
  const h1 = t => `<text:h text:style-name="Heading_1" text:outline-level="1">${e(t)}</text:h>`;
  const h2 = t => `<text:h text:style-name="Heading_2" text:outline-level="2">${e(t)}</text:h>`;
  const h3 = t => `<text:h text:style-name="Heading_3" text:outline-level="3">${e(t)}</text:h>`;
  const p  = t => `<text:p text:style-name="Text_Body">${e(t)}</text:p>`;
  const li = t => `<text:p text:style-name="List_Paragraph">• ${e(t)}</text:p>`;
  const bold = t => `<text:p text:style-name="Text_Body"><text:span text:style-name="Bold">${e(t)}</text:span></text:p>`;
  const blank = () => `<text:p text:style-name="Text_Body"/>`;

  const parts = [];
  parts.push(h1(m.title || 'Meeting'));
  if (m.recorded_at) parts.push(p(new Date(m.recorded_at).toLocaleString()));
  parts.push(blank());

  if (m.summary) {
    parts.push(h2('Summary')); parts.push(p(m.summary.summary_text || ''));
    if (m.summary.next_steps) {
      parts.push(h3('Next Steps'));
      const steps = Array.isArray(m.summary.next_steps) ? m.summary.next_steps : [m.summary.next_steps];
      steps.forEach(i => parts.push(li(typeof i==='string'?i:(i.text||i.action||JSON.stringify(i)))));
    }
    parts.push(blank());
  }
  if (m.key_points && m.key_points.length) {
    parts.push(h2('Key Points'));
    m.key_points.forEach(k => parts.push(li(k)));
    parts.push(blank());
  }
  if (m.questions && m.questions.length) {
    parts.push(h2('Questions'));
    m.questions.forEach((q, i) => {
      parts.push(`<text:p text:style-name="Text_Body"><text:span text:style-name="Bold">Q${i+1}. ${e(q.text)}</text:span></text:p>`);
      if (q.answer) parts.push(p(q.answer));
    });
    parts.push(blank());
  }
  if (m.actions && m.actions.length) {
    parts.push(h2('Actions'));
    m.actions.forEach(a => parts.push(p(`${a.status==='done'?'☑':'☐'} ${a.text}`)));
    parts.push(blank());
  }
  if (m.sentences && m.sentences.length) {
    parts.push(h2('Transcript'));
    const turns=[]; let cur=null;
    for(const s of m.sentences){const spk=s.speaker??null;if(!cur||cur.speaker!==spk){cur={speaker:spk,segs:[]};turns.push(cur);}cur.segs.push(s.segment);}
    turns.forEach(t => {
      const idx = typeof t.speaker === 'number' ? t.speaker : -1;
      const name = speakerNames[t.speaker] || (idx >= 0 ? `Speaker ${idx+1}` : null);
      if (name) parts.push(bold(name));
      parts.push(p(t.segs.join(' ')));
    });
  }

  const contentXml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content
  xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
  xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"
  xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"
  office:version="1.3">
  <office:automatic-styles>
    <style:style style:name="Bold" style:family="text">
      <style:text-properties fo:font-weight="bold"/>
    </style:style>
  </office:automatic-styles>
  <office:body><office:text>${parts.join('\n')}</office:text></office:body>
</office:document-content>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles
  xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"
  xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"
  office:version="1.3">
  <office:styles>
    <style:style style:name="Heading_1" style:family="paragraph" style:default-outline-level="1">
      <style:text-properties fo:font-size="18pt" fo:font-weight="bold" fo:color="#111111"/>
      <style:paragraph-properties fo:margin-top="0.4cm" fo:margin-bottom="0.2cm"/>
    </style:style>
    <style:style style:name="Heading_2" style:family="paragraph" style:default-outline-level="2">
      <style:text-properties fo:font-size="13pt" fo:font-weight="bold" fo:color="#444444"/>
      <style:paragraph-properties fo:margin-top="0.4cm" fo:margin-bottom="0.15cm"/>
    </style:style>
    <style:style style:name="Heading_3" style:family="paragraph" style:default-outline-level="3">
      <style:text-properties fo:font-size="12pt" fo:font-weight="bold" fo:color="#666666"/>
      <style:paragraph-properties fo:margin-top="0.2cm" fo:margin-bottom="0.1cm"/>
    </style:style>
    <style:style style:name="Text_Body" style:family="paragraph">
      <style:text-properties fo:font-size="11pt"/>
      <style:paragraph-properties fo:margin-bottom="0.15cm"/>
    </style:style>
    <style:style style:name="List_Paragraph" style:family="paragraph" style:parent-style-name="Text_Body">
      <style:paragraph-properties fo:margin-left="0.5cm" fo:margin-bottom="0.1cm"/>
    </style:style>
  </office:styles>
</office:document-styles>`;

  const manifestXml = `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">
  <manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="application/vnd.oasis.opendocument.text"/>
  <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
  <manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>
</manifest:manifest>`;

  const zip = new JSZip();
  zip.file('mimetype', 'application/vnd.oasis.opendocument.text', { compression: 'STORE' });
  zip.folder('META-INF').file('manifest.xml', manifestXml);
  zip.file('styles.xml', stylesXml);
  zip.file('content.xml', contentXml);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// ─── IPC : export:pdf ────────────────────────────────────────────────────────
ipcMain.handle('export:pdf', async (_e, { html, defaultName }) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (canceled || !filePath) return { success: false };

  const tmpPath = path.join(app.getPath('temp'), `echo2text-export-${Date.now()}.html`);
  fs.writeFileSync(tmpPath, html, 'utf8');

  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true } });
  await win.loadFile(tmpPath);

  const pdfData = await win.webContents.printToPDF({
    printBackground: true,
    pageSize: 'A4',
    margins: { marginType: 'custom', top: 1.5, bottom: 1.5, left: 1.5, right: 1.5 },
  });
  win.close();
  try { fs.unlinkSync(tmpPath); } catch (_) {}

  fs.writeFileSync(filePath, pdfData);
  return { success: true, filePath };
});

// ─── IPC : export:document (HTML / DOCX / ODT) ───────────────────────────────
ipcMain.handle('export:document', async (_e, { format, meetingData, defaultName }) => {
  const base = (defaultName || 'meeting').replace(/\.[^.]+$/, '');
  const meta = {
    html: { ext: 'html', name: 'HTML Document' },
    docx: { ext: 'docx', name: 'Word Document (.docx)' },
    odt:  { ext: 'odt',  name: 'OpenDocument Text (.odt)' },
  };
  const m = meta[format] || meta.html;

  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: `${base}.${m.ext}`,
    filters: [{ name: m.name, extensions: [m.ext] }],
  });
  if (canceled || !filePath) return { success: false };

  if (format === 'docx') {
    const buf = await buildDocxBuffer(meetingData);
    fs.writeFileSync(filePath, buf);
  } else if (format === 'odt') {
    const buf = await buildOdtBuffer(meetingData);
    fs.writeFileSync(filePath, buf);
  } else {
    fs.writeFileSync(filePath, buildHtmlDocument(meetingData), 'utf8');
  }

  return { success: true, filePath };
});

// ─── IPC : dialog:open-audio-file ────────────────────────────────────────────
ipcMain.handle('dialog:open-audio-file', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Select audio or video file',
    properties: ['openFile'],
    filters: [
      { name: 'Audio & Video', extensions: ['wav', 'mp3', 'mp4', 'mov', 'm4a', 'ogg', 'flac', 'aac', 'webm', 'mkv', 'avi'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (canceled || !filePaths.length) return null;
  const filePath = filePaths[0];
  return { name: path.basename(filePath), filePath };
});

// ─── IPC : save-file ──────────────────────────────────────────────────────────
ipcMain.handle('save-file', async (_event, { defaultName, content, filters }) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName,
    filters:     filters || [{ name: 'All Files', extensions: ['*'] }],
  });
  if (canceled || !filePath) return { success: false };
  fs.writeFileSync(filePath, content, 'utf8');
  return { success: true, filePath };
});

// ─── IPC : DB — Companies ─────────────────────────────────────────────────────
ipcMain.handle('db:get-companies', () => db.getCompanies());

ipcMain.handle('db:create-company', (_e, { name, desc, color }) =>
  db.createCompany(name, desc, color)
);

ipcMain.handle('db:update-company', (_e, { id, ...fields }) =>
  db.updateCompany(id, fields)
);

ipcMain.handle('db:delete-company', (_e, { id }) =>
  db.deleteCompany(id)
);

// ─── IPC : DB — Meetings ──────────────────────────────────────────────────────
ipcMain.handle('db:get-meetings', (_e, { companyId }) =>
  db.getMeetings(companyId)
);

ipcMain.handle('db:get-meeting', (_e, { id }) =>
  db.getMeeting(id)
);

ipcMain.handle('db:create-meeting', (_e, { companyId, title, desc, service }) =>
  db.createMeeting(companyId, title, desc, service)
);

ipcMain.handle('db:save-meeting-data', (_e, { meetingId, ...data }) =>
  db.saveMeetingData(meetingId, data)
);

ipcMain.handle('db:delete-meeting', (_e, { id }) =>
  db.deleteMeeting(id)
);

ipcMain.handle('db:toggle-action-status', (_e, { actionId, status }) =>
  db.toggleActionStatus(actionId, status)
);

ipcMain.handle('db:save-company-analysis', (_e, { id, text }) => db.saveCompanyAnalysis(id, text));
ipcMain.handle('db:get-company-analysis',  (_e, { id })       => db.getCompanyAnalysis(id));
ipcMain.handle('db:save-email-recap',      (_e, { meetingId, text }) => db.saveEmailRecap(meetingId, text));

// ─── IPC : audio:save ────────────────────────────────────────────────────────
ipcMain.handle('audio:save', (_e, { meetingId, dataBase64, filename = 'recording.webm' }) => {
  const dataDir  = path.join(app.getPath('userData'), 'parakeet-data');
  const audioDir = path.join(dataDir, 'audio', String(meetingId));
  fs.mkdirSync(audioDir, { recursive: true });
  const audioPath = path.join(audioDir, filename);
  const buf = Buffer.from(dataBase64, 'base64');
  fs.writeFileSync(audioPath, buf);
  return { audioPath };
});

// ─── URL window (YouTube / web player) ───────────────────────────────────────
let urlWindow = null;

ipcMain.handle('open-url-window', async (_e, url) => {
  if (urlWindow && !urlWindow.isDestroyed()) {
    urlWindow.loadURL(url);
    urlWindow.show();
    urlWindow.focus();
    return;
  }
  urlWindow = new BrowserWindow({
    width:  960,
    height: 640,
    title:  'Echo2Text – Web Player',
    webPreferences: {
      nodeIntegration:  false,
      contextIsolation: true,
      // webSecurity:false lets createMediaElementSource() work for cross-origin
      // video sources (e.g. YouTube videos served from googlevideo.com).
      webSecurity: false,
      preload: path.join(__dirname, 'url-preload.js'),
    },
  });
  urlWindow.loadURL(url);
  urlWindow.on('closed', () => { urlWindow = null; });
});

// Forward PCM audio from urlWindow preload → main renderer
ipcMain.on('url-audio-pcm', (_event, buffer) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('url-audio-pcm', buffer);
  }
});

ipcMain.handle('close-url-window', () => {
  if (urlWindow && !urlWindow.isDestroyed()) urlWindow.close();
  urlWindow = null;
});

// ─── IPC : desktop-capturer ───────────────────────────────────────────────────
ipcMain.handle('desktop-capturer:get-sources', async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 0, height: 0 },
    });
    return sources.map(s => ({ id: s.id, name: s.name }));
  } catch (err) {
    // On macOS, screen recording permission may be missing.
    // Open System Preferences directly to the Screen Recording section.
    if (process.platform === 'darwin') {
      const status = systemPreferences.getMediaAccessStatus('screen');
      if (status !== 'granted') {
        const { response } = await dialog.showMessageBox(mainWindow, {
          type:    'warning',
          title:   'Screen Recording Permission Required',
          message: 'Echo2Text needs Screen Recording access to capture system audio.',
          detail:  'Click "Open Privacy Settings", then enable "Electron" (or "Echo2Text") in the Screen Recording list. Restart the app after granting access.',
          buttons: ['Open Privacy Settings', 'Cancel'],
          defaultId: 0,
          cancelId:  1,
        });
        if (response === 0) {
          shell.openExternal(
            'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
          );
        }
        return [];
      }
    }
    throw err;
  }
});

// ─── macOS Chromium flags ─────────────────────────────────────────────────────
// Electron 40 / Chromium 134 on macOS fails to wrap GPU SharedImages as
// VideoFrames when using desktopCapturer (system audio path).  The audio track
// is unaffected, but the error spam fills logs.  Falling back to the legacy
// video-capture backend suppresses the errors.
if (process.platform === 'darwin') {
  app.commandLine.appendSwitch('disable-features', 'VideoCaptureMacV2');
}

// ─── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  const dataDir = path.join(app.getPath('userData'), 'parakeet-data');
  db.initDB(dataDir);
  startPythonServer();
  createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});

// Cleanly terminate the Python server before exiting
let _isQuitting = false;
app.on('before-quit', (event) => {
  if (_isQuitting) return;
  event.preventDefault();
  _isQuitting = true;

  const doExit = () => app.exit(0);

  if (pythonProc) {
    // Server was spawned by Electron — kill directly
    pythonProc.kill();
    pythonProc = null;
    doExit();
    return;
  }

  // Server was started externally (start.bat) — ask it to shutdown via HTTP
  const req = http.get('http://127.0.0.1:8765/shutdown', () => {
    setTimeout(doExit, 200);
  });
  req.setTimeout(2000, () => { req.destroy(); doExit(); });
  req.on('error', doExit);
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
