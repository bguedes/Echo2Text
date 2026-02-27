const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  saveFile: (options) => ipcRenderer.invoke('save-file', options),

  db: {
    getCompanies:    ()                       => ipcRenderer.invoke('db:get-companies'),
    createCompany:   (name, desc, color)      => ipcRenderer.invoke('db:create-company', { name, desc, color }),
    updateCompany:   (id, fields)             => ipcRenderer.invoke('db:update-company', { id, ...fields }),
    deleteCompany:   (id)                     => ipcRenderer.invoke('db:delete-company', { id }),

    getMeetings:     (companyId)              => ipcRenderer.invoke('db:get-meetings', { companyId }),
    getMeeting:      (id)                     => ipcRenderer.invoke('db:get-meeting', { id }),
    createMeeting:   (companyId, title, desc, service) => ipcRenderer.invoke('db:create-meeting', { companyId, title, desc, service }),
    saveMeetingData: (meetingId, data)        => ipcRenderer.invoke('db:save-meeting-data', { meetingId, ...data }),
    deleteMeeting:   (id)                     => ipcRenderer.invoke('db:delete-meeting', { id }),
    toggleAction:    (actionId, status)       => ipcRenderer.invoke('db:toggle-action-status', { actionId, status }),
  },

  audio: {
    save: (meetingId, dataBase64) => ipcRenderer.invoke('audio:save', { meetingId, dataBase64 }),
  },

  desktopCapturer: {
    getSources: () => ipcRenderer.invoke('desktop-capturer:get-sources'),
  },

  webview: {
    open:  (url) => ipcRenderer.invoke('open-url-window', url),
    close: ()    => ipcRenderer.invoke('close-url-window'),
  },
});
