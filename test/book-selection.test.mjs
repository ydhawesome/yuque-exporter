import test, { after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Tree from '../src/book-tree.js'

const suiteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuque-book-selection-'))
const originalAppData = process.env.APPDATA
process.env.APPDATA = path.join(suiteDir, 'appdata')
const { http } = await import('../src/yuque-api.mjs')
const { loadBookCatalog } = await import('../src/book-catalog.mjs')
const { exportBooks } = await import('../src/export-books.mjs')
const originalAdapter = http.defaults.adapter
const book = { id: 42, name: '测试知识库', slug: 'book', user: 'example' }
const toc = [
  { uuid: 'chapter', type: 'TITLE', title: '章节' },
  { uuid: 'selected', parent_uuid: 'chapter', type: 'DOC', title: '选中文档', url: 'selected' },
  { uuid: 'other', parent_uuid: 'chapter', type: 'DOC', title: '其他文档', url: 'other' },
  { uuid: 'empty', type: 'TITLE', title: '空目录' },
  { uuid: 'unrelated', type: 'TITLE', title: '无关目录' },
]
const docs = ['selected', 'other', 'draft', 'added-after-preview'].map(slug => ({ slug, title: slug }))
let outDir, requests, failToc, failDocs

beforeEach(() => {
  outDir = fs.mkdtempSync(path.join(suiteDir, 'export-'))
  requests = []
  failToc = false
  failDocs = false
  http.defaults.adapter = async config => {
    const url = new URL(config.url)
    requests.push(url.pathname)
    let data
    if (url.pathname === '/api/catalog_nodes') {
      if (failToc) throw new Error('目录接口暂不可用')
      data = { data: toc }
    } else if (url.pathname === '/api/docs') {
      if (failDocs) throw new Error('文档列表暂不可用')
      data = { data: docs }
    } else if (url.pathname.endsWith('/markdown')) data = Buffer.from(`# ${url.pathname}\n`)
    else throw new Error(`Unexpected request: ${url.pathname}`)
    return { config, data, status: 200, statusText: 'OK', headers: { 'content-type': 'text/markdown' } }
  }
})

after(() => {
  http.defaults.adapter = originalAdapter
  if (originalAppData === undefined) delete process.env.APPDATA
  else process.env.APPDATA = originalAppData
  fs.rmSync(suiteDir, { recursive: true, force: true })
})

function markdownRequests() { return requests.filter(p => p.endsWith('/markdown')) }
function exists(...segments) { return fs.existsSync(path.join(outDir, book.name, ...segments)) }

test('exports only the selected document at its original path, excluding siblings, drafts and newly added pages', async () => {
  const result = await exportBooks([{ ...book, selection: { docSlugs: ['selected'], folderKeys: [] } }], outDir, null, { downloadAssets: false })
  assert.deepEqual(markdownRequests(), ['/example/book/selected/markdown'])
  assert.equal(result.totalDocs, 1)
  assert.ok(exists('章节', '选中文档.md'))
  assert.ok(!exists('章节', '其他文档.md'))
  assert.ok(!exists('未归档'))
  assert.ok(!exists('空目录'))
  assert.ok(!exists('无关目录'))
  assert.match(fs.readFileSync(result.reportPath, 'utf8'), /按勾选范围导出 1 篇/)
})

test('exports a folder and its children without including other branches', async () => {
  const roots = Tree.buildBookTree(toc, docs)
  const selected = new Set()
  Tree.setNodeSelected(roots[0], selected, true)
  const selection = Tree.exportSelection(roots, selected)
  const result = await exportBooks([{ ...book, selection }], outDir, null, { downloadAssets: false })
  assert.equal(result.doneDocs, 2)
  assert.deepEqual(markdownRequests(), ['/example/book/selected/markdown', '/example/book/other/markdown'])
  assert.ok(!exists('未归档'))
  assert.ok(!exists('空目录'))
})

test('preserves a selected empty folder without downloading any documents', async () => {
  await exportBooks([{ ...book, selection: { docSlugs: [], folderKeys: ['toc:empty'] } }], outDir, null, { downloadAssets: false })
  assert.deepEqual(markdownRequests(), [])
  assert.ok(exists('空目录'))
  assert.ok(!exists('章节'))
})

test('retains whole-book export including unfiled documents and empty folders', async () => {
  const result = await exportBooks([book], outDir, null, { downloadAssets: false })
  assert.equal(result.doneDocs, 4)
  assert.equal(markdownRequests().length, 4)
  assert.ok(exists('未归档', 'draft.md'))
  assert.ok(exists('空目录'))
})

test('reports deleted selections instead of widening the export', async () => {
  const result = await exportBooks([{ ...book, selection: { docSlugs: ['deleted'], folderKeys: [] } }], outDir, null, { downloadAssets: false })
  assert.deepEqual(markdownRequests(), [])
  assert.match(fs.readFileSync(result.reportPath, 'utf8'), /已选文档不存在或无法访问/)
  assert.equal(result.totalDocs, 1)
  assert.equal(result.failDocs, 1)
})

test('directory failure falls back to a flat list while keeping the exact selected slug', async () => {
  failToc = true
  const result = await exportBooks([{ ...book, selection: { docSlugs: ['selected'], folderKeys: [] } }], outDir, null, { downloadAssets: false })
  assert.deepEqual(markdownRequests(), ['/example/book/selected/markdown'])
  assert.ok(exists('selected.md'))
  assert.match(fs.readFileSync(result.reportPath, 'utf8'), /按平铺文档列表/)
})

test('document list failure keeps available TOC pages and explicitly warns about missing unfiled pages', async () => {
  failDocs = true
  const catalog = await loadBookCatalog(book.id)
  assert.equal(Tree.planBookExport(catalog.roots).tasks.length, 2)
  assert.match(catalog.warnings[0], /可能缺少未归档文档/)
})

test('fails when neither catalog source can be loaded', async () => {
  failDocs = true
  failToc = true
  await assert.rejects(loadBookCatalog(book.id), /获取目录和文档列表失败/)
})
