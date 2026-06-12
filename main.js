'use strict'
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const path = require('path')

let win = null

function createWindow() {
  win = new BrowserWindow({
    width: 860,
    height: 680,
    minWidth: 760,
    minHeight: 560,
    title: '语雀导出工具',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  win.setMenuBarVisibility(false)
  win.loadFile(path.join(__dirname, 'ui', 'index.html'))
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())

// ──────────────────────────────────────────────
// IPC handlers (all async, use dynamic import for ESM src)
// ──────────────────────────────────────────────

ipcMain.handle('check-login', async () => {
  const { checkLogin } = await import('./src/yuque-api.mjs')
  return checkLogin()
})

ipcMain.handle('login', async (_e, { userName, password }) => {
  const { login } = await import('./src/yuque-api.mjs')
  const name = await login(userName, password)
  return { ok: true, name }
})

ipcMain.handle('get-books', async () => {
  const { getBookStacks } = await import('./src/yuque-api.mjs')
  return getBookStacks()
})

ipcMain.handle('select-dir', async () => {
  const result = await dialog.showOpenDialog(win, {
    properties: ['openDirectory', 'createDirectory'],
    title: '选择导出目录',
  })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('open-folder', async (_e, folderPath) => {
  shell.openPath(folderPath)
})

ipcMain.handle('export-notes', async (_e, { outDir }) => {
  const { exportNotes } = await import('./src/export-notes.mjs')
  const noteDir = path.join(outDir, 'notes')
  return exportNotes(noteDir, (prog) => {
    win?.webContents.send('progress', prog)
  })
})

ipcMain.handle('export-books', async (_e, { books, outDir }) => {
  const { exportBooks } = await import('./src/export-books.mjs')
  const bookDir = path.join(outDir, 'books')
  return exportBooks(books, bookDir, (prog) => {
    win?.webContents.send('progress', prog)
  })
})
