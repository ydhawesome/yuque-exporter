// 浏览器和导出端共用目录与选择规则，避免界面预览和实际下载范围不一致。
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory()
  else root.BookTree = factory()
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict'

  function buildBookTree(tocNodes = [], docs = []) {
    const raw = new Map(tocNodes.filter(n => n.uuid).map(n => [String(n.uuid), n]))
    const nodes = new Map()
    const tocSlugs = new Set(tocNodes.filter(n => n.type === 'DOC' && n.url).map(n => String(n.url)))
    function ancestorsOf(item) {
      const seen = new Set([String(item.uuid)])
      const ancestors = []
      let parent = raw.get(String(item.parent_uuid || ''))
      while (parent) {
        if (seen.has(String(parent.uuid))) return { ancestors, cyclic: true }
        seen.add(String(parent.uuid))
        ancestors.push(parent)
        parent = raw.get(String(parent.parent_uuid || ''))
      }
      return { ancestors, cyclic: false }
    }
    for (const [index, item] of tocNodes.entries()) {
      if (!['TITLE', 'DOC', 'LINK'].includes(item.type)) continue
      const { ancestors, cyclic } = ancestorsOf(item)
      if (item.visible === 0 || ancestors.some(n => n.visible === 0)) continue
      const key = item.uuid ? `toc:${item.uuid}` : `toc-index:${index}`
      if (nodes.has(key)) continue
      nodes.set(key, {
        key, type: item.type, title: String(item.title || item.url || '未命名'),
        slug: item.type === 'DOC' && item.url ? String(item.url) : null,
        parentKey: !cyclic && item.parent_uuid ? `toc:${item.parent_uuid}` : null,
        children: [],
      })
    }
    const roots = []
    for (const node of nodes.values()) {
      const parent = nodes.get(node.parentKey)
      if (parent) parent.children.push(node)
      else roots.push(node)
    }
    const extra = []
    const known = new Set(tocSlugs)
    for (const doc of docs) {
      if ((doc.type && doc.type !== 'Doc') || !doc.slug || known.has(String(doc.slug))) continue
      const slug = String(doc.slug)
      known.add(slug)
      extra.push({ key: `doc:${slug}`, type: 'DOC', title: String(doc.title || slug), slug, children: [] })
    }
    if (tocNodes.length && extra.length) {
      roots.push({ key: 'unfiled', type: 'TITLE', title: '未归档', slug: null, children: extra })
    } else roots.push(...extra)
    return roots
  }

  function selectionKeys(node) {
    const keys = node.slug ? [`doc:${node.slug}`] : []
    for (const child of node.children) keys.push(...selectionKeys(child))
    if (node.type === 'TITLE' && !node.children.length) keys.push(`folder:${node.key}`)
    return keys
  }

  function allSelectionKeys(roots) {
    return new Set(roots.flatMap(selectionKeys))
  }

  function selectionState(nodes, selected) {
    const keys = new Set(nodes.flatMap(selectionKeys))
    let count = 0
    for (const key of keys) if (selected.has(key)) count++
    return { checked: keys.size > 0 && count === keys.size, indeterminate: count > 0 && count < keys.size, count, total: keys.size }
  }

  function setNodeSelected(node, selected, checked) {
    for (const key of selectionKeys(node)) {
      if (checked) selected.add(key)
      else selected.delete(key)
    }
  }

  function walk(roots, visit, ancestors = []) {
    for (const node of roots) {
      visit(node, ancestors)
      walk(node.children, visit, [...ancestors, node.title])
    }
  }

  function exportSelection(roots, selected) {
    const docSlugs = new Set()
    const folderKeys = []
    walk(roots, node => {
      if (node.slug && selected.has(`doc:${node.slug}`)) docSlugs.add(node.slug)
      if (node.type === 'TITLE' && selectionState([node], selected).checked) folderKeys.push(node.key)
    })
    return { docSlugs: [...docSlugs], folderKeys }
  }

  function planBookExport(roots, selection) {
    const partial = selection !== undefined
    if (partial && (!selection || !Array.isArray(selection.docSlugs) || !Array.isArray(selection.folderKeys)
      || [...selection.docSlugs, ...selection.folderKeys].some(value => typeof value !== 'string' || !value))) {
      throw new Error('导出选择无效，请重新勾选文档')
    }
    const wantedDocs = partial ? new Set(selection.docSlugs) : null
    const wantedFolders = partial ? new Set(selection.folderKeys) : null
    const tasks = [], directories = [], seenDocs = new Set(), foundFolders = new Set()
    walk(roots, (node, ancestors) => {
      if (node.type === 'TITLE') {
        foundFolders.add(node.key)
        if (!partial || wantedFolders.has(node.key)) directories.push([...ancestors, node.title])
      }
      if (node.slug && !seenDocs.has(node.slug) && (!partial || wantedDocs.has(node.slug))) {
        tasks.push({ slug: node.slug, title: node.title, ancestors })
        seenDocs.add(node.slug)
      }
    })
    const missingDocs = partial ? [...wantedDocs].filter(slug => !seenDocs.has(slug)) : []
    const missingFolders = partial ? [...wantedFolders].filter(key => !foundFolders.has(key)) : []
    return { tasks, directories, missingDocs, missingFolders, partial }
  }

  return { buildBookTree, allSelectionKeys, selectionState, setNodeSelected, exportSelection, planBookExport, walk }
})
