'use strict'
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('yapi', {
  checkLogin: () => ipcRenderer.invoke('check-login'),
  login: (creds) => ipcRenderer.invoke('login', creds),
  getBooks: () => ipcRenderer.invoke('get-books'),
  selectDir: () => ipcRenderer.invoke('select-dir'),
  openFolder: (p) => ipcRenderer.invoke('open-folder', p),
  exportNotes: (opts) => ipcRenderer.invoke('export-notes', opts),
  exportBooks: (opts) => ipcRenderer.invoke('export-books', opts),
  onProgress: (cb) => ipcRenderer.on('progress', (_e, data) => cb(data)),
  offProgress: () => ipcRenderer.removeAllListeners('progress'),
})
