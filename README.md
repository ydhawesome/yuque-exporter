# 语雀导出工具

<p>
  <img alt="License" src="https://img.shields.io/github/license/ydhawesome/yuque-exporter?color=00d68f" />
  <img alt="Release" src="https://img.shields.io/github/v/release/ydhawesome/yuque-exporter?color=22d3ee" />
  <img alt="Downloads" src="https://img.shields.io/github/downloads/ydhawesome/yuque-exporter/total?color=8b5cf6&label=downloads" />
  <img alt="Platform" src="https://img.shields.io/badge/platform-Windows-0078d6" />
  <img alt="Built with" src="https://img.shields.io/badge/built%20with-Electron-47848f" />
</p>

一个跨平台桌面应用，用于**完整导出语雀「小记」和「知识库」**，包括正文、图片、链接卡片，并自动生成带嵌入图片的 Excel 表格。

基于 Electron 构建，所有请求从本地发出，**账号密码不经过任何第三方服务器**。

<p>
  <a href="https://github.com/ydhawesome/yuque-exporter/releases/latest"><b>⬇ 下载最新版</b></a>
  &nbsp;·&nbsp;
  <a href="https://yuque-landing.vercel.app"><b>🌐 在线介绍页</b></a>
  &nbsp;·&nbsp;
  <a href="#使用"><b>📖 使用说明</b></a>
</p>

---

## 功能

### 📝 小记导出
- 完整导出**你自己账号下的全部小记**
- 解析语雀 Lake 富文本格式，保留：
  - 正文文字
  - **图片**（下载到本地 `images/` 目录）
  - **书签 / 公众号链接卡片**（转换为 `🔗 来源：标题 + URL`）
  - 内联超链接（转换为 `文字（URL）`）
- 每条小记生成一个 **Markdown 文件**
- 汇总生成一份 **Excel**（`语雀小记导出_N条.xlsx`），列含序号、创建/更新时间、字数、标签、内容，以及最多 4 张**嵌入到单元格的图片**

### 📚 知识库导出
- 列出个人及协作的所有知识库，勾选需要导出的
- 逐篇下载文档的 **Markdown 源文件**（带附件时自动保存为 zip）
- 按知识库分文件夹存放，并生成**导出报告**（成功/失败/跳过明细）
- 已存在的文件自动跳过，支持断点续传式的重复运行

---

## 使用

### 直接运行（推荐普通用户）
双击 **`语雀导出工具-便携版.exe`** 即可，免安装。

1. 首次打开输入语雀账号密码登录（Cookie 缓存 24 小时，期间免登录）
2. 选择导出目录
3. 切换「小记」或「知识库」标签页，点击导出
4. 完成后可一键打开导出文件夹

> ⚠️ 便携版为单文件打包，每次启动会先解压资源到临时目录，**冷启动较慢（约 5–10 秒）**，属正常现象。

---

## 开发 / 自行构建

### 环境
- Node.js 18+
- Windows（当前构建目标为 win x64）

### 安装依赖
```bash
npm install
```

### 本地调试运行
```bash
npm start
```

### 打包便携版 exe
```bash
# 国内网络建议先设置 Electron 镜像
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/   # Windows CMD
npm run build
```
产物在 `dist/语雀导出工具-便携版.exe`。

> 如需改回安装版（NSIS），把 `package.json` 里 `build.win.target` 由 `portable` 改为 `nsis` 即可。

---

## 项目结构

```
yuque-exporter/
├─ main.js              # Electron 主进程，注册 IPC，创建窗口
├─ preload.js           # contextBridge，向渲染层暴露 window.yapi
├─ ui/
│  ├─ index.html        # 界面（登录 / 主页 / 进度 / 完成 四屏）
│  └─ app.js            # 渲染层逻辑
├─ src/                 # 业务逻辑（ESM，主进程动态 import）
│  ├─ yuque-api.mjs     # 登录 / Cookie / 小记 / 知识库 API + RSA 加密
│  ├─ parse-lake.mjs    # 语雀 Lake HTML 解析（提取图片、链接、纯文本）
│  ├─ export-notes.mjs  # 小记导出全流程
│  ├─ export-books.mjs  # 知识库导出全流程
│  └─ make-excel.mjs    # exceljs 生成带嵌入图片的 Excel
├─ assets/icon.ico      # 应用图标
└─ package.json
```

---

## 技术说明

- **鉴权**：登录密码经 RSA 公钥加密为 `时间戳:密码` 后提交，接口返回的 `set-cookie` 缓存于 `%APPDATA%\yuque-exporter\cookies.json`，有效期 24 小时。
- **加密模块**：使用本地依赖 `jsencrypt-node`，公钥内嵌于 `src/yuque-api.mjs`，不依赖外部安装的工具。
- **为什么是桌面应用而非网页**：浏览器的同源策略（CORS）、跨域 Cookie 限制，以及对 `Referer` 等请求头的安全保护，使纯前端无法直接完成导出；在本地 Node 环境发起请求是更合适的技术方案，同时账号信息全程不出本机。
- **对服务友好**：所有网络请求带指数退避重试（默认 4 次），请求之间保留间隔，避免给语雀服务器造成额外压力。

---

## 数据与隐私

- 账号密码仅用于登录语雀官方接口，**不上传任何第三方**，不写入代码或日志。
- 登录态以 Cookie 形式缓存在本机用户目录，可随时删除 `%APPDATA%\yuque-exporter\` 清除。

---

## ☕ 请我喝杯咖啡

如果这个小工具帮你省了事，欢迎请我喝杯咖啡 ☕ —— 完全自愿，所有功能始终免费、不会因此变化。

<p>
  <img src="assets/reward-wechat.png" alt="微信赞赏码" width="240" />
</p>

> 「狮兄🦁's Tip Code · 请我喝杯咖啡怎么样！」

---

## ⚠️ 免责声明

- 本工具是一个**个人数据备份工具**，仅供用户**导出自己语雀账号下的数据**用于本地备份，不针对、不存储、不传播他人数据。
- 使用本工具时，请自行遵守[语雀用户服务协议](https://www.yuque.com/terms)等相关条款及所在地区法律法规。**因使用本工具产生的任何后果（包括但不限于账号风险、数据风险）由使用者自行承担。**
- 本工具**仅供学习交流与个人备份之用，禁止用于任何商业用途，禁止用于抓取或处理他人数据**。
- 若语雀官方认为本项目存在不当之处，可通过 Issue 联系作者，作者将配合调整或下架。
- 本软件按"现状（AS IS）"提供，不提供任何明示或暗示的担保，详见 [LICENSE](./LICENSE)。

---

## 致谢

本项目的语雀接口调用方式与登录加密思路，参考并衍生自 [**yuque-tools**](https://github.com/vannvan/yuque-tools)（作者 [vannvan](https://github.com/vannvan)）。在此特别致谢。

第三方依赖的完整开源声明见 [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md)。

---

## 许可

本项目基于 [MIT 许可证](./LICENSE) 开源，版权所有 © 2026-present [ydhawesome](https://github.com/ydhawesome)。你可以自由使用、修改和分发，但需保留原始版权声明与许可证文本。
