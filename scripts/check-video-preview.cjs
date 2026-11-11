'use strict'
// 使用真实视频字节验证导出 HTML 的本地路径和播放，默认样本由 FFmpeg 色块/正弦波生成。
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const assert = require('node:assert/strict')
const { pathToFileURL, fileURLToPath } = require('node:url')

if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process')
  const launchEnv = { ...process.env }
  delete launchEnv.ELECTRON_RUN_AS_NODE
  const result = spawnSync(require('electron'), [__filename], { env: launchEnv, windowsHide: true, stdio: 'inherit' })
  if (result.error) throw result.error
  process.exit(result.status ?? 1)
}

const { app, BrowserWindow } = require('electron')
app.disableHardwareAcceleration()
const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuque-video-preview-'))
app.setPath('userData', path.join(outputDir, 'browser-data'))

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1000, height: 780, show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true },
  })
  let networkRequests = 0
  win.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => {
    networkRequests++
    callback({ cancel: true })
  })
  try {
    const { localizeDocAssets } = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'book-assets.mjs')).href)
    const assetsDir = path.join(outputDir, '高效办公', 'assets')
    const mdDir = path.join(outputDir, '高效办公', 'Word', '表格处理')
    fs.mkdirSync(assetsDir, { recursive: true })
    fs.mkdirSync(mdDir, { recursive: true })
    const fixture = process.env.YUQUE_VIDEO_SAMPLE || path.join(__dirname, '..', 'test', 'fixtures', 'video-preview.mp4')
    const name = process.env.YUQUE_VIDEO_MARKDOWN ? path.basename(fixture)
      : '1c80fb2d-课时97.疑惑19：如何设置不同粗细的表格边框？ #100% & (1).mp4'
    const videoFile = path.join(assetsDir, name)
    fs.copyFileSync(fixture, videoFile)
    const relative = path.relative(mdDir, videoFile).split(path.sep).map(part => encodeURIComponent(part)
      .replace(/[!'()*]/g, ch => '%' + ch.charCodeAt(0).toString(16).toUpperCase())).join('/')
    const input = process.env.YUQUE_VIDEO_MARKDOWN ? fs.readFileSync(process.env.YUQUE_VIDEO_MARKDOWN, 'utf8')
      : `# Word 表格边框\n\n[此处为语雀卡片，点击链接查看](${relative})\n\n保留的本地笔记。\n`
    const stats = { done: 0, failed: 0, skipped: 0, notes: [], urlToPath: new Map() }
    const options = { assetsDir, mdDir, stats }
    const md = await localizeDocAssets(input, options)
    assert.ok(md.includes('../../assets/1c80fb2d-课时97.疑惑19：'))
    assert.ok(!md.includes('%E8%AF%BE'))
    assert.ok(!md.includes('此处为语雀卡片'))
    assert.equal(await localizeDocAssets(md, options), md)
    const mdPath = path.join(mdDir, 'Word表格设置不同粗细的表格边框.md')
    fs.writeFileSync(mdPath, md)
    const fragment = md.match(/<video\b[\s\S]*?<\/video>\s*<p>[\s\S]*?<\/p>/)?.[0]
    assert.ok(fragment)
    const htmlPath = path.join(mdDir, 'preview.html')
    fs.writeFileSync(htmlPath, `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>本地视频导出验证</title>
      <style>body{max-width:900px;margin:40px auto;padding:0 24px;color:#24324a;background:#f8fafc;font:16px/1.7 "Microsoft YaHei",sans-serif}h1{font-size:26px}video{width:100%;max-height:560px;background:#172333;border-radius:8px}a{color:#1a6ed8}p{overflow-wrap:anywhere}</style>
      <h1>Word 表格设置不同粗细的表格边框</h1>${fragment}<p>保留的本地笔记。</p></html>`)
    await win.loadFile(htmlPath)
    const playback = await win.webContents.executeJavaScript(`(async () => {
      const video = document.querySelector('video')
      const waitFor = async predicate => {
        const deadline = Date.now() + 12000
        while (!predicate()) {
          if (video.error) throw new Error('Media error ' + video.error.code + ': ' + video.error.message)
          if (Date.now() > deadline) throw new Error('Video playback timed out')
          await new Promise(resolve => setTimeout(resolve, 30))
        }
      }
      await waitFor(() => video.readyState >= 1)
      video.muted = true
      await video.play()
      await waitFor(() => video.currentTime > 0.15)
      video.pause()
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const fallback = document.querySelector('video + p a')
      return { currentSrc: video.currentSrc, duration: video.duration, width: video.videoWidth,
        height: video.videoHeight, playedTime: video.currentTime, controls: video.controls,
        fallback: fallback?.href, fallbackText: fallback?.textContent }
    })()`, true)
    assert.equal(fileURLToPath(playback.currentSrc), videoFile)
    assert.equal(fileURLToPath(playback.fallback), videoFile)
    assert.ok(playback.duration > 0 && playback.width > 0 && playback.height > 0)
    assert.ok(playback.playedTime > 0.15 && playback.controls)
    assert.ok(playback.fallbackText.includes('打开视频：课时97.疑惑19：'))
    assert.equal(networkRequests, 0)
    const screenshot = process.env.YUQUE_VIDEO_SCREENSHOT || path.join(outputDir, 'preview.png')
    fs.writeFileSync(screenshot, (await win.webContents.capturePage()).toPNG())
    console.log(JSON.stringify({ passed: true, ...playback, networkRequests, mdPath, screenshot }))
    win.destroy()
    app.exit(0)
  } catch (error) {
    console.error(error)
    win.destroy()
    app.exit(1)
  }
}).catch(error => { console.error(error); app.exit(1) })
