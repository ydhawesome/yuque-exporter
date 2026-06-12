'use strict'
// ─── helpers ───────────────────────────────────────────────────────
function $(id) { return document.getElementById(id) }
function showScreen(name) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'))
  $('screen' + name.charAt(0).toUpperCase() + name.slice(1)).classList.add('active')
}

// ─── State ─────────────────────────────────────────────────────────
let notesOutDir = null
let booksOutDir = null
let bookData = []   // [{id,slug,name,user}]

// ─── Login status ──────────────────────────────────────────────────
async function refreshLoginStatus() {
  const s = await window.yapi.checkLogin()
  const el = $('loginStatus')
  if (s.ok) {
    el.classList.add('ok')
    $('loginName').textContent = s.name ? `已登录：${s.name}` : '已登录'
  } else {
    el.classList.remove('ok')
    $('loginName').textContent = s.reason || '未登录'
  }
  return s.ok
}

// ─── Init ──────────────────────────────────────────────────────────
;(async () => {
  const loggedIn = await refreshLoginStatus()
  if (loggedIn) showScreen('main')
  else showScreen('login')
})()

// ─── Login ─────────────────────────────────────────────────────────
$('btnLogin').addEventListener('click', async () => {
  const userName = $('inputUser').value.trim()
  const password = $('inputPass').value
  if (!userName || !password) {
    showError('请填写账号和密码')
    return
  }
  $('btnLogin').disabled = true
  $('btnLogin').textContent = '登录中...'
  hideError()
  try {
    const r = await window.yapi.login({ userName, password })
    $('inputPass').value = ''
    await refreshLoginStatus()
    showScreen('main')
  } catch (e) {
    // strip Electron IPC prefix "Error invoking remote method 'login': Error "
    const msg = (e.message || '登录失败').replace(/^Error invoking remote method '[^']+': (?:Error: ?)?/, '')
    showError(msg || '登录失败，请检查账号密码')
  } finally {
    $('btnLogin').disabled = false
    $('btnLogin').textContent = '登 录'
  }
})
$('inputPass').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('btnLogin').click()
})

function cleanErr(e) {
  return (e?.message || String(e)).replace(/^Error invoking remote method '[^']+': (?:Error: ?)?/, '')
}
function showError(msg) {
  const el = $('loginError')
  el.textContent = msg
  el.style.display = 'block'
}
function hideError() { $('loginError').style.display = 'none' }

// ─── Tabs ───────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'))
    document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'))
    tab.classList.add('active')
    $('tab' + tab.dataset.tab.charAt(0).toUpperCase() + tab.dataset.tab.slice(1)).classList.add('active')
  })
})

// ─── Notes dir ─────────────────────────────────────────────────────
$('btnSelectNotesDir').addEventListener('click', async () => {
  const d = await window.yapi.selectDir()
  if (d) {
    notesOutDir = d
    $('notesDirLabel').textContent = d
    $('btnStartNotes').disabled = false
  }
})

// ─── Notes export ──────────────────────────────────────────────────
$('btnStartNotes').addEventListener('click', async () => {
  if (!notesOutDir) return
  startProgress('正在导出小记...')
  try {
    const result = await window.yapi.exportNotes({ outDir: notesOutDir })
    showDone('小记导出完成', [
      { num: result.total, label: '小记总数' },
      { num: result.imgOk, label: '图片下载成功' },
      { num: result.imgFail, label: '图片失败' },
    ], [
      { label: '打开 Markdown 目录', path: result.mdDir },
      { label: '打开 Excel 文件所在目录', path: require ? null : result.xlsxPath, dirOf: result.xlsxPath },
    ])
  } catch (e) {
    showDoneError(cleanErr(e))
  }
})

// ─── Books ─────────────────────────────────────────────────────────
$('btnSelectBooksDir').addEventListener('click', async () => {
  const d = await window.yapi.selectDir()
  if (d) {
    booksOutDir = d
    $('booksDirLabel').textContent = d
    updateBooksBtn()
  }
})

$('btnLoadBooks').addEventListener('click', loadBooks)

async function loadBooks() {
  $('bookList').innerHTML = '<div class="book-loading">加载中...</div>'
  try {
    bookData = await window.yapi.getBooks()
    renderBookList()
  } catch (e) {
    $('bookList').innerHTML = `<div class="book-loading" style="color:#e53e3e">加载失败: ${escHtml(cleanErr(e))}</div>`
  }
}

function renderBookList() {
  if (!bookData.length) {
    $('bookList').innerHTML = '<div class="book-loading">没有找到知识库</div>'
    return
  }
  $('bookList').innerHTML = bookData.map((b, i) => `
    <div class="book-item" data-i="${i}">
      <input type="checkbox" id="bk${i}" data-i="${i}"/>
      <div>
        <div class="book-name">${escHtml(b.name)}</div>
        <div class="book-user">@${escHtml(b.user)}</div>
      </div>
    </div>`).join('')
  $('bookList').querySelectorAll('.book-item').forEach((item) => {
    item.addEventListener('click', (e) => {
      if (e.target.tagName === 'INPUT') return
      const cb = item.querySelector('input[type=checkbox]')
      cb.checked = !cb.checked
      updateBooksBtn()
    })
  })
  $('bookList').querySelectorAll('input[type=checkbox]').forEach((cb) => {
    cb.addEventListener('change', updateBooksBtn)
  })
}

function selectedBooks() {
  return [...$('bookList').querySelectorAll('input[type=checkbox]:checked')]
    .map((cb) => bookData[+cb.dataset.i])
    .filter(Boolean)
}

function updateBooksBtn() {
  $('btnStartBooks').disabled = !booksOutDir || selectedBooks().length === 0
}

$('btnCheckAll').addEventListener('click', () => {
  $('bookList').querySelectorAll('input[type=checkbox]').forEach((cb) => (cb.checked = true))
  updateBooksBtn()
})
$('btnUncheckAll').addEventListener('click', () => {
  $('bookList').querySelectorAll('input[type=checkbox]').forEach((cb) => (cb.checked = false))
  updateBooksBtn()
})

$('btnStartBooks').addEventListener('click', async () => {
  const books = selectedBooks()
  if (!books.length || !booksOutDir) return
  startProgress(`正在导出 ${books.length} 个知识库...`)
  try {
    const result = await window.yapi.exportBooks({ books, outDir: booksOutDir })
    showDone('知识库导出完成', [
      { num: result.totalDocs, label: '文档总数' },
      { num: result.doneDocs, label: '下载成功' },
      { num: result.failDocs, label: '失败' },
    ], [
      { label: '打开导出目录', path: result.outDir },
    ])
  } catch (e) {
    showDoneError(cleanErr(e))
  }
})

// ─── Progress ──────────────────────────────────────────────────────
function startProgress(title) {
  $('progressTitle').textContent = title
  $('progressPct').textContent = '0%'
  $('progressBar').style.width = '0%'
  $('progressMsg').textContent = '准备中...'
  $('logBox').innerHTML = ''
  showScreen('progress')
  window.yapi.offProgress()
  window.yapi.onProgress(({ msg, pct }) => {
    const p = Math.min(Math.round(pct || 0), 100)
    $('progressBar').style.width = p + '%'
    $('progressPct').textContent = p + '%'
    $('progressMsg').textContent = msg || ''
    const line = document.createElement('div')
    line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`
    $('logBox').appendChild(line)
    $('logBox').scrollTop = $('logBox').scrollHeight
  })
}

// ─── Done ──────────────────────────────────────────────────────────
function showDone(title, stats, actions) {
  window.yapi.offProgress()
  $('doneTitle').textContent = title
  $('doneStats').innerHTML = stats.map((s) =>
    `<div class="stat-box"><div class="stat-num">${s.num}</div><div class="stat-label">${s.label}</div></div>`
  ).join('')
  $('doneActions').innerHTML = actions.map((a) => {
    const p = a.dirOf ? dirname(a.dirOf) : a.path
    if (!p) return ''
    return `<button class="btn btn-success" data-path="${escAttr(p)}">${escHtml(a.label)}</button>`
  }).join('')
  $('doneActions').querySelectorAll('button[data-path]').forEach((btn) => {
    btn.addEventListener('click', () => window.yapi.openFolder(btn.dataset.path))
  })
  showScreen('done')
}

function showDoneError(msg) {
  window.yapi.offProgress()
  $('doneTitle').textContent = '导出出错'
  $('doneStats').innerHTML = `<div class="stat-box" style="grid-column:1/-1;background:#fff5f5;border-color:#fc8181"><div style="color:#e53e3e;font-size:13px">${escHtml(msg)}</div></div>`
  $('doneActions').innerHTML = ''
  showScreen('done')
}

$('btnBackMain').addEventListener('click', async () => {
  window.yapi.offProgress()
  await refreshLoginStatus()
  showScreen('main')
})

// ─── Utils ─────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}
function escAttr(s) {
  return String(s).replace(/"/g,'&quot;')
}
function dirname(p) {
  return p.replace(/[/\\][^/\\]+$/, '')
}
