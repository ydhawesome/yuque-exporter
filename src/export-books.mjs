// 知识库导出：选定知识库 → 拉取文档列表 → 下载 Markdown → 写文件
import fs from 'fs'
import path from 'path'
import axios from 'axios'
import { getDocsOfBook, getMarkdown } from './yuque-api.mjs'
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
  return name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 100)
}

export async function exportBooks(books, outDir, onProgress) {
  const emit = (msg, pct) => onProgress?.({ msg, pct })
  fs.mkdirSync(outDir, { recursive: true })

  let totalDocs = 0, doneDocs = 0, failDocs = 0
  const report = []

  for (let bi = 0; bi < books.length; bi++) {
    const book = books[bi]
    emit(`[${bi + 1}/${books.length}] 正在获取《${book.name}》文档列表...`,
      5 + (bi / books.length) * 90)

    const bookDir = path.join(outDir, safeFileName(book.name))
    fs.mkdirSync(bookDir, { recursive: true })

    let docs = []
    try {
      docs = await retryFn(() => getDocsOfBook(book.id))
    } catch (e) {
      report.push(`❌ 《${book.name}》获取文档列表失败: ${e.message}`)
      continue
    }
    const realDocs = docs.filter((d) => d.type === 'Doc' || !d.type)
    totalDocs += realDocs.length
    emit(`《${book.name}》共 ${realDocs.length} 篇文档，开始下载...`,
      5 + (bi / books.length) * 90)

    for (let di = 0; di < realDocs.length; di++) {
      const doc = realDocs[di]
      const title = doc.title || doc.slug || `doc-${di}`
      const fname = safeFileName(title) + '.md'
      const dest = path.join(bookDir, fname)
      if (fs.existsSync(dest)) {
        doneDocs++
        report.push(`⏩ [${book.name}] ${title} 已存在，跳过`)
        continue
      }
      try {
        const mdUrl = `/${book.user || ''}/${book.slug}/${doc.slug}/markdown?attachment=true&latexcode=false&anchor=false&linebreak=false`
        const resp = await retryFn(() =>
          axios.get(`${HOST}${mdUrl}`, {
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
          // save as zip
          fs.writeFileSync(dest.replace('.md', '.zip'), Buffer.from(resp.data))
        } else {
          const text = Buffer.from(resp.data).toString('utf8')
          fs.writeFileSync(dest, text)
        }
        doneDocs++
        report.push(`✅ [${book.name}] ${title}`)
      } catch (e) {
        failDocs++
        report.push(`❌ [${book.name}] ${title}: ${e.message}`)
      }
      if (di % 10 === 0) {
        emit(`《${book.name}》${di + 1}/${realDocs.length}，已完成 ${doneDocs} 篇`,
          5 + ((bi + (di / realDocs.length)) / books.length) * 90)
      }
      await sleep(400)
    }
  }

  const reportPath = path.join(outDir, '导出报告.md')
  fs.writeFileSync(reportPath, `# 语雀知识库导出报告\n\n生成时间: ${new Date().toLocaleString('zh-CN')}\n\n---\n\n` + report.join('\n'))

  emit(`完成！共 ${totalDocs} 篇文档，成功 ${doneDocs}，失败 ${failDocs}`, 100)
  return { totalDocs, doneDocs, failDocs, outDir, reportPath }
}
