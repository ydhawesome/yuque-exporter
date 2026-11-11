// 知识库资源本地化：普通附件直链，以及需要解析 videoId 的语雀视频卡片。
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { downloadAsset, getVideoInfo } from './yuque-api.mjs'

const LINK_RE = /(!?)\[([^\]\n]*)\]\(\s*(?:<([^>\n]+)>|((?:\\.|[^\s()\\]|\((?:\\.|[^()\\])*\))+))(?:\s+"[^"\n]*")?\s*\)/g
const MIME_EXT = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp',
  'image/svg+xml': '.svg', 'image/bmp': '.bmp',
  'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/x-msvideo': '.avi', 'video/webm': '.webm',
  'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/mp4': '.m4a',
  'application/pdf': '.pdf', 'application/zip': '.zip',
  'application/msword': '.doc', 'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
}

function isYuque(url) { return /(^|\.)yuque\.com$/i.test(url.hostname) }
function isAssetUrl(url) {
  return /(^|\.)nlark\.com$/i.test(url.hostname)
    || (isYuque(url) && url.pathname.startsWith('/attachments/'))
}

function parseCard(value) {
  // 格式参考：https://github.com/gxr404/yuque-dl/blob/main/src/download/video.ts
  // URLSearchParams 已解码一层；兼容 Lake 的 data: 和重复 URL 编码。
  let text = value.replace(/^data:/, '')
  for (let i = 0; i < 3; i++) {
    try { return JSON.parse(text) } catch {}
    try {
      const decoded = decodeURIComponent(text)
      if (decoded === text) break
      text = decoded
    } catch { break }
  }
  throw new Error('视频卡片信息损坏，无法解析')
}

function videoCard(card) {
  return card && typeof card === 'object' && (card.card === 'video' || typeof card.videoId === 'string')
}

function lakeVideos(lake) {
  const result = new Map()
  for (const [tag] of lake.matchAll(/<card\b[^>]*>/gi)) {
    const attrs = new Map([...tag.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)]
      .map((m) => [m[1].toLowerCase(), m[2] ?? m[3]]))
    if (attrs.get('name')?.toLowerCase() !== 'video') continue
    try {
      const card = parseCard((attrs.get('value') || '').replace(/&quot;/g, '"').replace(/&amp;/g, '&'))
      if (card.id && videoCard(card)) result.set(String(card.id), card)
    } catch { /* 单张坏卡片不影响其他视频。 */ }
  }
  return result
}

function safeName(name) {
  return String(name).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim().replace(/[. ]+$/, '').slice(0, 100) || 'asset'
}

function assetName(key, url, title, contentType, video) {
  let base = ''
  try { base = decodeURIComponent(new URL(url).pathname.split('/').pop() || '') } catch {}
  if (video && title) base = title
  else if ((!base || !path.extname(base)) && path.extname(title || '')) base = title
  base = safeName(base)
  if (!path.extname(base)) base += MIME_EXT[contentType] || (video ? '.mp4' : '.bin')
  return `${crypto.createHash('md5').update(key).digest('hex').slice(0, 8)}-${base}`
}

function cachedPath(assetsDir, key, video) {
  if (!fs.existsSync(assetsDir)) return null
  const prefix = crypto.createHash('md5').update(key).digest('hex').slice(0, 8) + '-'
  for (const entry of fs.readdirSync(assetsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.startsWith(prefix)) continue
    if (video && !/\.(mp4|m4v|mov|webm|avi|mkv|ogv)$/i.test(entry.name)) continue
    const candidate = path.join(assetsDir, entry.name)
    if (fs.statSync(candidate).size) return candidate
  }
  return null
}

function relativeUrl(mdDir, file) {
  return path.relative(mdDir, file).split(path.sep)
    .map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (ch) => '%' + ch.charCodeAt(0).toString(16).toUpperCase()))
    .join('/')
}

const VIDEO_EXT_RE = /\.(mp4|m4v|mov|webm|ogv|avi|mkv)$/i
const VIDEO_MIME = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime',
  '.webm': 'video/webm', '.ogv': 'video/ogg', '.avi': 'video/x-msvideo', '.mkv': 'video/x-matroska',
}

function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function videoEmbed(mdDir, file, title) {
  // HTML 属性可以直接保留中文、全角标点和空格；仅编码有 URL 语义的文件名字符。
  const relative = path.relative(mdDir, file).split(path.sep).join('/')
  const src = escapeHtml(relative.replace(/[%#?]/g, ch => '%' + ch.charCodeAt(0).toString(16).toUpperCase()))
  const name = title && !/此处为语雀卡片|点击链接查看/.test(title)
    ? title : path.basename(file).replace(/^[0-9a-f]{8}-/i, '')
  const label = escapeHtml(name)
  return [
    '<video controls preload="metadata" style="max-width: 100%; height: auto;">',
    `  <source src="${src}" type="${VIDEO_MIME[path.extname(file).toLowerCase()]}">`,
    `  <a href="${src}">打开视频：${label}</a>`,
    '</video>',
    // 放在播放器外，阅读器禁用 video 或编解码器不支持时依然有可见的打开入口。
    `<p><a href="${src}">打开视频：${label}</a></p>`,
  ].join('\n')
}

function existingLocalVideo(original, mdDir, assetsDir) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(original) || /^[\\/#]/.test(original)) return null
  const raw = original.replace(/&amp;/g, '&')
  const candidates = [raw]
  try { candidates.unshift(decodeURIComponent(raw)) } catch {}
  for (const candidate of candidates) {
    const file = path.resolve(mdDir, candidate)
    const relative = path.relative(path.resolve(assetsDir), file)
    if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) continue
    if (!VIDEO_EXT_RE.test(file)) continue
    try { const stat = fs.statSync(file); if (stat.isFile() && stat.size) return file } catch {}
  }
  return null
}

function embedReplacement(md, match, text) {
  // 以独立 HTML 块输出，避免阅读器将它吞进原段落或按普通 Markdown 文字展示。
  const before = md.slice(0, match.index)
  const after = md.slice(match.index + match[0].length)
  return { start: match.index, end: match.index + match[0].length,
    text: (before && !/\n\s*\n$/.test(before) ? '\n\n' : '') + text
      + (after && !/^\s*\n\s*\n/.test(after) ? '\n\n' : '') }
}

function codeRanges(md) {
  const ranges = []
  let fence = null
  let position = 0
  for (const line of md.split(/(?<=\n)/)) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/)
    if (!fence && marker) fence = { start: position, marker: marker[1] }
    else if (fence && marker && marker[1][0] === fence.marker[0]
      && marker[1].length >= fence.marker.length && /^\s*$/.test(line.slice(marker[0].length))) {
      ranges.push([fence.start, position + line.length])
      fence = null
    }
    position += line.length
  }
  if (fence) ranges.push([fence.start, md.length])
  // 行内代码支持任意数量的反引号，且不跨越 fenced code。
  const ticks = /`+/g
  let opening
  while ((opening = ticks.exec(md))) {
    if (ranges.some(([start, end]) => opening.index >= start && opening.index < end)) continue
    let closing
    while ((closing = ticks.exec(md))) {
      if (closing[0].length !== opening[0].length) continue
      ranges.push([opening.index, ticks.lastIndex])
      break
    }
    if (!closing) ticks.lastIndex = opening.index + opening[0].length
  }
  return ranges
}

async function retryNetwork(fn) {
  for (let attempt = 1; ; attempt++) {
    try { return await fn() } catch (error) {
      const status = error.response?.status
      const retryable = ['ECONNRESET', 'ECONNABORTED', 'ETIMEDOUT', 'EAI_AGAIN'].includes(error.code)
        || status === 429 || status >= 500
      if (!retryable || attempt === 3) throw error
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt))
    }
  }
}

// getContent 按需获取 Lake 和文档 ID；兼容已有调用方只返回 Lake 字符串。
export async function localizeDocAssets(md, { assetsDir, mdDir, stats, maxBytes = 0, docUrl, getContent }) {
  const links = [...md.matchAll(LINK_RE)]
  const ignored = codeRanges(md)
  const replacements = []
  let videos
  let contentDocId
  let contentError
  const attempted = new Map()
  for (const match of links) {
    if (ignored.some(([start, end]) => match.index >= start && match.index < end)) continue
    const original = match[3] ?? match[4]
    // v1.2.1 已下载的本地视频也能直接升级为播放器，不必请求视频接口或重下载。
    const existing = !match[1] && existingLocalVideo(original, mdDir, assetsDir)
    if (existing) {
      replacements.push(embedReplacement(md, match, videoEmbed(mdDir, existing, match[2])))
      continue
    }
    let url
    try { url = new URL(original.replace(/&amp;/g, '&'), docUrl) } catch { continue }
    if (!['https:', 'http:'].includes(url.protocol)) continue
    let card = null
    try {
      if (isYuque(url) && url.searchParams.has('_lake_card')) {
        const parsed = parseCard(url.searchParams.get('_lake_card'))
        if (videoCard(parsed)) card = parsed
      } else if (getContent && url.hash && docUrl) {
        const current = new URL(docUrl)
        const samePath = url.pathname.replace(/\/$/, '') === current.pathname.replace(/\/$/, '')
        const canonical = url.pathname.match(/^\/docs\/(\d+)\/?$/)
        if (isYuque(url) && url.origin === current.origin && (samePath || canonical)) {
          if (!videos) {
            try {
              const detail = await retryNetwork(getContent)
              const lake = typeof detail === 'string' ? detail : detail?.content
              if (typeof lake !== 'string') throw new Error('获取文档正文失败，无法解析视频卡片')
              contentDocId = typeof detail === 'object' && detail ? detail.id : null
              videos = lakeVideos(lake)
            }
            catch (error) { videos = new Map(); contentError = error }
          }
          if (contentError) throw contentError
          // 只有当前文档的数字别名才能匹配它的卡片，避免改写其他文档中的同名锚点。
          if (!samePath && String(contentDocId) !== canonical[1]) continue
          card = videos.get(decodeURIComponent(url.hash.slice(1))) || null
        }
      }
      if (!card && !isAssetUrl(url)) continue
      if (card && !card.videoId) throw new Error('视频卡片缺少 videoId')
      const key = card ? `video:${card.videoId}` : url.href
      const cacheKey = `${path.resolve(assetsDir)}\0${key}`
      let localPath = stats.urlToPath.get(cacheKey)
      if (localPath && !fs.existsSync(localPath)) localPath = null
      if (!localPath && attempted.has(key)) localPath = attempted.get(key)
      else if (!localPath) {
        // videoId 做缓存键，不受 CDN 临时签名变化影响；每个知识库各存一份。
        localPath = cachedPath(assetsDir, key, !!card)
        if (!localPath) {
          const info = card ? await retryNetwork(() => getVideoInfo(card.videoId)) : null
          const source = info?.url || url.href
          const { buf, contentType } = await retryNetwork(() => downloadAsset(source, 120000, maxBytes))
          if (card && (/(?:json|html|mpegurl)/i.test(contentType)
            || /^\s*(?:#EXTM3U|[\[{])/.test(buf.subarray(0, 100).toString('utf8')))) {
            throw new Error('视频接口未返回可离线播放的视频文件')
          }
          const name = assetName(key, source, card?.name || info?.name || match[2], contentType, !!card)
          fs.mkdirSync(assetsDir, { recursive: true })
          localPath = path.join(assetsDir, name)
          fs.writeFileSync(localPath, buf)
          await new Promise((resolve) => setTimeout(resolve, 150))
        }
        stats.done++
        attempted.set(key, localPath)
        stats.urlToPath.set(cacheKey, localPath)
      }
      if (!localPath) continue
      if (!match[1] && VIDEO_EXT_RE.test(localPath)) {
        replacements.push(embedReplacement(md, match, videoEmbed(mdDir, localPath, card?.name || match[2])))
      } else {
        const offset = match[0].indexOf(original, match[0].indexOf('](') + 2)
        replacements.push({ start: match.index + offset, end: match.index + offset + original.length,
          text: relativeUrl(mdDir, localPath) })
      }
    } catch (error) {
      const key = card ? `video:${card.videoId}` : original
      if (!attempted.has(key)) {
        attempted.set(key, null)
        if (error.code === 'ASSET_TOO_LARGE') stats.skipped++
        else stats.failed++
        stats.notes.push(`${error.code === 'ASSET_TOO_LARGE' ? '⏭ 附件过大跳过' : '❌ 附件下载失败'}: ${original} (${error.message})`)
      }
    }
  }
  // 按范围倒序替换，避免改动普通链接文字、代码或一个 URL 的前缀。
  let out = md
  for (const replacement of replacements.reverse()) {
    out = out.slice(0, replacement.start) + replacement.text + out.slice(replacement.end)
  }
  return out
}
