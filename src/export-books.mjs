// 知识库导出：拉取目录树(TOC) → 按层级建文件夹 → 下载 Markdown 写入对应目录
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { getDocsOfBook, getBookToc, http, downloadAsset } from './yuque-api.mjs'
import { readCookie } from './yuque-api.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const HOST = 'https://www.yuque.com'
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/20G81 YuqueMobileApp/1.0.2 (AppBuild/650 Device/Phone Locale/zh-cn Theme/light YuqueType/public)'

function cookieStr() {
  const ck = readCookie()
  if (!ck?.data) return ''
  return Array.isArray(ck.data)
    ? ck.data.map((c) => c.split(';')[0]).join('; ')
    : String(ck.data)
}

async function retryFn(fn, tries = 4) {
  for (let i = 1; ; i++) {
    try { return await fn() }
    catch (e) { if (i >= tries) throw e; await sleep(2000 * i) }
  }
}

function safeFileName(name) {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 100) || '未命名'
}

// 由 TOC 节点算出每个节点所在的相对目录（祖先节点标题逐级拼接）
function buildDirResolver(nodes) {
  const byUuid = new Map(nodes.map((n) => [n.uuid, n]))
  const cache = new Map()
  function dirOf(uuid) {
    if (cache.has(uuid)) return cache.get(uuid)
    const node = byUuid.get(uuid)
    const parent = node?.parent_uuid ? byUuid.get(node.parent_uuid) : null
    const dir = parent
      ? path.join(dirOf(parent.uuid), safeFileName(parent.title || '未命名'))
      : ''
    cache.set(uuid, dir)
    return dir
  }
  return dirOf
}

// ─── 附件/多媒体下载 ─────────────────────────────────────────────────
// 语雀导出的 MD 里，图片和附件都是指向 CDN 的外链，原来只存了 MD 文本，
// 链接指向的视频/文件本身没下载下来（GitHub issue #1）。这里把它们抓到
// 本地 assets/ 目录，并把 MD 里的链接改写成相对路径。

// markdown 里的 ![alt](url) 和 [text](url)
const MD_LINK_RE = /(!?)\[([^\]]*)\]\(\s*(<?)([^)\s]+?)\3\s*(?:"[^"]*")?\)/g

// 只下载真正的资源外链：CDN 域名，或语雀的 /attachments/ 路径。
// 普通文档链接（www.yuque.com/user/book/slug）必须排除，否则会把整站爬下来
function isAssetUrl(url) {
  if (!/^https?:\/\//i.test(url)) return false
  let u
  try { u = new URL(url) } catch { return false }
  if (/(^|\.)nlark\.com$/i.test(u.hostname)) return true
  if (/(^|\.)yuque\.com$/i.test(u.hostname) && u.pathname.startsWith('/attachments/')) return true
  return false
}

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

// 从 URL（可能带一堆查询参数）推断一个干净的文件名
function assetFileName(url, linkText, contentType) {
  let base = ''
  try {
    base = decodeURIComponent(new URL(url).pathname.split('/').pop() || '')
  } catch { base = '' }
  // URL 里没有像样的文件名时，退回用链接文字（语雀附件的链接文字通常就是文件名）
  if (!base || !path.extname(base)) {
    const fromText = (linkText || '').trim()
    if (fromText && path.extname(fromText)) base = fromText
  }
  base = safeFileName(base || 'asset')
  if (!path.extname(base)) base += (MIME_EXT[contentType] || '.bin')
  // URL 短哈希做前缀：同名不同文件不会互相覆盖，同一个 URL 也能稳定命中缓存
  const hash = crypto.createHash('md5').update(url).digest('hex').slice(0, 8)
  return `${hash}-${base}`
}

// 下载一篇文档里引用的所有资源，返回改写后的 markdown
async function fetchDocAssets(md, assetsDir, mdDir, stats, maxBytes) {
  const found = []
  let m
  MD_LINK_RE.lastIndex = 0
  while ((m = MD_LINK_RE.exec(md))) {
    const url = m[4]
    if (isAssetUrl(url) && !found.some((f) => f.url === url)) {
      found.push({ url, text: m[2] })
    }
  }
  if (!found.length) return md

  let out = md
  for (const { url, text } of found) {
    try {
      let localPath = stats.urlToPath.get(url)
      if (!localPath) {
        const { buf, contentType } = await retryFn(() => downloadAsset(url), 3)
        if (maxBytes && buf.length > maxBytes) {
          stats.skipped++
          stats.notes.push(`⏭ 附件过大跳过（${(buf.length / 1048576).toFixed(1)}MB）: ${url}`)
          continue
        }
        const fname = assetFileName(url, text, contentType)
        fs.mkdirSync(assetsDir, { recursive: true })
        localPath = path.join(assetsDir, fname)
        if (!fs.existsSync(localPath)) fs.writeFileSync(localPath, buf)
        stats.urlToPath.set(url, localPath)
        stats.done++
        await sleep(150)
      }
      // MD 里用相对路径引用（文档可能在多层子目录里）
      const rel = path.relative(mdDir, localPath).split(path.sep).join('/')
      out = out.split(url).join(rel)
    } catch (e) {
      stats.failed++
      stats.notes.push(`❌ 附件下载失败: ${url} (${e.message})`)
    }
  }
  return out
}

async function downloadDoc(book, slug, dest, assetCtx) {
  const mdUrl = `/${book.user || ''}/${book.slug}/${slug}/markdown?attachment=true&latexcode=false&anchor=false&linebreak=false`
  const resp = await retryFn(() =>
    http.get(`${HOST}${mdUrl}`, {
      headers: {
        cookie: cookieStr(),
        'x-requested-with': 'XMLHttpRequest',
        'user-agent': UA,
      },
      responseType: 'arraybuffer',
    })
  )
  // response may be zip or text
  const ct = resp.headers['content-type'] || ''
  if (ct.includes('application/zip') || ct.includes('octet-stream')) {
    // 二进制打包结果，里面本来就带着附件，不用再单独抓一遍
    fs.writeFileSync(dest.replace(/\.md$/, '.zip'), Buffer.from(resp.data))
    return
  }
  let text = Buffer.from(resp.data).toString('utf8')
  if (assetCtx) {
    text = await fetchDocAssets(text, assetCtx.assetsDir, path.dirname(dest), assetCtx.stats, assetCtx.maxBytes)
  }
  fs.writeFileSync(dest, text)
}

export async function exportBooks(books, outDir, onProgress, options = {}) {
  const emit = (msg, pct) => onProgress?.({ msg, pct })
  fs.mkdirSync(outDir, { recursive: true })

  const downloadAssets = options.downloadAssets !== false // 默认开启
  const maxBytes = (options.maxAssetMB ?? 200) * 1024 * 1024

  let totalDocs = 0, doneDocs = 0, failDocs = 0
  const assetStats = { done: 0, failed: 0, skipped: 0, notes: [], urlToPath: new Map() }
  const report = []

  for (let bi = 0; bi < books.length; bi++) {
    const book = books[bi]
    emit(`[${bi + 1}/${books.length}] 正在获取《${book.name}》目录结构...`,
      5 + (bi / books.length) * 90)

    const bookDir = path.join(outDir, safeFileName(book.name))
    fs.mkdirSync(bookDir, { recursive: true })

    // 目录树：拿不到时回退为平铺导出
    let tocNodes = []
    try {
      tocNodes = await retryFn(() => getBookToc(book.id))
    } catch (e) {
      report.push(`⚠️ 《${book.name}》获取目录结构失败，按平铺导出: ${e.message}`)
    }
    const dirOf = buildDirResolver(tocNodes)

    // 待导出任务：{ slug, title, relDir }
    const tasks = []
    const tocSlugs = new Set()
    for (const n of tocNodes) {
      if (n.visible === 0) continue
      const relDir = dirOf(n.uuid)
      if (n.type === 'TITLE') {
        // 纯分组节点：建目录（保留空分组）
        fs.mkdirSync(path.join(bookDir, relDir, safeFileName(n.title || '未命名')), { recursive: true })
      } else if (n.type === 'DOC' && n.url) {
        tocSlugs.add(n.url)
        tasks.push({ slug: n.url, title: n.title || n.url, relDir })
      }
    }

    // 不在目录里的文档（草稿/未归档）也不遗漏，放入"未归档"
    try {
      const docs = await retryFn(() => getDocsOfBook(book.id))
      for (const d of docs.filter((x) => x.type === 'Doc' || !x.type)) {
        if (!tocSlugs.has(d.slug)) {
          tasks.push({ slug: d.slug, title: d.title || d.slug, relDir: tocNodes.length ? '未归档' : '' })
        }
      }
    } catch (e) {
      if (!tocNodes.length) {
        report.push(`❌ 《${book.name}》获取文档列表失败: ${e.message}`)
        continue
      }
    }

    totalDocs += tasks.length
    emit(`《${book.name}》共 ${tasks.length} 篇文档，开始下载...`,
      5 + (bi / books.length) * 90)

    for (let di = 0; di < tasks.length; di++) {
      const t = tasks[di]
      const destDir = path.join(bookDir, t.relDir)
      fs.mkdirSync(destDir, { recursive: true })
      const relPath = path.join(t.relDir, safeFileName(t.title) + '.md')
      const dest = path.join(bookDir, relPath)
      if (fs.existsSync(dest)) {
        doneDocs++
        report.push(`⏩ [${book.name}] ${relPath} 已存在，跳过`)
        continue
      }
      try {
        const assetCtx = downloadAssets
          ? { assetsDir: path.join(bookDir, 'assets'), stats: assetStats, maxBytes }
          : null
        await downloadDoc(book, t.slug, dest, assetCtx)
        doneDocs++
        report.push(`✅ [${book.name}] ${relPath}`)
      } catch (e) {
        failDocs++
        report.push(`❌ [${book.name}] ${relPath}: ${e.message}`)
      }
      if (di % 10 === 0) {
        const assetTip = downloadAssets && assetStats.done ? `，附件 ${assetStats.done}` : ''
        emit(`《${book.name}》${di + 1}/${tasks.length}，已完成 ${doneDocs} 篇${assetTip}`,
          5 + ((bi + (di / tasks.length)) / books.length) * 90)
      }
      await sleep(400)
    }
  }

  const assetSection = downloadAssets
    ? `\n\n## 附件下载\n\n成功 ${assetStats.done}，失败 ${assetStats.failed}，跳过 ${assetStats.skipped}\n\n`
      + (assetStats.notes.length ? assetStats.notes.join('\n') : '（无异常）')
    : '\n\n## 附件下载\n\n未启用'

  const reportPath = path.join(outDir, '导出报告.md')
  fs.writeFileSync(reportPath, `# 语雀知识库导出报告\n\n生成时间: ${new Date().toLocaleString('zh-CN')}\n\n---\n\n` + report.join('\n') + assetSection)

  const assetSummary = downloadAssets ? `，附件 ${assetStats.done}` : ''
  emit(`完成！共 ${totalDocs} 篇文档，成功 ${doneDocs}，失败 ${failDocs}${assetSummary}`, 100)
  return { totalDocs, doneDocs, failDocs, outDir, reportPath, assets: { ...assetStats, urlToPath: undefined } }
}
