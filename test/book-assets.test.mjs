import test, { after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const suiteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuque-book-assets-test-'))
const originalAppData = process.env.APPDATA
process.env.APPDATA = path.join(suiteDir, 'appdata')
const { http, saveCookie } = await import('../src/yuque-api.mjs')
const { localizeDocAssets } = await import('../src/book-assets.mjs')
const originalAdapter = http.defaults.adapter

const DOC_URL = 'https://www.yuque.com/example/book/document'
const VIDEO_ID = 'inputs/prod/yuque/2024/43922322/mp4/example.mp4'
const MEDIA_URL = 'https://cloud.video.taobao.com/test.mp4?auth_key=temporary'
const VIDEO_BYTES = Buffer.from('00000018667479706d703432000000006d70343269736f6d', 'hex')
const MAX_BYTES = 200 * 1024 * 1024
let caseDir
let requests
let responder

function stats() {
  return { done: 0, failed: 0, skipped: 0, notes: [], urlToPath: new Map() }
}

function context(overrides = {}) {
  const options = {
    assetsDir: path.join(caseDir, 'book', 'assets'),
    mdDir: path.join(caseDir, 'book', '章节'),
    stats: stats(),
    maxBytes: MAX_BYTES,
    docUrl: DOC_URL,
    ...overrides,
  }
  fs.mkdirSync(options.mdDir, { recursive: true })
  return options
}

function card(overrides = {}) {
  return {
    status: 'done', name: '测试用视频.mp4', size: VIDEO_BYTES.length,
    taskId: 'upload-task', taskType: 'upload', url: null, cover: null,
    videoId: VIDEO_ID, download: false, id: 'DuH55', card: 'video',
    ...overrides,
  }
}

function videoLink(data = card()) {
  return `${DOC_URL}?_lake_card=${encodeURIComponent(JSON.stringify(data))}#${data.id}`
}

function response(config, data, contentType = 'application/json') {
  return { data, status: 200, statusText: 'OK', headers: { 'content-type': contentType }, config }
}

function defaultResponder(config) {
  const url = new URL(config.url)
  if (url.hostname === 'www.yuque.com' && url.pathname === '/api/video') {
    return response(config, { data: { status: 'success', info: { video: MEDIA_URL } } })
  }
  if (config.url === MEDIA_URL) return response(config, VIDEO_BYTES, 'video/mp4')
  throw new Error(`Unexpected mocked HTTP request: ${config.url}`)
}

function assetFiles(options) {
  if (!fs.existsSync(options.assetsDir)) return []
  return fs.readdirSync(options.assetsDir).map(name => path.join(options.assetsDir, name))
}

function assertLocalReference(markdown, file, mdDir) {
  const references = []
  for (const match of markdown.matchAll(/\b(?:src|href)\s*=\s*(["'])(.*?)\1/gi)) references.push(match[2])
  for (const match of markdown.matchAll(/\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+"[^"]*")?\s*\)/g)) {
    references.push(match[1] || match[2])
  }
  const expected = path.relative(mdDir, file).split(path.sep).join('/')
  assert.ok(references.some(ref => {
    try { return decodeURIComponent(ref) === expected } catch { return false }
  }), `Expected a usable local reference to ${expected}, got: ${markdown}`)
}

beforeEach(() => {
  caseDir = fs.mkdtempSync(path.join(suiteDir, 'case-'))
  requests = []
  responder = defaultResponder
  http.defaults.adapter = async config => {
    requests.push(config)
    return responder(config)
  }
})

after(() => {
  http.defaults.adapter = originalAdapter
  if (originalAppData === undefined) delete process.env.APPDATA
  else process.env.APPDATA = originalAppData
  fs.rmSync(suiteDir, { recursive: true, force: true })
})

test('localizes an encoded Yuque video card and downloads the actual video', async () => {
  const options = context()
  const original = videoLink()
  const markdown = await localizeDocAssets(`[测试视频](${original})`, options)
  const files = assetFiles(options)
  assert.equal(files.length, 1)
  assert.deepEqual(fs.readFileSync(files[0]), VIDEO_BYTES)
  assertLocalReference(markdown, files[0], options.mdDir)
  assert.ok(!markdown.includes(original))
  assert.equal(options.stats.done, 1)
  assert.equal(options.stats.failed, 0)
  const apiRequest = requests.find(config => new URL(config.url).pathname === '/api/video')
  assert.ok(apiRequest)
  assert.equal(new URL(apiRequest.url).searchParams.get('video_id'), VIDEO_ID)
})

test('resolves old document fragment links with the matching Lake card id', async () => {
  let contentReads = 0
  const video = card({ id: 'old-video-card' })
  const options = context({ getContent: async () => {
    contentReads++
    return `<!doctype lake><p><card value="data:${encodeURIComponent(JSON.stringify(video))}" name="video"></card></p>`
  } })
  const original = `${DOC_URL}#${video.id}`
  const markdown = await localizeDocAssets(`[视频](${original})`, options)
  const files = assetFiles(options)
  assert.equal(files.length, 1)
  assertLocalReference(markdown, files[0], options.mdDir)
  assert.ok(!markdown.includes(original))
  assert.equal(contentReads, 1)
})

test('localizes several videos while downloading duplicate video references once', async () => {
  const options = context()
  const second = card({ videoId: 'inputs/prod/yuque/second.mp4', name: '第二个视频.mp4', id: 'second' })
  responder = config => {
    const url = new URL(config.url)
    if (url.pathname === '/api/video') {
      const id = url.searchParams.get('video_id')
      const media = id === VIDEO_ID ? MEDIA_URL : 'https://cloud.video.taobao.com/second.mp4'
      return response(config, { data: { status: 'success', info: { video: media } } })
    }
    return response(config, VIDEO_BYTES, 'video/mp4')
  }
  const firstUrl = videoLink()
  const secondUrl = videoLink(second)
  const markdown = await localizeDocAssets(`[一](${firstUrl})\n[二](${secondUrl})\n[重复](${firstUrl})`, options)
  const files = assetFiles(options)
  assert.equal(files.length, 2)
  assert.equal(requests.filter(config => new URL(config.url).hostname === 'cloud.video.taobao.com').length, 2)
  for (const file of files) assertLocalReference(markdown, file, options.mdDir)
  assert.ok(!markdown.includes('_lake_card'))
})

test('preserves ordinary Yuque document links without downloading them', async () => {
  const options = context({ getContent: async () => '' })
  const input = `[其他文档](https://www.yuque.com/example/book/another)\n[章节](${DOC_URL}#heading)`
  assert.equal(await localizeDocAssets(input, options), input)
  assert.equal(requests.length, 0)
  assert.equal(assetFiles(options).length, 0)
})

test('keeps the original link and records a failed video download', async () => {
  const options = context()
  responder = config => {
    if (new URL(config.url).pathname === '/api/video') return defaultResponder(config)
    throw new Error('Video download unavailable')
  }
  const input = `[视频](${videoLink()})`
  assert.equal(await localizeDocAssets(input, options), input)
  assert.equal(options.stats.failed, 1)
  assert.ok(options.stats.notes.length > 0)
  assert.equal(assetFiles(options).length, 0)
})

test('records an over-limit video as skipped and enforces the 200 MB request limit', async () => {
  const options = context()
  responder = config => {
    if (new URL(config.url).pathname === '/api/video') return defaultResponder(config)
    assert.equal(config.maxContentLength, MAX_BYTES)
    const error = new Error(`maxContentLength size of ${MAX_BYTES} exceeded`)
    error.code = 'ERR_BAD_RESPONSE'
    throw error
  }
  const input = `[视频](${videoLink()})`
  assert.equal(await localizeDocAssets(input, options), input)
  assert.equal(options.stats.skipped, 1)
  assert.equal(options.stats.failed, 0)
  assert.equal(assetFiles(options).length, 0)
})

test('stores shared video media inside each separately exported knowledge base', async () => {
  const sharedStats = stats()
  const first = context({ stats: sharedStats })
  const second = context({
    assetsDir: path.join(caseDir, 'other-book', 'assets'),
    mdDir: path.join(caseDir, 'other-book', 'chapter'), stats: sharedStats,
  })
  const input = `[视频](${videoLink()})`
  const firstMarkdown = await localizeDocAssets(input, first)
  const secondMarkdown = await localizeDocAssets(input, second)
  assert.equal(assetFiles(first).length, 1)
  assert.equal(assetFiles(second).length, 1)
  assertLocalReference(firstMarkdown, assetFiles(first)[0], first.mdDir)
  assertLocalReference(secondMarkdown, assetFiles(second)[0], second.mdDir)
  assert.equal(requests.filter(config => config.url === MEDIA_URL).length, 2)
})

test('reuses a local asset on a later export without downloading video bytes again', async () => {
  const options = context()
  const input = `[视频](${videoLink()})`
  await localizeDocAssets(input, options)
  requests.length = 0
  const rerun = { ...options, stats: stats() }
  const markdown = await localizeDocAssets(input, rerun)
  assert.equal(assetFiles(rerun).length, 1)
  assertLocalReference(markdown, assetFiles(rerun)[0], rerun.mdDir)
  assert.equal(requests.filter(config => config.url === MEDIA_URL).length, 0)
})

for (const [label, body, contentType] of [
  ['HTML', '<!doctype html><html><body>Login required</body></html>', 'text/html'],
  ['JSON', '{"success":false,"message":"permission denied"}', 'application/json'],
]) {
  test(`rejects a ${label} media error page and preserves the original video link`, async () => {
    const options = context()
    responder = config => new URL(config.url).pathname === '/api/video'
      ? defaultResponder(config) : response(config, Buffer.from(body), contentType)
    const input = `[视频](${videoLink()})`
    assert.equal(await localizeDocAssets(input, options), input)
    assert.equal(options.stats.failed, 1)
    assert.equal(assetFiles(options).length, 0)
  })
}

test('supports angle-bracket Markdown links and usable paths with Chinese names and spaces', async () => {
  const options = context()
  const original = videoLink(card({ name: '中文 视频 文件.mp4' }))
  const markdown = await localizeDocAssets(`[中文视频](<${original}>)`, options)
  const files = assetFiles(options)
  assert.equal(files.length, 1)
  assertLocalReference(markdown, files[0], options.mdDir)
  assert.ok(!markdown.includes('_lake_card'))
  assert.ok(!markdown.includes('\\'))
})

test('does not send the Yuque session cookie to the resolved external video CDN', async () => {
  saveCookie(['test-session=unit-test-only; Path=/; HttpOnly'])
  const options = context()
  await localizeDocAssets(`[视频](${videoLink()})`, options)
  const apiRequest = requests.find(config => new URL(config.url).pathname === '/api/video')
  const mediaRequest = requests.find(config => config.url === MEDIA_URL)
  assert.ok(apiRequest.headers.get('cookie')?.includes('test-session=unit-test-only'))
  assert.ok(mediaRequest)
  assert.ok(!mediaRequest.headers.get('cookie'))
})

test('leaves links inside fenced and inline code unchanged without requesting assets', async () => {
  let contentReads = 0
  const options = context({ getContent: async () => { contentReads++; return '' } })
  const link = `[示例视频](${videoLink()})`
  const image = '![示例图片](https://cdn.nlark.com/example.png)'
  const input = [
    '文档中的代码示例：',
    '```markdown',
    link,
    image,
    '```',
    `行内示例：\`${link}\`，以及 \`${image}\`。`,
  ].join('\n')
  assert.equal(await localizeDocAssets(input, options), input)
  assert.equal(requests.length, 0)
  assert.equal(contentReads, 0)
  assert.equal(assetFiles(options).length, 0)
})
