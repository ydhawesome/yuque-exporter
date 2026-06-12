// 生成带嵌入图片的 Excel（exceljs 纯 JS 实现，无需 Python）
import ExcelJS from 'exceljs'
import fs from 'fs'
import { imageSize } from 'image-size'

const MAX_DIM = 160  // 图片最大显示边长 px

export async function makeExcel(rows, outPath, onProgress) {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('语雀小记')

  // 列定义
  ws.columns = [
    { header: '序号',   key: 'seq',       width: 6  },
    { header: '创建时间', key: 'created',   width: 20 },
    { header: '更新时间', key: 'updated',   width: 20 },
    { header: '字数',   key: 'wordCount', width: 8  },
    { header: '标签',   key: 'tag1',      width: 10 },
    { header: '内容',   key: 'content',   width: 80 },
    { header: '标签',   key: 'tag2',      width: 12 },
    { header: '图片1',  key: 'img1',      width: 22 },
    { header: '图片2',  key: 'img2',      width: 22 },
    { header: '图片3',  key: 'img3',      width: 22 },
    { header: '图片4',  key: 'img4',      width: 22 },
  ]

  // 表头样式
  const hdrRow = ws.getRow(1)
  hdrRow.height = 22
  hdrRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } }
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
  })
  ws.views = [{ state: 'frozen', ySplit: 1 }]

  const centerAlign = { horizontal: 'center', vertical: 'top' }
  const contentAlign = { wrapText: true, vertical: 'top', horizontal: 'left' }

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const excelRow = ws.getRow(i + 2)

    excelRow.getCell(1).value = r.seq
    excelRow.getCell(1).alignment = centerAlign
    excelRow.getCell(2).value = r.created
    excelRow.getCell(2).alignment = centerAlign
    excelRow.getCell(3).value = r.updated
    excelRow.getCell(3).alignment = centerAlign
    excelRow.getCell(4).value = r.wordCount
    excelRow.getCell(4).alignment = centerAlign
    excelRow.getCell(5).value = r.tag1
    excelRow.getCell(5).alignment = centerAlign
    excelRow.getCell(6).value = r.content
    excelRow.getCell(6).alignment = contentAlign
    excelRow.getCell(7).value = r.tag2
    excelRow.getCell(7).alignment = centerAlign

    let maxH = 0
    for (let k = 0; k < Math.min((r.images || []).length, 4); k++) {
      const imgPath = r.images[k]
      if (!imgPath || !fs.existsSync(imgPath)) continue
      try {
        const buf = fs.readFileSync(imgPath)
        const dims = imageSize(buf)
        if (!dims.width || !dims.height) continue
        const scale = Math.min(MAX_DIM / dims.width, MAX_DIM / dims.height, 1)
        const dw = Math.round(dims.width * scale)
        const dh = Math.round(dims.height * scale)
        const ext = (dims.type || 'png').toLowerCase() === 'jpg' ? 'jpeg'
          : (dims.type || 'png').toLowerCase()
        const imgId = wb.addImage({ buffer: buf, extension: ext })
        ws.addImage(imgId, {
          tl: { col: 7 + k, row: i + 1 },
          ext: { width: dw, height: dh },
        })
        maxH = Math.max(maxH, dh)
      } catch {}
    }

    // 行高
    if (maxH > 0) {
      excelRow.height = Math.max(maxH * 0.75 + 6, 30)
    } else {
      const lines = Math.min(r.content.split('\n').length + Math.floor(r.content.length / 40), 8)
      excelRow.height = Math.max(15, lines * 15)
    }

    if (i % 100 === 0) onProgress?.(Math.round((i / rows.length) * 100))
  }

  onProgress?.(95)
  await wb.xlsx.writeFile(outPath)
  onProgress?.(100)
  return outPath
}
