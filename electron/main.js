const { app, BrowserWindow, ipcMain, dialog, session, desktopCapturer } = require('electron');
const path  = require('path');
const fs    = require('fs');
const http  = require('http');
const { spawn } = require('child_process');
const db    = require('./db');

let mainWindow  = null;
let pythonProc  = null;

// ─── Python detection ─────────────────────────────────────────────────────────
function getPythonExe() {
  const venvPath = path.join(__dirname, '..', 'venv', 'Scripts', 'python.exe');
  if (fs.existsSync(venvPath)) return venvPath;
  return 'python';
}

// ─── Check if ASR server is already running ───────────────────────────────────
function isServerRunning() {
  return new Promise((resolve) => {
    const req = http.get('http://127.0.0.1:8765/health', (res) => {
      resolve(res.statusCode === 200);
    });
    req.setTimeout(1000, () => { req.destroy(); resolve(false); });
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

  // Allow microphone
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (permission === 'media') return callback(true);
    callback(false);
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

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

ipcMain.handle('db:create-meeting', (_e, { companyId, title, desc }) =>
  db.createMeeting(companyId, title, desc)
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

// ─── IPC : audio:save ────────────────────────────────────────────────────────
ipcMain.handle('audio:save', (_e, { meetingId, dataBase64 }) => {
  const dataDir  = path.join(app.getPath('userData'), 'parakeet-data');
  const audioDir = path.join(dataDir, 'audio', String(meetingId));
  fs.mkdirSync(audioDir, { recursive: true });
  const audioPath = path.join(audioDir, 'recording.webm');
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
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  urlWindow.loadURL(url);
  urlWindow.on('closed', () => { urlWindow = null; });
});

ipcMain.handle('close-url-window', () => {
  if (urlWindow && !urlWindow.isDestroyed()) urlWindow.close();
  urlWindow = null;
});

// ─── IPC : desktop-capturer ───────────────────────────────────────────────────
ipcMain.handle('desktop-capturer:get-sources', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 0, height: 0 },
  });
  return sources.map(s => ({ id: s.id, name: s.name }));
});

// ─── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  const dataDir = path.join(app.getPath('userData'), 'parakeet-data');
  db.initDB(dataDir);
  startPythonServer();
  createWindow();
});

app.on('window-all-closed', () => {
  if (pythonProc) {
    pythonProc.kill();
    pythonProc = null;
  }
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
