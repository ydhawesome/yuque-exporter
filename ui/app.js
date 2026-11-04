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
let bookStates = []
let booksLoading = false
const Tree = window.BookTree

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
  if (booksLoading) return
  booksLoading = true
  bookData = []
  bookStates = []
  $('btnLoadBooks').disabled = true
  updateBooksBtn()
  $('bookList').innerHTML = '<div class="book-loading">加载中...</div>'
  try {
    bookData = await window.yapi.getBooks()
    bookStates = bookData.map(() => ({
      all: false, expanded: false, loading: false, roots: null, error: '', warnings: [],
      selected: new Set(), openNodes: new Set(),
    }))
    renderBookList()
  } catch (e) {
    $('bookList').innerHTML = `<div class="book-loading" style="color:#e53e3e">加载失败: ${escHtml(cleanErr(e))}</div>`
  } finally {
    booksLoading = false
    $('btnLoadBooks').disabled = false
    updateBooksBtn()
  }
}

function renderBookList() {
  const scrollTop = $('bookList').scrollTop
  const focusId = document.activeElement?.id
  if (!bookData.length) {
    $('bookList').innerHTML = '<div class="book-loading">没有找到知识库</div>'
    updateBooksBtn()
    return
  }
  $('bookList').innerHTML = bookData.map((book, i) => {
    const state = bookStates[i]
    const selection = Tree.selectionState(state.roots || [], state.selected)
    const count = selectedDocCount(state)
    let content = ''
    if (state.expanded) {
      if (state.loading) content = '<div class="tree-message" role="status">正在加载目录和文档...</div>'
      else if (state.error) content = `<div class="tree-message tree-error">${escHtml(state.error)} <button class="tree-retry" data-action="retry" data-i="${i}">重试</button></div>`
      else if (state.roots) {
        content = state.warnings.map(w => `<div class="tree-message tree-warning">${escHtml(w)}</div>`).join('')
          + (state.roots.length ? renderTreeNodes(state.roots, i, 0) : '<div class="tree-message">知识库暂无可导出的文档或目录</div>')
      }
    }
    const suffix = state.roots ? `已选 ${count.selected}/${count.total} 篇` : (state.all ? '整库导出' : '展开选择文档')
    return `<div class="book-group">
      <div class="book-item">
        <button class="tree-toggle" id="expandBook${i}" data-action="expand-book" data-i="${i}" aria-expanded="${state.expanded}" aria-label="${state.expanded ? '收起' : '展开'}${escAttr(book.name)}">${state.expanded ? '▾' : '▸'}</button>
        <input type="checkbox" id="bk${i}" data-kind="book" data-i="${i}" ${state.all || selection.checked ? 'checked' : ''} data-partial="${!state.all && selection.indeterminate}" aria-label="选择整个知识库：${escAttr(book.name)}"/>
        <label class="book-label" for="bk${i}"><span class="book-name">${escHtml(book.name)}</span><span class="book-user">@${escHtml(book.user)}</span></label>
        <span class="book-count">${suffix}</span>
      </div>
      ${state.expanded ? `<div class="book-tree">${content}</div>` : ''}
    </div>`
  }).join('')
  $('bookList').querySelectorAll('input[data-partial]').forEach(cb => {
    cb.indeterminate = cb.dataset.partial === 'true'
  })
  $('bookList').scrollTop = scrollTop
  if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true })
  updateBooksBtn()
}

function renderTreeNodes(nodes, bookIndex, depth) {
  const state = bookStates[bookIndex]
  return nodes.map(node => {
    const selection = Tree.selectionState([node], state.selected)
    const canExpand = node.children.length > 0
    const expanded = state.openNodes.has(node.key)
    const id = `node-${bookIndex}-${encodeURIComponent(node.key)}`
    const count = node.children.length ? Tree.allSelectionKeys([node]).size : 0
    return `<div class="tree-row" style="--depth:${depth}">
      ${canExpand ? `<button class="tree-toggle" id="expand-${id}" data-action="expand-node" data-i="${bookIndex}" data-key="${escAttr(node.key)}" aria-expanded="${expanded}" aria-label="${expanded ? '收起' : '展开'}${escAttr(node.title)}">${expanded ? '▾' : '▸'}</button>` : '<span class="tree-spacer"></span>'}
      <input type="checkbox" id="${escAttr(id)}" data-kind="node" data-i="${bookIndex}" data-key="${escAttr(node.key)}" ${selection.checked ? 'checked' : ''} data-partial="${selection.indeterminate}" ${selection.total ? '' : 'disabled'} aria-label="选择${escAttr(node.title)}"/>
      <span class="tree-icon" aria-hidden="true">${node.type === 'TITLE' ? '📁' : node.type === 'LINK' ? '🔗' : '📄'}</span>
      <label class="tree-title" for="${escAttr(id)}" title="${escAttr(node.title)}">${escHtml(node.title)}</label>
      ${count ? `<span class="tree-count">${selection.count}/${selection.total} 项</span>` : ''}
    </div>${canExpand && expanded ? renderTreeNodes(node.children, bookIndex, depth + 1) : ''}`
  }).join('')
}

function selectedDocCount(state) {
  const all = Tree.allSelectionKeys(state.roots || [])
  const docKeys = [...all].filter(key => key.startsWith('doc:'))
  return { total: docKeys.length, selected: docKeys.filter(key => state.selected.has(key)).length }
}

async function loadBookTree(index) {
  const state = bookStates[index]
  if (!state || state.loading || state.roots) return
  state.loading = true
  state.error = ''
  renderBookList()
  try {
    const catalog = await window.yapi.getBookCatalog(bookData[index].id)
    if (bookStates[index] !== state) return // 刷新列表后丢弃旧请求。
    state.roots = catalog.roots
    state.warnings = catalog.warnings
    if (state.all) state.selected = Tree.allSelectionKeys(state.roots)
  } catch (e) {
    if (bookStates[index] !== state) return
    state.error = cleanErr(e)
  } finally {
    if (bookStates[index] === state) {
      state.loading = false
      renderBookList()
    }
  }
}

function selectedBooks() {
  return bookData.flatMap((book, i) => {
    const state = bookStates[i]
    if (state.all) return [book]
    if (!state.roots || !state.selected.size) return []
    return [{ ...book, selection: Tree.exportSelection(state.roots, state.selected) }]
  })
}

function updateBooksBtn() {
  const selected = selectedBooks()
  $('btnStartBooks').disabled = booksLoading || bookStates.some(s => s.loading) || !booksOutDir || !selected.length
  $('btnCheckAll').disabled = $('btnUncheckAll').disabled = booksLoading || !bookData.length
  $('bookSelectionSummary').textContent = !selected.length ? '尚未选择导出内容' : selected.map(book => {
    if (!book.selection) return `《${book.name}》整库`
    return `《${book.name}》${book.selection.docSlugs.length} 篇文档${book.selection.folderKeys.length ? '（含所选目录）' : ''}`
  }).join('；')
}

$('btnCheckAll').addEventListener('click', () => {
  for (const state of bookStates) {
    state.all = true
    state.selected = Tree.allSelectionKeys(state.roots || [])
  }
  renderBookList()
})
$('btnUncheckAll').addEventListener('click', () => {
  for (const state of bookStates) {
    state.all = false
    state.selected.clear()
  }
  renderBookList()
})

$('bookList').addEventListener('click', e => {
  const button = e.target.closest('button[data-action]')
  if (!button) return
  const index = +button.dataset.i
  const state = bookStates[index]
  if (!state) return
  if (button.dataset.action === 'expand-book') {
    state.expanded = !state.expanded
    renderBookList()
    if (state.expanded) loadBookTree(index)
  } else if (button.dataset.action === 'retry') {
    loadBookTree(index)
  } else if (button.dataset.action === 'expand-node') {
    const key = button.dataset.key
    if (state.openNodes.has(key)) state.openNodes.delete(key)
    else state.openNodes.add(key)
    renderBookList()
  }
})

$('bookList').addEventListener('change', e => {
  const checkbox = e.target.closest('input[data-kind]')
  if (!checkbox) return
  const index = +checkbox.dataset.i
  const state = bookStates[index]
  if (checkbox.dataset.kind === 'book') {
    state.all = checkbox.checked
    state.selected = state.all ? Tree.allSelectionKeys(state.roots || []) : new Set()
    if (state.all) state.expanded = true
    renderBookList()
    if (state.expanded) loadBookTree(index)
  } else {
    let target
    Tree.walk(state.roots, node => { if (node.key === checkbox.dataset.key) target = node })
    if (!target) return
    state.all = false
    Tree.setNodeSelected(target, state.selected, checkbox.checked)
    renderBookList()
  }
})

$('btnStartBooks').addEventListener('click', async () => {
  const books = selectedBooks()
  if (!books.length || !booksOutDir) return
  startProgress(`正在导出 ${books.length} 个知识库...`)
  try {
    const downloadAssets = $('chkDownloadAssets').checked
    const result = await window.yapi.exportBooks({ books, outDir: booksOutDir, downloadAssets })
    const stats = [
      { num: result.totalDocs, label: '文档总数' },
      { num: result.doneDocs, label: '下载成功' },
      { num: result.failDocs, label: '失败' },
    ]
    if (downloadAssets && result.assets) stats.push({ num: result.assets.done, label: '附件' })
    showDone('知识库导出完成', stats, [
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
  return escHtml(s).replace(/"/g,'&quot;').replace(/'/g,'&#39;')
}
function dirname(p) {
  return p.replace(/[/\\][^/\\]+$/, '')
}
