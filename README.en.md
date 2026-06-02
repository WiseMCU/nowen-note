# nowen-note

> A self-hosted private knowledge base, inspired by Synology Note Station.
>
> 自托管的私有知识库。[中文 README](./README.md) · [Author's Note](./AUTHOR_STORY.en.md) · [Live Demo](https://note.nowen.cn/)

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/Node-20%2B-green.svg)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED.svg?logo=docker&logoColor=white)](./Dockerfile)

## Features

- **Dual editor engines**: Tiptap 3 (rich text) + CodeMirror 6 (Markdown), sharing AI, version history, comments and other capabilities
- **AI assistant**: Works with Qwen / OpenAI / Gemini / DeepSeek / Doubao / Ollama — writing assist, title generation, tag suggestion, RAG Q&A
- **Knowledge management**: Unlimited-depth notebooks, color tags, tasks, mind maps, moments, FTS5 full-text search
- **Collaboration & history**: Shared links with 4 permission tiers (view / comment / edit / edit-with-login), guest comments, password / expiry, version rollback
- **File manager**: Image thumbnails (sharp webp at 240/480/960, ~100x bandwidth saving on dense galleries), "My uploads" view (referenced / unreferenced), orphan cleanup
- **Automation**: Sandboxed plugin system, Webhooks, audit log, scheduled auto-backup
- **Cross-platform**: Web / Electron (Win/macOS/Linux) / Android (Capacitor)
- **Developer ecosystem**: MCP Server, TypeScript SDK, CLI, [browser clipper extension](https://chromewebstore.google.com/detail/nowen-note-web-clipper/nglkodhfdbnfielchjpkjhenfaecafpg), OpenAPI 3.0 — see [`packages/`](./packages)

## Stack

React 18 · TypeScript · Vite 5 · Tiptap 3 · Tailwind · Hono 4 · SQLite(FTS5) · JWT · Electron 33 · Capacitor 8

## Screenshots

### Desktop

| AI writing assistant | AI provider settings |
| :---: | :---: |
| ![Desktop AI writing](./docs/screenshots/desktop-ai-writing.png) | ![AI settings](./docs/screenshots/settings-ai.png) |

### Mobile (Android / Capacitor)

| Sidebar | Note list | Editor |
| :---: | :---: | :---: |
| ![Mobile sidebar](./docs/screenshots/mobile-sidebar.png) | ![Mobile list](./docs/screenshots/mobile-list.png) | ![Mobile editor](./docs/screenshots/mobile-editor.png) |

## Live Demo

Don't want to self-host yet? Try the official demo site maintained by the author:

- URL: <https://note.nowen.cn/>
- Username: `demo`
- Password: `demo123456`

> ⚠ The demo account is for read-only evaluation. Data may be reset periodically — please do not store anything sensitive or important. For real use, self-host it via the Quick Start below.

## Quick Start

> Default admin: `admin` / `admin123`. Please change the password immediately after first login.

### Docker (recommended)

```bash
git clone https://github.com/cropflre/nowen-note.git
cd nowen-note
docker-compose up -d
```

Open `http://<your-ip>:3001`.

### Local development

Requires Node.js 20+.

```bash
git clone https://github.com/cropflre/nowen-note.git
cd nowen-note
npm run install:all
npm run dev:backend   # backend on :3001
npm run dev:frontend  # frontend on :5173
```

Open `http://localhost:5173`.

### Desktop / Mobile

```bash
npm run electron:dev      # Electron dev
npm run electron:build    # Package for Windows / macOS / Linux
```

For Android, download the APK directly from [Releases](https://github.com/cropflre/nowen-note/releases), or build it yourself with `npx cap sync android && npx cap open android`.

### fnOS (one-click .fpk install)

Grab the latest `nowen-note-x.y.z.fpk` from [Releases](https://github.com/cropflre/nowen-note/releases). On your fnOS NAS, open **App Center → Settings → Install app manually** and pick the file. After installation, click the "Nowen Note" icon on the desktop or open `http://<nas-ip>:3001` in your browser.

> The .fpk currently targets x86_64 fnOS only (`platform=x86`). To build it yourself, see [scripts/fpk/README.md](./scripts/fpk/README.md).

## Configuration

| Env var | Default | Description |
| --- | --- | --- |
| `PORT` | `3001` | Service port |
| `DB_PATH` | `/app/data/nowen-note.db` | Database file path |
| `OLLAMA_URL` | — | Local Ollama endpoint (optional) |

Data persistence: mount **`/app/data`** from the container to the host (not `/data`). The image declares `VOLUME ["/app/data"]`, so mainstream NAS panels will prefill this path.

Backup policy: auto-backups are written to `/app/data/backups` by default, sharing the same volume as the data. Following the 3-2-1 rule, it is strongly recommended to mount `/app/backups` to a separate disk and set `BACKUP_DIR=/app/backups` — see the inline notes in [`docker-compose.yml`](./docker-compose.yml).

## Documentation

- Browser clipper extension (Chrome / Edge): [Chrome Web Store](https://chromewebstore.google.com/detail/nowen-note-web-clipper/nglkodhfdbnfielchjpkjhenfaecafpg)
- Deployment guide (Local / Docker / Desktop / Mobile / Synology / UGREEN / QNAP / fnOS / ZSpace / ARM64): [docs/deployment.md](./docs/deployment.md)
- fnOS .fpk packaging: [scripts/fpk/README.md](./scripts/fpk/README.md)
- ARM64 details: [docs/deploy-arm64.md](./docs/deploy-arm64.md)
- Email backup configuration: [docs/backup-email-smtp.md](./docs/backup-email-smtp.md)
- Editor mode switch: [docs/editor-mode-switch.md](./docs/editor-mode-switch.md)
- Privacy policy: [docs/PRIVACY.md](./docs/PRIVACY.md)
- OpenAPI: once running, visit `/api/openapi.json`

## Support

QQ group: `1093473044`

## License

[GPL-3.0](./LICENSE) — derivative works must also be distributed under GPL-3.0 and preserve the original copyright notice.

<!-- CHANGELOG:BEGIN -->
## 更新日志

> 最近 5 个版本的更新内容，完整历史见 [CHANGELOG.md](./CHANGELOG.md)。

### v1.1.12.2 - 2026-05-29

**修复与优化**：
- 移除笔记卡片切换动画
- 优化 focus-visible 蓝色边框样式
- 默认编辑器字体改为等宽字体

### v1.1.12.1 - 2026-05-29

**上游同步**：基于 cropflre/nowen-note v1.1.12 融合

**上游新增功能**：
- 表格交互优化（行高拖拽、网格选择器、合并按钮、行列增删）
- 阅读密度偏好（宽松/紧凑模式）
- 客户端下载面板 + Gitee 镜像同步
- 搜索按钮上提到笔记标题栏
- Android WebView CSS 兼容性修复（小米8黑屏）

**二次开发功能保留**：
- AI 助手悬浮框支持拖拽移动
- 移除笔记栏日历筛选按钮
- 笔记列表空状态显示导入 Markdown 按钮
- 锁定笔记复制按钮 + 移动拦截
- 主题切换按钮
- Docker 优化（Alpine + UPX 压缩）

### v1.1.9.1 - 2026-05-29

**上游同步**：基于 cropflre/nowen-note v1.1.9 融合

**上游新增功能**：
- 多设备笔记同步优化
- 桌面端云端本地模式与访问控制优化
- 桌面端本地模式重载循环修复

**二次开发功能**：
- AI 助手悬浮框支持拖拽移动
- 移除笔记栏日历筛选按钮
- 笔记列表导入 Markdown 按钮

### v1.1.7.2 - 2026-05-28

**上游同步**：基于 cropflre/nowen-note v1.1.7 融合

**二次开发功能**：
- Docker 优化：Alpine + UPX 压缩（镜像 ~123MB）
- Docker 密码重置：`NOWEN_RESET_PASSWORD` 环境变量
- 注册默认关闭
- AI 角色化 system prompt + 严格 format_markdown
- 主题切换按钮（NavRail 底部）
- 笔记本右键导入 Markdown
- 锁定笔记复制按钮 + 移动拦截
- 禁用拼写检查
- Markdown 导入空行保留
- 移除 NoteCard 切换动画
- 禁用自动更新日志弹窗

### v1.1.6 - 2026-05-26

### ✨ 新增

- **release**: 将绿联 .upk 从一键全量(选项5)中移除，独立到选项10 (78bbdf6)
- **notes**: 支持客户端生成的 UUID 作为笔记 ID（离线创建） (c8d8961)
- **login**: 登录页支持桌面端跳过登录直接用本地 (21c9183)
- **migration**: 本地→云端账号一键迁移（D-2/D-3 + 回滚） (f61a6a9)
- **local-mode**: 本地模式离线读 + 同步引擎 + localStore (660489a)
- **desktop**: Electron 桌面端框架 + 内嵌后端启动 (762e6b0)
- **attachment-preview**: 视频/音频按扩展名兜底 + 抽屉打开时隐藏链接气泡 (33d6c61)
- **editor-mobile**: 移动端顶栏改 iOS 风双行结构 + 桌面面包屑末段截断修复 (235db1f)
- **frontend**: add video embed extension and rich-text video URL support (b8e3493)
- **editor**: auto-convert '- [ ] ' / '- [x] ' to task list (5c9a916)
- **login**: add demo mode banner with one-click credential fill (0a0c271)
- **auth**: 新增体验账号(isDemo) 机制 (8e0ab8a)
- **url-import**: 公众号文章一键导入笔记 (d6c7c17)

### 🐛 修复

- **release**: multi 模式 upk 打包前 buildx --load 各架构镜像 (7cceed0)
- **editor**: TiptapEditor 桌面端样式/行为微调 (7b72d7d)
- **mac-build**: 单架构构建 + .node 魔数 arch 校验，修复 Intel Mac ERR_DLOPEN_FAILED (54a9c90)
- **release**: defer UPK_IMAGE_REF assembly until VERSION is finalized (80390c9)
- **upk**: 改进多架构镜像查找逻辑，支持 DOCKERHUB_REPO 环境变量 (cc57a7f)
- **VideoExtension**: 修正 NodeView props 类型为 ReactNodeViewProps，修复 tsc 报错 (1083377)
- 绿联nas 构建包 (eb15be2)
- **clipper**: split footer build for markdown branch to preserve source link (45402e8)
- **update-notifier**: move useCallback before early return to fix hook order (63f2624)

### 📝 文档

- **readme**: 补 macOS 首次打开 ERR_DLOPEN_FAILED 的 xattr 解隔离指引 (bf108cd)
- **readme**: sync features and changelog with Unreleased (e301e93)

### 📦 构建

- **upk**: 新增绿联 NAS 应用包(.upk) 打包流程 (967d00d)

### 🔧 其他

- **clipper**: release v0.1.3 (5d70c08)

### v1.1.5 - 2026-05-21

### ✨ 新增

- **attachments**: 附件预览抽屉 + 本笔记附件目录面板 (df2e06f)
- **editor**: 搜索替换面板 / docx 自研解析与导入 / 字号弹层优化等 (3a37905)
- **about**: 新增'作者感言'板块及阅读弹窗 (82e872d)

### 📝 文档

- **readme**: add Author's Note link in header (6e5d863)

### v1.1.4 - 2026-05-20

_本版本无可展示的 commit 变更（可能全部是合并 / 工作流修改）_

### v1.1.3 - 2026-05-20

### ✨ 新增

- **trash**: 笔记本删除改为软删，回收站恢复自动还原祖先笔记本链 (aeba393)

### v1.1.2 - 2026-05-19

### ✨ 新增

- **editor**: 弱网防丢字 + 字号颜色 + Mermaid 放大预览 + 列表切换优化 (0ce7da6)

### 🐛 修复

- **import**: /export/import 返回 version=1，避免有道云附件回填触发 VERSION_REQUIRED (331bea7)
- bug (a701dd2)
- **release**: 体检加 lockfile 时间戳兜底，新增依赖自动 npm install (9cd7847)
- **release**: 白名单补 @tiptap/extension-text-style 防 TS2307 (a17aacb)
- 放大图片 (935a5e4)

<!-- CHANGELOG:END -->
