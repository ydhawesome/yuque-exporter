import test, { after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const suiteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuque-export-books-test-'))
const originalAppData = process.env.APPDATA
process.env.APPDATA = path.join(suiteDir, 'appdata')
const { http } = await import('../src/yuque-api.mjs')
const { exportBooks } = await import('../src/export-books.mjs')
const originalAdapter = http.defaults.adapter

const BOOK = { id: 42, user: 'example', slug: 'book', name: '测试知识库' }
const DOC_URL = 'https://www.yuque.com/example/book/document'
const MEDIA_URL = 'https://cloud.video.taobao.com/export-test.mp4?auth_key=temporary'
const VIDEO_BYTES = Buffer.from('00000018667479706d703432000000006d70343269736f6d', 'hex')
const CARD = {
  status: 'done', name: '本地 视频.mp4', videoId: 'inputs/prod/yuque/example.mp4',
  id: 'video-card', card: 'video', taskType: 'upload', url: null,
}
const VIDEO_LINK = `${DOC_URL}?_lake_card=${encodeURIComponent(JSON.stringify(CARD))}#${CARD.id}`
const LAKE = `<p><card name="video" value="data:${encodeURIComponent(JSON.stringify(CARD))}"></card></p>`
let outDir
let requests
let markdownBody
let mediaFailure

function response(config, data, contentType = 'application/json') {
  return { config, data, status: 200, statusText: 'OK', headers: { 'content-type': contentType } }
}

function mdPath() {
  return path.join(outDir, BOOK.name, '章节', '视频文档.md')
}

function assets() {
  const dir = path.join(outDir, BOOK.name, 'assets')
  return fs.existsSync(dir) ? fs.readdirSync(dir).map(name => path.join(dir, name)) : []
}

function countRequests(predicate) {
  return requests.filter(config => predicate(new URL(config.url))).length
}

function markdownRequests() {
  return countRequests(url => url.pathname.endsWith('/markdown'))
}

function assertLocalAssetReference(markdown) {
  const files = assets()
  assert.equal(files.length, 1)
  assert.deepEqual(fs.readFileSync(files[0]), VIDEO_BYTES)
  const expected = path.relative(path.dirname(mdPath()), files[0]).split(path.sep).join('/')
  const urls = [
    ...[...markdown.matchAll(/\b(?:src|href)\s*=\s*(["'])(.*?)\1/gi)].map(match => match[2]),
    ...[...markdown.matchAll(/\]\(\s*(?:<([^>]+)>|([^\s)]+))\s*\)/g)].map(match => match[1] || match[2]),
  ]
  assert.ok(urls.some(url => decodeURIComponent(url) === expected), `Missing local asset reference: ${markdown}`)
}

beforeEach(() => {
  outDir = fs.mkdtempSync(path.join(suiteDir, 'export-'))
  requests = []
  markdownBody = `# 原始文档\n\n[上传视频](${VIDEO_LINK})\n`
  mediaFailure = false
  http.defaults.adapter = async config => {
    requests.push(config)
    const url = new URL(config.url)
    if (url.pathname === '/api/catalog_nodes') {
      return response(config, { data: [
        { uuid: 'group', type: 'TITLE', title: '章节', visible: 1 },
        { uuid: 'doc', parent_uuid: 'group', type: 'DOC', title: '视频文档', url: 'document', visible: 1 },
      ] })
    }
    if (url.pathname === '/api/docs') {
      return response(config, { data: [{ slug: 'document', title: '视频文档', type: 'Doc' }] })
    }
    if (url.pathname === '/api/docs/document') return response(config, { data: { id: 184168882, content: LAKE } })
    if (url.pathname === '/example/book/document/markdown') {
      return response(config, Buffer.from(markdownBody), 'text/markdown; charset=utf-8')
    }
    if (url.pathname === '/api/video') {
      assert.equal(url.searchParams.get('video_id'), CARD.videoId)
      return response(config, { data: { status: 'success', info: { video: MEDIA_URL } } })
    }
    if (config.url === MEDIA_URL) {
      if (mediaFailure) throw new Error('Simulated video download failure')
      return response(config, VIDEO_BYTES, 'video/mp4')
    }
    throw new Error(`Unexpected mocked HTTP request: ${config.url}`)
  }
})

after(() => {
  http.defaults.adapter = originalAdapter
  if (originalAppData === undefined) delete process.env.APPDATA
  else process.env.APPDATA = originalAppData
  fs.rmSync(suiteDir, { recursive: true, force: true })
})

test('supplements videos in existing Markdown while preserving user text and subsequent exports reuse files', async () => {
  fs.mkdirSync(path.dirname(mdPath()), { recursive: true })
  const prefix = '# 用户修改过的标题\n\n这是用户后来补充的正文。\n\n'
  const suffix = '\n\n<!-- 用户保留的本地批注 -->\n'
  const originalUrl = `${DOC_URL}#${CARD.id}`
  fs.writeFileSync(mdPath(), `${prefix}[上传视频](${originalUrl})${suffix}`)

  const result = await exportBooks([BOOK], outDir, undefined, { downloadAssets: true })
  const updated = fs.readFileSync(mdPath(), 'utf8')
  assert.ok(updated.startsWith(prefix))
  assert.ok(updated.endsWith(suffix))
  assert.ok(!updated.includes(originalUrl))
  assertLocalAssetReference(updated)
  assert.equal(markdownRequests(), 0)
  assert.equal(countRequests(url => url.pathname === '/api/docs/document'), 1)
  assert.equal(result.doneDocs, 1)
  assert.equal(result.failDocs, 0)

  requests.length = 0
  await exportBooks([BOOK], outDir, undefined, { downloadAssets: true })
  assert.equal(fs.readFileSync(mdPath(), 'utf8'), updated)
  assert.equal(markdownRequests(), 0)
  assert.equal(countRequests(url => url.hostname === 'cloud.video.taobao.com'), 0)
  assert.equal(countRequests(url => url.pathname === '/api/video'), 0)
})

test('can add local videos after an earlier export with asset downloads disabled', async () => {
  await exportBooks([BOOK], outDir, undefined, { downloadAssets: false })
  assert.equal(fs.readFileSync(mdPath(), 'utf8'), markdownBody)
  assert.equal(assets().length, 0)
  assert.equal(countRequests(url => url.pathname === '/api/video'), 0)

  requests.length = 0
  const result = await exportBooks([BOOK], outDir, undefined, { downloadAssets: true })
  const updated = fs.readFileSync(mdPath(), 'utf8')
  assert.ok(updated.startsWith('# 原始文档\n\n'))
  assert.ok(!updated.includes('_lake_card'))
  assertLocalAssetReference(updated)
  assert.equal(markdownRequests(), 0)
  assert.equal(result.assets.failed, 0)
  assert.equal(result.doneDocs, 1)
})

test('selective export downloads videos referenced by the canonical numeric document alias', async () => {
  markdownBody = '[此处为语雀卡片，点击链接查看](https://www.yuque.com/docs/184168882#video-card)\n'
  const selectedBook = { ...BOOK, selection: { docSlugs: ['document'], folderKeys: [] } }
  const result = await exportBooks([selectedBook], outDir, undefined, { downloadAssets: true })
  assertLocalAssetReference(fs.readFileSync(mdPath(), 'utf8'))
  assert.equal(result.assets.done, 1)
  assert.equal(result.assets.failed, 0)
  assert.equal(countRequests(url => url.pathname === '/api/docs/document'), 1)
  assert.equal(markdownRequests(), 1)
})

test('repairs canonical video links in an existing export and preserves edited Markdown on repeated runs', async () => {
  fs.mkdirSync(path.dirname(mdPath()), { recursive: true })
  const prefix = '# 用户补充内容\n\n'
  const suffix = '\n\n<!-- 保留本地批注 -->\n'
  fs.writeFileSync(mdPath(), `${prefix}[语雀视频](https://www.yuque.com/docs/184168882#video-card)${suffix}`)
  await exportBooks([BOOK], outDir, undefined, { downloadAssets: true })
  const updated = fs.readFileSync(mdPath(), 'utf8')
  assert.ok(updated.startsWith(prefix))
  assert.ok(updated.endsWith(suffix))
  assertLocalAssetReference(updated)
  assert.equal(markdownRequests(), 0)
  requests.length = 0
  await exportBooks([BOOK], outDir, undefined, { downloadAssets: true })
  assert.equal(fs.readFileSync(mdPath(), 'utf8'), updated)
  assert.equal(countRequests(url => url.pathname === '/api/docs/document' || url.pathname === '/api/video' || url.hostname === 'cloud.video.taobao.com'), 0)
})

test('retains a failed video link and supplements it successfully on the next export', async () => {
  mediaFailure = true
  const first = await exportBooks([BOOK], outDir, undefined, { downloadAssets: true })
  assert.equal(fs.readFileSync(mdPath(), 'utf8'), markdownBody)
  assert.equal(assets().length, 0)
  assert.equal(first.assets.failed, 1)
  assert.ok(fs.readFileSync(first.reportPath, 'utf8').includes('附件下载失败'))

  requests.length = 0
  mediaFailure = false
  const second = await exportBooks([BOOK], outDir, undefined, { downloadAssets: true })
  assertLocalAssetReference(fs.readFileSync(mdPath(), 'utf8'))
  assert.equal(second.assets.failed, 0)
  assert.equal(markdownRequests(), 0)
  assert.equal(countRequests(url => url.hostname === 'cloud.video.taobao.com'), 1)
})

test('does not request video metadata, Lake content or CDN media when asset downloads are disabled', async () => {
  markdownBody += `\n[旧式视频](${DOC_URL}#${CARD.id})\n`
  const first = await exportBooks([BOOK], outDir, undefined, { downloadAssets: false })
  assert.equal(fs.readFileSync(mdPath(), 'utf8'), markdownBody)
  assert.equal(first.doneDocs, 1)
  assert.equal(markdownRequests(), 1)
  assert.equal(countRequests(url => url.pathname === '/api/video'), 0)
  assert.equal(countRequests(url => url.pathname === '/api/docs/document'), 0)
  assert.equal(countRequests(url => url.hostname === 'cloud.video.taobao.com'), 0)
  assert.equal(assets().length, 0)

  requests.length = 0
  await exportBooks([BOOK], outDir, undefined, { downloadAssets: false })
  assert.equal(fs.readFileSync(mdPath(), 'utf8'), markdownBody)
  assert.equal(markdownRequests(), 0)
  assert.equal(countRequests(url => url.pathname === '/api/video' || url.pathname === '/api/docs/document'), 0)
})

test('skips existing ZIP exports without downloading the document again', async () => {
  fs.mkdirSync(path.dirname(mdPath()), { recursive: true })
  const zip = mdPath().replace(/\.md$/, '.zip')
  const contents = Buffer.from('PK\x03\x04existing-archive')
  fs.writeFileSync(zip, contents)
  const result = await exportBooks([BOOK], outDir, undefined, { downloadAssets: true })
  assert.deepEqual(fs.readFileSync(zip), contents)
  assert.ok(!fs.existsSync(mdPath()))
  assert.equal(markdownRequests(), 0)
  assert.equal(countRequests(url => url.pathname === '/api/video' || url.pathname === '/api/docs/document'), 0)
  assert.equal(countRequests(url => url.hostname === 'cloud.video.taobao.com'), 0)
  assert.equal(result.doneDocs, 1)
  assert.equal(result.failDocs, 0)
  assert.ok(fs.readFileSync(result.reportPath, 'utf8').includes('.zip 已存在，跳过'))
})
