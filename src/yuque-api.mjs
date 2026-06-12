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
  const resp = await axios.post(
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
  const resp = await axios.get(`${HOST}${url}`, {
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
  const d = await apiGet(`/api/docs?book_id=${bookId}`)
  return d.data || []
}

// ─── Image download ─────────────────────────────────────────────────
export async function downloadImage(url) {
  const resp = await axios.get(url, {
    responseType: 'arraybuffer',
    headers: { referer: 'https://www.yuque.com/', 'user-agent': UA },
    timeout: 30000,
  })
  return Buffer.from(resp.data)
}
