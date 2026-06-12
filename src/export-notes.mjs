// 小记完整导出：拉取数据 → 下载图片 → 写 Markdown → 生成 Excel
import fs from 'fs'
import path from 'path'
import { getNotesBatch, downloadImage } from './yuque-api.mjs'
import { extractImages, htmlToText, fmtTime } from './parse-lake.mjs'
import { makeExcel } from './make-excel.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function retryGet(fn, tries = 4) {
  for (let i = 1; ; i++) {
    try { return await fn() }
    catch (e) {
      if (i >= tries) throw e
      await sleep(2000 * i)
    }
  }
}

export async function exportNotes(outDir, onProgress) {
  const emit = (msg, pct) => onProgress?.({ msg, pct })
  fs.mkdirSync(outDir, { recursive: true })
  const imgDir = path.join(outDir, 'images')
  fs.mkdirSync(imgDir, { recursive: true })

  // 1. 拉取全部小记
  emit('正在拉取小记列表...', 2)
  let offset = 0, hasMore = true
  const notes = []
  while (hasMore) {
    const d = await retryGet(() => getNotesBatch(offset, 50))
    notes.push(...(d.notes || []))
    hasMore = d.has_more
    offset += 50
    emit(`已拉取 ${notes.length} 条小记...`, Math.min(20, 2 + notes.length / 100))
    await sleep(150)
  }
  emit(`共 ${notes.length} 条小记，开始下载图片`, 22)

  // 2. 整理数据 + 下载图片
  let imgDone = 0, imgFail = 0, imgTotal = 0
  const rows = []
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i]
    const html = n.content?.abstract || ''
    const imgUrls = extractImages(html)
    imgTotal += imgUrls.length
    const imgPaths = []
    for (let k = 0; k < imgUrls.length; k++) {
      const fname = `${n.slug}-${k + 1}.png`
      const dest = path.join(imgDir, fname)
      if (fs.existsSync(dest)) {
        imgPaths.push(dest); imgDone++
      } else {
        try {
          const buf = await retryGet(() => downloadImage(imgUrls[k]))
          fs.writeFileSync(dest, buf)
          imgPaths.push(dest); imgDone++
          await sleep(100)
        } catch {
          imgPaths.push(null); imgFail++
        }
      }
    }
    const tags = (n.tags || []).map((t) => t.name)
    rows.push({
      seq: i + 1,
      created: fmtTime(n.created_at),
      updated: fmtTime(n.content?.updated_at || n.updated_at),
      wordCount: n.word_count || 0,
      tag1: tags[0] || '',
      tag2: tags[1] || '',
      content: htmlToText(html),
      images: imgPaths,
      slug: n.slug,
    })
    // 写 Markdown
    const mdPath = path.join(outDir, `${n.slug}.md`)
    if (!fs.existsSync(mdPath)) {
      const tagStr = tags.map((t) => `#${t}`).join(' ')
      const imgMd = imgPaths
        .filter(Boolean)
        .map((p, k) => `![图片${k + 1}](images/${path.basename(p)})`)
        .join('\n\n')
      const body = [tagStr, rows[i].content, imgMd].filter(Boolean).join('\n\n')
      fs.writeFileSync(mdPath, body)
    }
    if (i % 50 === 0) {
      emit(`图片 ${imgDone}/${imgTotal}，已处理 ${i + 1}/${notes.length} 条`, 22 + (i / notes.length) * 50)
    }
  }
  emit(`图片下载完成 (成功${imgDone}/失败${imgFail})，正在生成 Excel...`, 73)

  // 3. 生成 Excel
  const xlsxPath = path.join(path.dirname(outDir), `语雀小记导出_${notes.length}条.xlsx`)
  await makeExcel(rows, xlsxPath, (p) => emit(`生成 Excel ${p}%...`, 73 + p * 0.25))

  emit(`完成！共 ${notes.length} 条，图片 ${imgDone} 张，Excel 已保存`, 100)
  return {
    total: notes.length,
    imgOk: imgDone,
    imgFail,
    xlsxPath,
    mdDir: outDir,
  }
}
