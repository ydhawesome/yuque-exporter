'use strict'
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const assert = require('node:assert/strict')

if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process')
  const launchEnv = { ...process.env }
  delete launchEnv.ELECTRON_RUN_AS_NODE
  const result = spawnSync(require('electron'), [__filename], { env: launchEnv, windowsHide: true, stdio: 'inherit' })
  if (result.error) throw result.error
  process.exit(result.status ?? 1)
}

const { app, BrowserWindow } = require('electron')
app.disableHardwareAcceleration()
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'yuque-ui-check-')))

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 860, height: 780, show: false,
    webPreferences: { preload: path.join(__dirname, 'fixtures', 'book-ui-preload.cjs'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true },
  })
  const errors = []
  win.webContents.on('console-message', event => {
    if (event.level === 'error') errors.push(event.message)
  })
  win.webContents.on('preload-error', (_event, preloadPath, error) => errors.push(`${preloadPath}: ${error.message}`))
  const evaluate = (fn, ...args) => win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`)
  async function waitFor(fn) {
    const deadline = Date.now() + 8000
    while (!await evaluate(fn)) {
      if (Date.now() > deadline) throw new Error(`UI wait timed out: ${fn}`)
      await new Promise(resolve => setTimeout(resolve, 30))
    }
  }
  async function reset() {
    await evaluate(() => document.getElementById('btnLoadBooks').click())
    await waitFor(() => !!document.getElementById('bk0'))
  }
  async function toggleNode(key) {
    await evaluate(key => {
      const checkbox = [...document.querySelectorAll('input[data-kind="node"]')].find(cb => cb.dataset.key === key)
      if (!checkbox) throw new Error(`Missing node: ${key}`)
      checkbox.click()
    }, key)
  }
  async function expandNode(key) {
    await evaluate(key => [...document.querySelectorAll('button[data-action="expand-node"]')].find(button => button.dataset.key === key).click(), key)
  }
  async function exportSelected() {
    await evaluate(() => document.getElementById('btnStartBooks').click())
    await waitFor(() => document.getElementById('screenDone').classList.contains('active'))
    return evaluate(() => window.yapi.testState().exports.at(-1))
  }
  try {
    await win.loadFile(path.join(__dirname, '..', 'ui', 'index.html'))
    await waitFor(() => document.getElementById('screenMain').classList.contains('active'))
    await evaluate(() => document.querySelector('[data-tab="books"]').click())
    await evaluate(() => document.getElementById('btnSelectBooksDir').click())
    await waitFor(() => document.getElementById('booksDirLabel').textContent === 'C:\\语雀备份')
    await reset()
    assert.deepEqual(await evaluate(() => window.yapi.testState().requests), [])

    // 全选尚未展开的知识库不预先请求目录。
    await evaluate(() => document.getElementById('btnCheckAll').click())
    assert.deepEqual(await evaluate(() => window.yapi.testState().requests), [])
    assert.equal(await evaluate(() => document.getElementById('btnStartBooks').disabled), false)
    await evaluate(() => document.getElementById('btnUncheckAll').click())
    assert.equal(await evaluate(() => document.getElementById('btnStartBooks').disabled), true)

    // 勾选整库自动加载；去掉单篇后，界面半选且提交明确的文档范围。
    await evaluate(() => document.getElementById('bk0').click())
    assert.equal(await evaluate(() => document.getElementById('btnStartBooks').disabled), true)
    await waitFor(() => document.querySelectorAll('input[data-kind="node"]').length > 0)
    await expandNode('toc:chapter')
    await expandNode('toc:guide')
    await toggleNode('toc:install')
    assert.equal(await evaluate(() => document.getElementById('bk0').indeterminate), true)
    assert.equal(await evaluate(() => document.getElementById('bookSelectionSummary').textContent.includes('3 篇文档')), true)
    assert.equal(await evaluate(() => document.getElementById('btnStartBooks').disabled), false)
    await new Promise(resolve => setTimeout(resolve, 250)) // 等待按钮的背景色过渡后截图。
    await evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const screenshot = process.env.YUQUE_UI_SCREENSHOT || path.join(os.tmpdir(), 'yuque-exporter-v1.2.0-selection.png')
    fs.writeFileSync(screenshot, (await win.webContents.capturePage()).toPNG())
    const partial = await exportSelected()
    assert.deepEqual(partial.books[0].selection.docSlugs, ['intro', 'export', 'draft'])
    assert.equal(partial.books.length, 1)
    await evaluate(() => document.getElementById('btnBackMain').click())
    await waitFor(() => document.getElementById('screenMain').classList.contains('active'))

    // 单独勾选文件夹只提交其子文档。
    await evaluate(() => document.getElementById('btnUncheckAll').click())
    await toggleNode('toc:guide')
    assert.equal(await evaluate(() => document.getElementById('bk0').indeterminate), true)
    const folder = await exportSelected()
    assert.deepEqual(folder.books[0].selection.docSlugs, ['install', 'export'])
    assert.deepEqual(folder.books[0].selection.folderKeys, ['toc:guide'])
    await evaluate(() => document.getElementById('btnBackMain').click())
    await waitFor(() => document.getElementById('screenMain').classList.contains('active'))

    // 单篇文档、空目录及重试都可以独立操作。
    await evaluate(() => document.getElementById('btnUncheckAll').click())
    await toggleNode('toc:export')
    const single = await exportSelected()
    assert.deepEqual(single.books[0].selection, { docSlugs: ['export'], folderKeys: [] })
    await evaluate(() => document.getElementById('btnBackMain').click())
    await waitFor(() => document.getElementById('screenMain').classList.contains('active'))
    await evaluate(() => document.getElementById('btnUncheckAll').click())
    await toggleNode('toc:empty')
    const empty = await exportSelected()
    assert.deepEqual(empty.books[0].selection, { docSlugs: [], folderKeys: ['toc:empty'] })
    await evaluate(() => document.getElementById('btnBackMain').click())
    await waitFor(() => document.getElementById('screenMain').classList.contains('active'))

    await reset()
    await evaluate(() => { window.yapi.testMode({ failNext: true }); document.getElementById('expandBook0').click() })
    await waitFor(() => !!document.querySelector('[data-action="retry"]'))
    await evaluate(() => document.querySelector('[data-action="retry"]').click())
    await waitFor(() => document.querySelectorAll('input[data-kind="node"]').length > 0)
    assert.equal(await evaluate(() => document.getElementById('bk0').checked), false)

    // 请求未结束时取消选择，返回后不能重新选中；刷新也不能复活旧目录。
    await reset()
    await evaluate(() => { window.yapi.testMode({ delay: 250 }); document.getElementById('bk0').click(); document.getElementById('btnUncheckAll').click() })
    await waitFor(() => document.querySelectorAll('input[data-kind="node"]').length > 0)
    assert.equal(await evaluate(() => document.getElementById('bk0').checked), false)
    assert.equal(await evaluate(() => document.querySelectorAll('#bookList input:checked').length), 0)
    await reset()
    await evaluate(() => { document.getElementById('bk0').click(); document.getElementById('btnLoadBooks').click() })
    await waitFor(() => !!document.getElementById('bk0') && !document.getElementById('btnLoadBooks').disabled)
    await new Promise(resolve => setTimeout(resolve, 350))
    assert.equal(await evaluate(() => document.querySelectorAll('input[data-kind="node"]').length), 0)
    assert.equal(await evaluate(() => document.getElementById('bk0').checked), false)
    assert.deepEqual(errors, [])
    console.log('Electron UI checks passed: lazy loading, whole book, partial state, folders, single docs, empty folders, retries, cancellation and stale requests.')
    console.log(`Screenshot: ${screenshot}`)
    win.destroy()
    app.exit(0)
  } catch (error) {
    console.error(error)
    console.error('Renderer errors:', errors)
    win.destroy()
    app.exit(1)
  }
}).catch(error => { console.error(error); app.exit(1) })
