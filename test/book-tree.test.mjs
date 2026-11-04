import test from 'node:test'
import assert from 'node:assert/strict'
import Tree from '../src/book-tree.js'

const toc = [
  { uuid: 'chapter', type: 'TITLE', title: '第一章' },
  { uuid: 'intro', parent_uuid: 'chapter', type: 'DOC', title: '介绍', url: 'intro' },
  { uuid: 'child', parent_uuid: 'intro', type: 'DOC', title: '详细说明', url: 'child' },
  { uuid: 'sibling', parent_uuid: 'chapter', type: 'DOC', title: '另一篇', url: 'sibling' },
  { uuid: 'empty', type: 'TITLE', title: '空目录' },
  { uuid: 'hidden', type: 'DOC', title: '隐藏', url: 'hidden', visible: 0 },
  { uuid: 'link', type: 'LINK', title: '外站链接' },
]
const docs = ['intro', 'child', 'sibling', 'hidden', 'draft'].map(slug => ({ slug, title: slug, type: 'Doc' }))

test('keeps document parents, empty folders and unfiled documents without resurrecting hidden entries', () => {
  const roots = Tree.buildBookTree(toc, docs)
  const plan = Tree.planBookExport(roots)
  assert.deepEqual(plan.tasks.map(t => t.slug), ['intro', 'child', 'sibling', 'draft'])
  assert.deepEqual(plan.tasks.find(t => t.slug === 'child').ancestors, ['第一章', '介绍'])
  assert.deepEqual(plan.tasks.find(t => t.slug === 'draft').ancestors, ['未归档'])
  assert.ok(plan.directories.some(parts => parts.join('/') === '空目录'))
})

test('folder selection includes descendant documents, and removing a child gives both ancestors a partial state', () => {
  const roots = Tree.buildBookTree(toc, docs)
  const selected = new Set()
  const chapter = roots[0]
  Tree.setNodeSelected(chapter, selected, true)
  assert.equal(Tree.selectionState([chapter], selected).checked, true)
  assert.deepEqual(Tree.exportSelection(roots, selected).docSlugs, ['intro', 'child', 'sibling'])
  Tree.setNodeSelected(chapter.children[0].children[0], selected, false)
  assert.equal(Tree.selectionState([chapter], selected).indeterminate, true)
  assert.equal(Tree.selectionState([chapter.children[0]], selected).indeterminate, true)
  const plan = Tree.planBookExport(roots, Tree.exportSelection(roots, selected))
  assert.deepEqual(plan.tasks.map(t => t.slug), ['intro', 'sibling'])
  assert.deepEqual(plan.directories, [])
})

test('an explicit empty or stale selection never falls back to exporting the whole book', () => {
  const roots = Tree.buildBookTree(toc, docs)
  assert.deepEqual(Tree.planBookExport(roots, { docSlugs: [], folderKeys: [] }).tasks, [])
  const stale = Tree.planBookExport(roots, { docSlugs: ['deleted'], folderKeys: ['deleted-folder'] })
  assert.deepEqual(stale.tasks, [])
  assert.deepEqual(stale.directories, [])
  assert.deepEqual(stale.missingDocs, ['deleted'])
  assert.deepEqual(stale.missingFolders, ['deleted-folder'])
  for (const selection of [null, {}, { docSlugs: 'intro', folderKeys: [] }, { docSlugs: [null], folderKeys: [] }]) {
    assert.throws(() => Tree.planBookExport(roots, selection), /选择无效/)
  }
})

test('an empty folder is selectable and external links are excluded from selection', () => {
  const roots = Tree.buildBookTree(toc, docs)
  const selected = new Set()
  Tree.setNodeSelected(roots.find(n => n.key === 'toc:empty'), selected, true)
  const plan = Tree.planBookExport(roots, Tree.exportSelection(roots, selected))
  assert.deepEqual(plan.tasks, [])
  assert.deepEqual(plan.directories, [['空目录']])
  assert.equal(Tree.selectionState([roots.find(n => n.key === 'toc:link')], selected).total, 0)
})

test('deduplicates document slugs and keeps orphaned or cyclic documents accessible', () => {
  const roots = Tree.buildBookTree([
    { uuid: 'a', parent_uuid: 'b', type: 'DOC', title: 'A', url: 'a' },
    { uuid: 'b', parent_uuid: 'a', type: 'DOC', title: 'B', url: 'b' },
    { uuid: 'orphan', parent_uuid: 'missing', type: 'DOC', url: 'orphan' },
    { uuid: 'alias', type: 'DOC', url: 'a' },
  ], [{ slug: 'a' }, { slug: 'new' }, { slug: 'new' }])
  assert.deepEqual(Tree.planBookExport(roots).tasks.map(t => t.slug), ['a', 'b', 'orphan', 'new'])
})
