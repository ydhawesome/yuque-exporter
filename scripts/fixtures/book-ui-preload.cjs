// 离线界面验证专用，不打包进发布版，也不读取本机登录信息。
const { contextBridge } = require('electron')
let requests = [], capturedExports = [], failNext = false, delay = 80
const roots = [
  { key: 'toc:chapter', type: 'TITLE', title: '项目资料', slug: null, children: [
    { key: 'toc:intro', type: 'DOC', title: '项目介绍', slug: 'intro', children: [] },
    { key: 'toc:guide', type: 'TITLE', title: '使用指南', slug: null, children: [
      { key: 'toc:install', type: 'DOC', title: '安装与登录', slug: 'install', children: [] },
      { key: 'toc:export', type: 'DOC', title: '导出文档与视频', slug: 'export', children: [] },
    ] },
  ] },
  { key: 'toc:empty', type: 'TITLE', title: '待整理（空目录）', slug: null, children: [] },
  { key: 'unfiled', type: 'TITLE', title: '未归档', slug: null, children: [
    { key: 'doc:draft', type: 'DOC', title: '会议记录草稿', slug: 'draft', children: [] },
  ] },
]
contextBridge.exposeInMainWorld('yapi', {
  checkLogin: async () => ({ ok: true, name: '离线测试' }),
  getBooks: async () => [
    { id: 42, name: '产品知识库', slug: 'product', user: 'demo' },
    { id: 43, name: '个人笔记', slug: 'notes', user: 'demo' },
  ],
  getBookCatalog: async id => {
    requests.push(id)
    const shouldFail = failNext
    failNext = false
    await new Promise(resolve => setTimeout(resolve, delay))
    if (shouldFail) throw new Error('目录加载失败，请稍后重试')
    return { roots, warnings: [] }
  },
  selectDir: async () => 'C:\\语雀备份',
  exportBooks: async options => {
    capturedExports.push(options)
    const count = options.books.reduce((sum, book) => sum + (book.selection?.docSlugs.length ?? 4), 0)
    return { totalDocs: count, doneDocs: count, failDocs: 0, outDir: options.outDir, assets: { done: 0 } }
  },
  onProgress: () => {}, offProgress: () => {}, openFolder: async () => {},
  testState: () => ({ requests, exports: capturedExports }),
  testMode: options => { failNext = !!options.failNext; delay = options.delay ?? 80 },
})
