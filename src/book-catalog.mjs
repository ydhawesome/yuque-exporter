import { getBookToc, getDocsOfBook } from './yuque-api.mjs'
import BookTree from './book-tree.js'

// 目录接口和文档列表互为回退；缺失的已选项只报告，不扩大导出范围。
export async function loadBookCatalog(bookId) {
  const [toc, docs] = await Promise.allSettled([getBookToc(bookId), getDocsOfBook(bookId)])
  if (toc.status === 'rejected' && docs.status === 'rejected') {
    throw new Error(`获取目录和文档列表失败：${toc.reason.message}；${docs.reason.message}`)
  }
  const warnings = []
  if (toc.status === 'rejected') warnings.push(`获取目录结构失败，按平铺文档列表展示：${toc.reason.message}`)
  if (docs.status === 'rejected') warnings.push(`获取文档列表失败，可能缺少未归档文档：${docs.reason.message}`)
  return {
    roots: BookTree.buildBookTree(toc.status === 'fulfilled' ? toc.value : [], docs.status === 'fulfilled' ? docs.value : []),
    warnings,
  }
}
