// 语雀 API 层：登录/Cookie/小记/知识库
import axios from 'axios'
import fs from 'fs'
import path from 'path'
import JSEncrypt from 'jsencrypt-node'

const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCfwyOyncSrUTmkaUPsXT6UUdXx
TQ6a0wgPShvebfwq8XeNj575bUlXxVa/ExIn4nOUwx6iR7vJ2fvz5Ls750D051S7
q70sevcmc8SsBNoaMQtyF/gETPBSsyWv3ccBJFrzZ5hxFdlVUfg6tXARtEI8rbIH
su6TBkVjk+n1Pw/ihQIDAQAB
-----END PUBLIC KEY-----`

export function encrypt(password) {
  const enc = new JSEncrypt()
  enc.setPublicKey(PUBLIC_KEY)
  const result = enc.encrypt(Date.now() + ':' + password)
  if (!result) throw new Error('密码加密失败，请重试')
  return result
}

const HOST = 'https://www.yuque.com'
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/20G81 YuqueMobileApp/1.0.2 (AppBuild/650 Device/Phone Locale/zh-cn Theme/light YuqueType/public)'
const COOKIE_TTL = 86400000  // 24h

// 语雀为国内站点，走系统/环境变量代理（如 Clash）常被阿里云防护拦截导致超时，
// 因此固定直连，忽略 HTTP(S)_PROXY 环境变量
export const http = axios.create({ proxy: false })

// ─── 数据目录 %APPDATA%\yuque-exporter\ ─────────────────────────────
function dataDir() {
  const base = process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming')
  const d = path.join(base, 'yuque-exporter')
  fs.mkdirSync(d, { recursive: true })
  return d
}
export const cookieFile   = () => path.join(dataDir(), 'cookies.json')
export const userInfoFile = () => path.join(dataDir(), 'userinfo.json')

// ─── Cookie helpers ─────────────────────────────────────────────────
export function readCookie() {
  try { return JSON.parse(fs.readFileSync(cookieFile(), 'utf8')) } catch { return null }
}
export function saveCookie(setCookieArray) {
  fs.writeFileSync(cookieFile(), JSON.stringify({
    data: setCookieArray,
    expired: Date.now() + COOKIE_TTL,
  }))
}

// 把 set-cookie 数组 → "key=val; key2=val2" 请求头
function cookieStr() {
  const ck = readCookie()
  if (!ck?.data) return ''
  const arr = Array.isArray(ck.data) ? ck.data : [String(ck.data)]
  return arr.map((c) => c.split(';')[0].trim()).filter(Boolean).join('; ')
}

// ─── Login status ───────────────────────────────────────────────────
export function checkLogin() {
  const ck = readCookie()
  if (!ck?.data) return { ok: false, reason: '未登录' }
  if (ck.expired < Date.now()) return { ok: false, reason: 'Cookie 已过期，请重新登录' }
  try {
    const info = JSON.parse(fs.readFileSync(userInfoFile(), 'utf8'))
    return { ok: true, name: info.name || info.login || '' }
  } catch { return { ok: true, name: '' } }
}

// ─── Login ──────────────────────────────────────────────────────────
export async function login(userName, password) {
  const enc = encrypt(password)
  const resp = await http.post(
    `${HOST}/api/mobile_app/accounts/login?language=zh-cn`,
    { login: userName, password: enc, loginType: 'password' },
    {
      headers: {
        'content-type': 'application/json',
        'x-requested-with': 'XMLHttpRequest',
        referer: `${HOST}/login?goto=https%3A%2F%2Fwww.yuque.com%2Fdashboard`,
        origin: HOST,
        'user-agent': UA,
      },
    }
  )
  // 接口返回 { data: { ok, me } }，部分老版本直接返回 { ok, me }，两种都兼容
  const body = resp.data?.data ?? resp.data ?? {}
  if (!body.ok) {
    throw new Error(body.message || resp.data?.message || '账号或密码错误，请检查后重试')
  }
  const setCookie = resp.headers['set-cookie']
  if (setCookie?.length) saveCookie(setCookie)
  const me = body.me || {}
  fs.writeFileSync(userInfoFile(), JSON.stringify({ ...me, savedAt: Date.now() }))
  return me.name || me.login || userName
}

// ─── Authenticated GET ──────────────────────────────────────────────
async function apiGet(url) {
  const resp = await http.get(`${HOST}${url}`, {
    headers: {
      'content-type': 'application/json',
      'x-requested-with': 'XMLHttpRequest',
      cookie: cookieStr(),
      'user-agent': UA,
    },
  })
  return resp.data
}

// ─── Notes API ──────────────────────────────────────────────────────
export async function getNotesBatch(offset, limit = 50) {
  return apiGet(
    `/api/modules/note/notes/NoteController/index?offset=${offset}&q=&filter_type=all&status=0&merge_dynamic_data=0&order=content_updated_at&with_pinned_notes=true&limit=${limit}`
  )
}

// ─── Books API ──────────────────────────────────────────────────────
export async function getBookStacks() {
  const [personal, collab] = await Promise.allSettled([
    apiGet('/api/mine/book_stacks'),
    apiGet('/api/mine/raw_collab_books'),
  ])
  const personalBooks = personal.status === 'fulfilled'
    ? (personal.value.data || []).flatMap((s) => s.books || [])
    : []
  const collabBooks = collab.status === 'fulfilled'
    ? (collab.value.data || [])
    : []
  return [...personalBooks, ...collabBooks].map((b) => ({
    id: b.id, slug: b.slug, name: b.name,
    user: b.user?.login || '',
  }))
}

export async function getDocsOfBook(bookId) {
  const d = await apiGet(`/api/docs?book_id=${encodeURIComponent(bookId)}`)
  if (!Array.isArray(d?.data)) throw new Error('获取文档列表失败，请检查登录状态或知识库权限')
  return d.data
}

// 知识库目录树节点（type: DOC/TITLE/LINK，含 uuid/parent_uuid/level）
export async function getBookToc(bookId) {
  const d = await apiGet(`/api/catalog_nodes?book_id=${encodeURIComponent(bookId)}`)
  if (!Array.isArray(d?.data)) throw new Error('获取目录结构失败，请检查登录状态或知识库权限')
  return d.data
}

// Markdown 中只有卡片锚点的旧式音视频，需要从 Lake 正文中补取资源 ID。
export async function getDocContent(bookId, slug) {
  const d = await apiGet(`/api/docs/${encodeURIComponent(slug)}?book_id=${encodeURIComponent(bookId)}`)
  const content = d?.data?.content ?? d?.data?.body_lake
  if (typeof content !== 'string') throw new Error('获取文档正文失败，无法解析视频卡片')
  return content
}

// 语雀视频卡片的 videoId 不是可下载的 URL，必须先换取实际媒体地址。
export async function getVideoInfo(videoId) {
  if (typeof videoId !== 'string' || !videoId.trim()) throw new Error('视频资源 ID 为空')
  const d = await apiGet(`/api/video?video_id=${encodeURIComponent(videoId.trim())}`)
  const data = d?.data
  if (!data || (data.status && data.status !== 'success')) {
    throw new Error('获取视频地址失败，请检查登录状态或视频权限')
  }
  const info = data.info
  const url = info?.video || info?.url
  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error()
  } catch {
    throw new Error('语雀未返回有效的视频下载地址')
  }
  return { url, name: typeof info.name === 'string' ? info.name : '' }
}

// ─── Image download ─────────────────────────────────────────────────
export async function downloadImage(url) {
  const resp = await http.get(url, {
    responseType: 'arraybuffer',
    headers: { referer: 'https://www.yuque.com/', 'user-agent': UA },
    timeout: 30000,
  })
  return Buffer.from(resp.data)
}

// ─── Asset download（图片/视频/附件通用）──────────────────────────────
// 跟 downloadImage 的区别：超时放宽（视频可能几十 MB）、带上 cookie（部分
// 私有知识库的附件需要登录态）、并把 content-type 一起返回用于推断扩展名
export async function downloadAsset(url, timeout = 120000, maxBytes = 0) {
  let parsed
  try { parsed = new URL(url) } catch { throw new Error('附件下载地址无效') }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('附件下载地址必须使用 HTTP 或 HTTPS')
  const trustedHost = (host) => /(^|\.)(yuque\.com|nlark\.com)$/i.test(host)
  const headers = { referer: `${HOST}/`, 'user-agent': UA }
  if (trustedHost(parsed.hostname)) headers.cookie = cookieStr()
  const limit = Number.isFinite(maxBytes) && maxBytes > 0 ? maxBytes : Infinity
  let resp
  try {
    resp = await http.get(url, {
      responseType: 'arraybuffer',
      headers,
      timeout,
      maxContentLength: limit,
      maxBodyLength: Infinity,
      beforeRedirect(options) {
        // 视频可能由独立 CDN 提供，跳转时不向第三方转发语雀登录态。
        if (!trustedHost(options.hostname || '')) {
          for (const name of Object.keys(options.headers || {})) {
            if (name.toLowerCase() === 'cookie') delete options.headers[name]
          }
        }
      },
    })
  } catch (e) {
    if (limit !== Infinity && /maxContentLength.*exceeded/i.test(e.message || '')) {
      const error = new Error(`附件超过大小上限（${(limit / 1048576).toFixed(1)}MB）`)
      error.code = 'ASSET_TOO_LARGE'
      throw error
    }
    throw e
  }
  const buf = Buffer.from(resp.data)
  if (!buf.length) throw new Error('附件返回了空内容，请稍后重试')
  // 除了网络适配器的流量限制，也覆盖测试适配器和其他返回已缓冲数据的适配器。
  if (buf.length > limit) {
    const error = new Error(`附件超过大小上限（${(limit / 1048576).toFixed(1)}MB）`)
    error.code = 'ASSET_TOO_LARGE'
    throw error
  }
  const contentType = (resp.headers['content-type'] || '').split(';')[0].trim().toLowerCase()
  const prefix = buf.subarray(0, 1024).toString('utf8').trimStart()
  const isHtml = ['text/html', 'application/xhtml+xml'].includes(contentType)
    || /^<!doctype\s+html\b|^<html\b/i.test(prefix)
  // JSON 可以是用户上传的合法附件，是否适合作为视频由调用方单独验证。
  if (isHtml) throw new Error('附件返回了网页，请检查登录状态或附件权限')
  return { buf, contentType }
}
