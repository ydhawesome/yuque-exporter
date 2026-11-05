// 知识库导出：拉取目录树(TOC) → 按层级建文件夹 → 下载 Markdown 写入对应目录
import fs from 'fs'
import path from 'path'
import { getDocDetail, http } from './yuque-api.mjs'
import { readCookie } from './yuque-api.mjs'
import { localizeDocAssets } from './book-assets.mjs'
import { loadBookCatalog } from './book-catalog.mjs'
import BookTree from './book-tree.js'

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
  return name.replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 100).replace(/[. ]+$/, '') || '未命名'
}

function localize(text, book, slug, dest, assetCtx) {
  return localizeDocAssets(text, {
    ...assetCtx,
    mdDir: path.dirname(dest),
    docUrl: `${HOST}/${book.user || ''}/${book.slug}/${slug}`,
    getContent: () => getDocDetail(book.id, slug),
  })
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
    text = await localize(text, book, slug, dest, assetCtx)
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

    let catalog
    try {
      catalog = await retryFn(() => loadBookCatalog(book.id))
    } catch (e) {
      report.push(`❌ 《${book.name}》${e.message}`)
      continue
    }
    for (const warning of catalog.warnings) report.push(`⚠️ 《${book.name}》${warning}`)
    const plan = BookTree.planBookExport(catalog.roots, book.selection)
    const tasks = plan.tasks.map(task => ({ ...task, relDir: path.join(...task.ancestors.map(safeFileName), '') }))
    for (const segments of plan.directories) {
      fs.mkdirSync(path.join(bookDir, ...segments.map(safeFileName)), { recursive: true })
    }
    if (plan.partial) report.push(`📌 《${book.name}》按勾选范围导出 ${tasks.length} 篇文档`)
    for (const slug of plan.missingDocs) report.push(`⚠️ 《${book.name}》已选文档不存在或无法访问，已跳过：${slug}`)
    if (plan.missingFolders.length) {
      report.push(`⚠️ 《${book.name}》${plan.missingFolders.length} 个已选目录不存在或无法访问，已跳过`)
    }

    totalDocs += tasks.length + plan.missingDocs.length
    failDocs += plan.missingDocs.length
    emit(`《${book.name}》共 ${tasks.length} 篇文档，开始下载...`,
      5 + (bi / books.length) * 90)

    for (let di = 0; di < tasks.length; di++) {
      const t = tasks[di]
      const destDir = path.join(bookDir, t.relDir)
      fs.mkdirSync(destDir, { recursive: true })
      const relPath = path.join(t.relDir, safeFileName(t.title) + '.md')
      const dest = path.join(bookDir, relPath)
      try {
        const assetCtx = downloadAssets
          ? { assetsDir: path.join(bookDir, 'assets'), stats: assetStats, maxBytes }
          : null
        if (fs.existsSync(dest)) {
          // 保留已有正文，仅补齐尚未本地化的视频/附件，支持旧版本导出目录。
          if (assetCtx) {
            const text = fs.readFileSync(dest, 'utf8')
            const updated = await localize(text, book, t.slug, dest, assetCtx)
            if (updated !== text) fs.writeFileSync(dest, updated)
          }
          report.push(`⏩ [${book.name}] ${relPath} 已存在${assetCtx ? '，已检查并补齐附件' : '，跳过'}`)
        } else if (fs.existsSync(dest.replace(/\.md$/, '.zip'))) {
          report.push(`⏩ [${book.name}] ${relPath.replace(/\.md$/, '.zip')} 已存在，跳过`)
        } else {
          await downloadDoc(book, t.slug, dest, assetCtx)
          report.push(`✅ [${book.name}] ${relPath}`)
        }
        doneDocs++
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
