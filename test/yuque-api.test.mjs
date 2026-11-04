import test, { after, afterEach, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import nodeHttp from 'node:http'

const suiteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuque-api-test-'))
const originalAppData = process.env.APPDATA
process.env.APPDATA = path.join(suiteDir, 'appdata')
const { http, saveCookie, getVideoInfo, getDocContent, getBookToc, getDocsOfBook, downloadAsset } = await import('../src/yuque-api.mjs')
const originalAdapter = http.defaults.adapter
const originalHttpAgent = http.defaults.httpAgent
const VIDEO_ID = 'inputs/prod/yuque/2024/example video.mp4'
const MEDIA_URL = 'https://cloud.video.taobao.com/example.mp4?auth_key=fixture'
const VIDEO_BYTES = Buffer.from('00000018667479706d703432000000006d70343269736f6d', 'hex')
let requests
let responder
let server
let agent

function response(config, data, contentType = 'application/json') {
  return { data, headers: { 'content-type': contentType }, status: 200, statusText: 'OK', config }
}

beforeEach(() => {
  requests = []
  server = null
  agent = null
  saveCookie(['fixture-session=offline-only; Path=/; HttpOnly'])
  responder = config => response(config, { data: { status: 'success', info: { video: MEDIA_URL } } })
  http.defaults.adapter = async config => {
    requests.push(config)
    return responder(config)
  }
})

afterEach(async () => {
  http.defaults.adapter = originalAdapter
  http.defaults.httpAgent = originalHttpAgent
  if (agent) agent.destroy()
  if (server) await new Promise(resolve => server.close(resolve))
})

after(() => {
  if (originalAppData === undefined) delete process.env.APPDATA
  else process.env.APPDATA = originalAppData
  if (path.dirname(suiteDir) !== os.tmpdir() || !path.basename(suiteDir).startsWith('yuque-api-test-')) {
    throw new Error('Unexpected temporary test directory')
  }
  fs.rmSync(suiteDir, { recursive: true, force: true })
})

test('fetches the actual video URL, encodes the complete videoId and uses the local session', async () => {
  responder = config => response(config, { data: { status: 'success', info: { video: MEDIA_URL, name: '演示.mp4' } } })
  assert.deepEqual(await getVideoInfo(VIDEO_ID), { url: MEDIA_URL, name: '演示.mp4' })
  assert.equal(requests[0].url, `https://www.yuque.com/api/video?video_id=${encodeURIComponent(VIDEO_ID)}`)
  assert.equal(requests[0].headers.get('cookie'), 'fixture-session=offline-only')
})

test('accepts the older info.url response shape', async () => {
  responder = config => response(config, { data: { info: { url: MEDIA_URL } } })
  assert.deepEqual(await getVideoInfo('old-video-id'), { url: MEDIA_URL, name: '' })
})

test('rejects an empty videoId without sending an HTTP request', async () => {
  for (const id of ['', '   ', null, undefined]) await assert.rejects(getVideoInfo(id), /资源 ID 为空/)
  assert.equal(requests.length, 0)
})

test('reports failed or missing video API data', async () => {
  for (const data of [{ data: { status: 'failed' } }, {}, null]) {
    responder = config => response(config, data)
    await assert.rejects(getVideoInfo(VIDEO_ID), /获取视频地址失败/)
  }
})

test('rejects missing or non-HTTP video download URLs', async () => {
  for (const url of ['', 'javascript:alert(1)', 'file:///tmp/test.mp4', undefined]) {
    responder = config => response(config, { data: { status: 'success', info: { video: url } } })
    await assert.rejects(getVideoInfo(VIDEO_ID), /有效的视频下载地址/)
  }
})

test('gets Lake content using an encoded document slug and knowledge base id', async () => {
  const lake = '<card name="video" value="data:fixture"></card>'
  responder = config => response(config, { data: { content: lake } })
  assert.equal(await getDocContent('book id', 'slug/with space'), lake)
  assert.equal(requests[0].url, 'https://www.yuque.com/api/docs/slug%2Fwith%20space?book_id=book%20id')
})

test('accepts body_lake and rejects a document response without Lake content', async () => {
  responder = config => response(config, { data: { body_lake: '<!doctype lake>' } })
  assert.equal(await getDocContent(1, 'doc'), '<!doctype lake>')
  for (const data of [{ data: {} }, null]) {
    responder = config => response(config, data)
    await assert.rejects(getDocContent(1, 'doc'), /获取文档正文失败/)
  }
})

test('loads catalog lists with encoded book ids and rejects login or permission responses', async () => {
  responder = config => response(config, { data: [] })
  assert.deepEqual(await getBookToc('book id'), [])
  assert.equal(requests.at(-1).url, 'https://www.yuque.com/api/catalog_nodes?book_id=book%20id')
  assert.deepEqual(await getDocsOfBook('book id'), [])
  assert.equal(requests.at(-1).url, 'https://www.yuque.com/api/docs?book_id=book%20id')
  for (const data of [{ message: 'login required' }, { data: null }, { data: {} }]) {
    responder = config => response(config, data)
    await assert.rejects(getBookToc(42), /获取目录结构失败/)
    await assert.rejects(getDocsOfBook(42), /获取文档列表失败/)
  }
})

test('downloads media bytes and normalizes MIME without sending the session to an external CDN', async () => {
  responder = config => response(config, VIDEO_BYTES, 'video/mp4; charset=binary')
  const result = await downloadAsset(MEDIA_URL)
  assert.deepEqual(result.buf, VIDEO_BYTES)
  assert.equal(result.contentType, 'video/mp4')
  assert.ok(!requests[0].headers.get('cookie'))
})

test('sends the session to trusted Yuque attachment hosts, but not similar-looking domains', async () => {
  responder = config => response(config, VIDEO_BYTES, 'video/mp4')
  for (const host of ['www.yuque.com', 'cdn.nlark.com']) {
    await downloadAsset(`https://${host}/attachments/video.mp4`)
    assert.equal(requests.at(-1).headers.get('cookie'), 'fixture-session=offline-only')
  }
  for (const host of ['cdn.nlark.com.example.test', 'yuque.com.example.test']) {
    await downloadAsset(`https://${host}/video.mp4`)
    assert.ok(!requests.at(-1).headers.get('cookie'))
  }
})

test('rejects an empty download instead of treating a zero-byte file as a successful asset', async () => {
  responder = config => response(config, Buffer.alloc(0), 'video/mp4')
  await assert.rejects(downloadAsset(MEDIA_URL), /空内容/)
})

test('preserves legitimate JSON attachments regardless of application-specific status and code fields', async () => {
  const data = Buffer.from('{"status":"draft","code":123,"message":"login example","data":[1,2]}')
  responder = config => response(config, data, 'application/json')
  assert.deepEqual((await downloadAsset('https://cdn.nlark.com/data.json')).buf, data)
})

test('rejects HTML login pages identified by MIME or by their contents', async () => {
  for (const type of ['text/html', 'application/xhtml+xml', 'application/octet-stream']) {
    responder = config => response(config, Buffer.from('<!DOCTYPE html><html>Login</html>'), type)
    await assert.rejects(downloadAsset(MEDIA_URL), /返回了网页/)
  }
})

test('enforces the configured limit for a buffered response returned by an adapter', async () => {
  responder = config => response(config, VIDEO_BYTES, 'video/mp4')
  await assert.rejects(downloadAsset(MEDIA_URL, 120000, 8), { code: 'ASSET_TOO_LARGE' })
  assert.equal(requests[0].maxContentLength, 8)
})

test('rejects unsupported download protocols before sending any request', async () => {
  for (const url of ['file:///tmp/video.mp4', 'data:text/plain,fixture', 'invalid']) {
    await assert.rejects(downloadAsset(url), /下载地址/)
  }
  assert.equal(requests.length, 0)
})

async function listen(handler) {
  http.defaults.adapter = originalAdapter
  server = nodeHttp.createServer(handler)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return server.address().port
}

test('aborts a real local HTTP response when its bytes exceed maxContentLength', async () => {
  const port = await listen((_req, res) => {
    res.writeHead(200, { 'content-type': 'video/mp4' })
    res.end(Buffer.alloc(8192))
  })
  await assert.rejects(downloadAsset(`http://127.0.0.1:${port}/video.mp4`, 2000, 64), { code: 'ASSET_TOO_LARGE' })
})

test('strips the session on a real Yuque-to-CDN redirect, with all hosts mapped to a local test server', async () => {
  const seen = []
  const port = await listen((req, res) => {
    seen.push({ path: req.url, cookie: req.headers.cookie })
    if (req.url === '/start') {
      res.writeHead(302, { location: `http://cdn.example.test:${server.address().port}/video.mp4` })
      res.end()
    } else {
      res.writeHead(200, { 'content-type': 'video/mp4' })
      res.end(VIDEO_BYTES)
    }
  })
  agent = new nodeHttp.Agent({
    lookup(_hostname, options, callback) {
      if (options.all) callback(null, [{ address: '127.0.0.1', family: 4 }])
      else callback(null, '127.0.0.1', 4)
    },
  })
  http.defaults.httpAgent = agent
  assert.deepEqual((await downloadAsset(`http://www.yuque.com:${port}/start`, 2000)).buf, VIDEO_BYTES)
  assert.deepEqual(seen, [
    { path: '/start', cookie: 'fixture-session=offline-only' },
    { path: '/video.mp4', cookie: undefined },
  ])
})
