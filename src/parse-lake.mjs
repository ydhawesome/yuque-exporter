// 解析语雀 Lake 格式 HTML → 纯文本 + 图片列表
const ENT = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ', '&apos;': "'" }
function decode(s) { return s.replace(/&(lt|gt|amp|quot|nbsp|apos|#39);/g, (m) => ENT[m] || m) }

function cardToText(name, valEnc) {
  let j = {}
  try { j = JSON.parse(decodeURIComponent(valEnc)) } catch { return '' }
  if (name === 'image') return ''
  const url = j.src || j.url || j.detail?.url || ''
  const title = j.detail?.title || j.title || j.name || j.text || ''
  if (name === 'bookmarklink') {
    const belong = j.detail?.belong ? `${j.detail.belong}：` : ''
    return url ? `\n🔗 ${belong}${title || url}\n${url}\n` : ''
  }
  if (name === 'file') return url ? `\n📎 ${title || '附件'}：${url}\n` : ''
  if (url) return `\n🔗 ${title || url}\n${url}\n`
  if (title) return `\n${title}\n`
  return ''
}

export function extractImages(html) {
  const out = []
  const re = /<card[^>]*name="(image|file)"[^>]*value="data:([^"]*)"[^>]*>/g
  let m
  while ((m = re.exec(html))) {
    try {
      const j = JSON.parse(decodeURIComponent(m[2]))
      if (j.src && m[1] === 'image') out.push(j.src)
    } catch {}
  }
  return out
}

export function htmlToText(html) {
  if (!html) return ''
  let s = html
  s = s.replace(/<!doctype[^>]*>/gi, '')
  s = s.replace(/<meta[^>]*>/gi, '')
  s = s.replace(/<card[^>]*name="([^"]*)"[^>]*value="data:([^"]*)"[^>]*>/gi,
    (m, name, val) => cardToText(name, val))
  s = s.replace(/<card[^>]*>/gi, '')
  s = s.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, (m, href, txt) => {
    const t = txt.replace(/<[^>]+>/g, '').trim()
    return t && t !== href ? `${t}（${href}）` : href
  })
  s = s.replace(/<br\s*\/?>/gi, '\n')
  s = s.replace(/<li[^>]*>/gi, '- ')
  s = s.replace(/<\/(p|div|li|h[1-6]|blockquote|tr)>/gi, '\n')
  s = s.replace(/<[^>]+>/g, '')
  s = decode(s)
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  return s
}

export function fmtTime(iso) {
  if (!iso) return ''
  const m = String(iso).match(/(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/)
  return m ? `${m[1]} ${m[2]}` : String(iso)
}
