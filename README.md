# nowen-note

> 自托管的私有知识库，对标群晖 Note Station。
>
> A self-hosted private knowledge base. [English README](./README.en.md)

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/Node-20%2B-green.svg)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED.svg?logo=docker&logoColor=white)](./Dockerfile)

## 功能概览

- **富文本 + Markdown 双引擎**：Tiptap 3 + CodeMirror 6，共享 AI、版本历史、评论等上层能力
- **AI 助手**：支持通义千问 / OpenAI / Gemini / DeepSeek / 豆包 / Ollama，覆盖写作辅助、生成标题、推荐标签、RAG 知识问答
- **知识管理**：无限层级笔记本、彩色标签、任务、思维导图、说说、FTS5 全文搜索
- **协作 & 历史**：分享（密码 / 有效期 / 权限 / 评论）、版本回溯
- **自动化**：沙箱插件系统、Webhook、审计日志、定时自动备份
- **多端**：Web / Electron（Win/macOS/Linux）/ Android（Capacitor）
- **开发者生态**：MCP Server、TypeScript SDK、CLI、浏览器剪藏扩展、OpenAPI 3.0（见 [`packages/`](./packages)）

## 技术栈

React 18 · TypeScript · Vite 5 · Tiptap 3 · Tailwind · Hono 4 · SQLite(FTS5) · JWT · Electron 33 · Capacitor 8

## 截图

### 桌面端

| AI 写作助手 | AI 服务商配置 |
| :---: | :---: |
| ![桌面 AI 写作](./docs/screenshots/desktop-ai-writing.png) | ![AI 设置](./docs/screenshots/settings-ai.png) |

### 移动端（Android / Capacitor）

| 侧边栏 | 笔记列表 | 编辑器 |
| :---: | :---: | :---: |
| ![移动端侧边栏](./docs/screenshots/mobile-sidebar.png) | ![移动端列表](./docs/screenshots/mobile-list.png) | ![移动端编辑器](./docs/screenshots/mobile-editor.png) |

## 快速开始

> 默认管理员：`admin` / `admin123`，首次登录后请立即修改密码。

### Docker（推荐）

```bash
git clone https://github.com/cropflre/nowen-note.git
cd nowen-note
docker-compose up -d
```

访问 `http://<你的IP>:3001`。

### 本地开发

需要 Node.js 20+。

```bash
git clone https://github.com/cropflre/nowen-note.git
cd nowen-note
npm run install:all
npm run dev:backend   # 后端 :3001
npm run dev:frontend  # 前端 :5173
```

访问 `http://localhost:5173`。

### 桌面端 / 移动端

```bash
npm run electron:dev      # Electron 开发
npm run electron:build    # 打包 Windows / macOS / Linux
```

Android 可直接从 [Releases](https://github.com/cropflre/nowen-note/releases) 下载 APK，或 `npx cap sync android && npx cap open android` 自行构建。

## 配置

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3001` | 服务端口 |
| `DB_PATH` | `/app/data/nowen-note.db` | 数据库文件路径 |
| `OLLAMA_URL` | — | 本地 Ollama 地址（可选） |

数据持久化：容器需将 **`/app/data`** 映射到宿主机（不是 `/data`）。镜像已声明 `VOLUME ["/app/data"]`，主流 NAS 面板会自动预填该路径。

备份策略：自动备份默认写入 `/app/data/backups`，与数据在同一个卷。建议按 3-2-1 原则把 `/app/backups` 另挂到独立磁盘，并设置 `BACKUP_DIR=/app/backups`，详见 [`docker-compose.yml`](./docker-compose.yml) 内的注释。

## 文档

- 部署指南（本地 / Docker / 桌面 / 移动 / 群晖 / 绿联 / 威联通 / 飞牛 / 极空间 / ARM64）：[docs/deployment.md](./docs/deployment.md)
- ARM64 详解：[docs/deploy-arm64.md](./docs/deploy-arm64.md)
- 邮件备份配置：[docs/backup-email-smtp.md](./docs/backup-email-smtp.md)
- 编辑器模式切换：[docs/editor-mode-switch.md](./docs/editor-mode-switch.md)
- 隐私策略：[docs/PRIVACY.md](./docs/PRIVACY.md)
- OpenAPI：运行后访问 `/api/openapi.json`

## 问题反馈

QQ 群：`1093473044`

## 支持作者

如果这个项目对你有帮助，欢迎扫码请作者喝杯咖啡 ☕

<p align="center">
  <img src="./weixin.jpg" alt="微信赞赏码" width="280" />
</p>

## 开源协议

[GPL-3.0](./LICENSE) — 派生作品对外分发时须同样以 GPL-3.0 开源并保留原作者版权声明。
