# nowen-note

自托管私有知识库，对标群晖 Note Station。

A self-hosted private knowledge base, inspired by Synology Note Station.

---

## 中文文档

### 简介

nowen-note 是一款自托管的私有化知识管理应用，采用现代前后端分离架构，支持 Docker 一键部署。集成 Tiptap 富文本编辑器、AI 智能写作助手（支持 6 大 AI 服务商 + 本地 Ollama）、OnlyOffice 在线文档协作（Word/Excel/PPT）、思维导图、任务管理中心、FTS5 全文搜索、数据导入导出等功能，打造一体化知识管理平台。

### 技术栈

| 层级     | 技术                                                         |
| -------- | ------------------------------------------------------------ |
| 前端框架 | React 18 + TypeScript + Vite 5                               |
| 编辑器   | Tiptap 3（代码高亮、图片、任务列表、下划线、文本高亮等）     |
| UI 组件  | Radix UI + shadcn/ui 风格组件 + Lucide Icons                 |
| 样式     | Tailwind CSS 3.4 + Framer Motion                             |
| 国际化   | i18next（中英文切换）                                         |
| 后端框架 | Hono 4 + @hono/node-server                                   |
| 数据库   | SQLite（better-sqlite3）+ FTS5 全文搜索                      |
| 认证     | JWT（jsonwebtoken）+ bcryptjs 密码哈希                       |
| 数据校验 | Zod                                                          |
| 文档协作 | OnlyOffice Document Server（JWT 安全认证）                   |
| AI 引擎  | 通义千问 / OpenAI / Google Gemini / DeepSeek / 豆包 / Ollama |
| 数据处理 | JSZip（压缩打包）、Turndown（HTML→Markdown）、FileSaver      |
| Markdown | react-markdown + remark-gfm（AI 聊天渲染）                   |

### 项目结构

```
nowen-note/
├── frontend/              # 前端 React 应用
│   ├── src/
│   │   ├── components/    # 组件
│   │   │   ├── Sidebar.tsx            # 侧边栏（笔记本树 + 导航 + 标签）
│   │   │   ├── NoteList.tsx           # 笔记列表（多视图 + 右键菜单）
│   │   │   ├── EditorPane.tsx         # 编辑器面板（AI 标题/标签 + 大纲 + 锁定）
│   │   │   ├── TiptapEditor.tsx       # Tiptap 富文本编辑器
│   │   │   ├── AIChatPanel.tsx        # AI 知识库问答面板（RAG + Markdown 渲染）
│   │   │   ├── AIWritingAssistant.tsx # AI 写作助手（10 种文本操作）
│   │   │   ├── AISettingsPanel.tsx    # AI 服务配置（6 大 Provider 卡片）
│   │   │   ├── TaskCenter.tsx         # 任务管理中心
│   │   │   ├── MindMapEditor.tsx      # 思维导图编辑器
│   │   │   ├── DocumentCenter.tsx     # 文档中心（OnlyOffice 集成）
│   │   │   ├── LoginPage.tsx          # 登录页
│   │   │   ├── ContextMenu.tsx        # 通用右键菜单组件
│   │   │   ├── SettingsModal.tsx      # 设置中心（外观/AI/安全/数据）
│   │   │   ├── SecuritySettings.tsx   # 账号安全设置
│   │   │   ├── DataManager.tsx        # 数据管理（导入导出 + 恢复出厂）
│   │   │   ├── MiCloudImport.tsx      # 小米云笔记导入
│   │   │   └── OppoCloudImport.tsx    # OPPO 云便签导入
│   │   ├── hooks/         # 自定义 Hooks
│   │   │   ├── useContextMenu.ts      # 右键菜单状态管理 + 边缘碰撞检测
│   │   │   └── useSiteSettings.tsx    # 站点设置 Context（标题/图标/字体）
│   │   ├── store/         # 状态管理（useReducer + Context）
│   │   ├── lib/           # 工具函数 & API 封装
│   │   │   ├── api.ts              # API 客户端（含 AI 流式接口）
│   │   │   └── miNoteService.ts    # 小米云笔记服务封装
│   │   ├── i18n/          # 国际化配置 & 语言包（中/英）
│   │   └── types/         # 类型定义
│   └── ...
├── backend/               # 后端 Hono 应用
│   └── src/
│       ├── db/            # 数据库 Schema & 迁移（10 张表 + FTS5）
│       ├── routes/        # API 路由（14 个模块）
│       │   ├── auth.ts        # 认证（登录/改密/恢复出厂）
│       │   ├── notebooks.ts   # 笔记本 CRUD（无限层级）
│       │   ├── notes.ts       # 笔记 CRUD（锁定/置顶/收藏）
│       │   ├── tags.ts        # 标签管理
│       │   ├── tasks.ts       # 待办任务（子任务/优先级/截止日期）
│       │   ├── mindmaps.ts    # 思维导图 CRUD
│       │   ├── documents.ts   # 文档管理（OnlyOffice 集成）
│       │   ├── ai.ts          # AI 聊天 + 写作助手 + RAG 知识问答
│       │   ├── search.ts      # FTS5 全文搜索
│       │   ├── export.ts      # 数据导入导出
│       │   ├── settings.ts    # 站点配置（标题/图标/字体）
│       │   ├── fonts.ts       # 自定义字体管理（上传/下载/删除）
│       │   ├── micloud.ts     # 小米云笔记导入 API
│       │   └── oppocloud.ts   # OPPO 云便签导入 API
│       └── index.ts       # 入口文件（JWT 中间件 + 路由注册 + 静态文件托管）
├── Dockerfile             # 多阶段构建（3 阶段）
├── docker-compose.yml     # 容器编排（3 服务 + 4 持久化卷）
└── package.json           # 根级脚本
```

### 安装部署

> **默认管理员账号：`admin` / `admin123`**
>
> 首次登录后请立即在「设置 → 账号安全」中修改密码。

---

#### 方式一：Windows 本地安装（开发 / 体验）

**环境要求：** Node.js 20+、Git

```bash
# 1. 克隆项目
git clone https://github.com/cropflre/nowen-note.git
cd nowen-note

# 2. 安装所有依赖
npm run install:all

# 3. 启动后端（端口 3001）
npm run dev:backend

# 4. 新开一个终端，启动前端（端口 5173，自动代理 /api → 3001）
npm run dev:frontend
```

浏览器访问 `http://localhost:5173` 即可使用。

数据库文件位于 `backend/data/nowen-note.db`，备份此文件即可迁移数据。

---

#### 方式二：Docker 通用安装（推荐）

适用于任何安装了 Docker 的 Linux / macOS / Windows 设备。

**方法 A：docker-compose（推荐）**

```bash
# 1. 克隆项目
git clone https://github.com/cropflre/nowen-note.git
cd nowen-note

# 2. 一键构建并启动（含 OnlyOffice + Ollama）
docker-compose up -d
```

**方法 B：纯 docker 命令（仅主应用）**

```bash
# 1. 克隆并构建镜像
git clone https://github.com/cropflre/nowen-note.git
cd nowen-note
docker build -t nowen-note .

# 2. 创建数据目录并运行
mkdir -p /opt/nowen-note/data
docker run -d \
  --name nowen-note \
  --restart unless-stopped \
  -p 3001:3001 \
  -v /opt/nowen-note/data:/app/data \
  -e DB_PATH=/app/data/nowen-note.db \
  nowen-note
```

浏览器访问 `http://<你的IP>:3001` 即可使用。

**服务端口：**

| 端口 | 服务 | 说明 |
|------|------|------|
| `3001` | nowen-note | 主应用（前后端一体 + SQLite） |
| `8080` | OnlyOffice | Word/Excel/PPT 在线编辑服务器 |
| `11434` | Ollama | 本地 AI 推理服务（可选） |

**环境变量说明：**

| 变量名 | 默认值 | 说明 |
| ------ | ------ | ---- |
| `PORT` | `3001` | 服务监听端口 |
| `DB_PATH` | `/app/data/nowen-note.db` | 数据库文件路径 |
| `NODE_ENV` | `production` | 运行环境 |
| `ONLYOFFICE_URL` | `http://onlyoffice:80` | OnlyOffice 服务地址 |
| `ONLYOFFICE_JWT_SECRET` | `nowen-note-onlyoffice-secret` | OnlyOffice JWT 密钥 |
| `OLLAMA_URL` | `http://ollama:11434` | Ollama 服务地址（Docker 内部） |

---

#### 方式三：群晖 Synology NAS 安装

**前提：** 已安装 Container Manager（DSM 7.2+）或 Docker 套件（DSM 7.0 / 7.1）。

**步骤：**

1. **上传镜像**
   - 在电脑上执行 `docker build -t nowen-note .` 构建镜像
   - 导出镜像：`docker save nowen-note -o nowen-note.tar`
   - 在群晖 Container Manager → 映像 → 导入 → 上传 `nowen-note.tar`

2. **创建容器**
   - 映像列表中选择 `nowen-note` → 启动
   - **端口设置**：本地端口 `3001` → 容器端口 `3001`
   - **存储空间**：新增文件夹映射
     - 本地路径：`/docker/nowen-note/data`
     - 容器路径：`/app/data`
   - **环境变量**（默认即可，无需修改）

3. **访问使用**
   - 浏览器访问 `http://<群晖IP>:3001`

> **提示：** 数据备份只需复制 `/docker/nowen-note/data/nowen-note.db` 文件。可使用群晖 Hyper Backup 定期备份该目录。

---

#### 方式四：绿联 UGOS NAS 安装

**前提：** 已开启 Docker 功能（绿联 UGOS Pro / UGOS）。

**步骤：**

1. **导入镜像**
   - 在电脑上构建并导出镜像（同群晖步骤）
   - 绿联 NAS → Docker → 镜像管理 → 本地导入 `nowen-note.tar`

2. **创建容器**
   - 选择 `nowen-note` 镜像 → 创建容器
   - **网络**：选择 bridge 模式
   - **端口映射**：主机 `3001` → 容器 `3001`
   - **存储映射**：
     - 主机路径：`/mnt/user/appdata/nowen-note/data`（或自定义路径）
     - 容器路径：`/app/data`
   - **重启策略**：开机自启

3. **访问使用**
   - 浏览器访问 `http://<绿联NAS IP>:3001`

---

#### 方式五：飞牛 fnOS 安装

**前提：** 飞牛 fnOS 已开启 Docker 功能。

**步骤：**

1. **导入镜像**
   - 在电脑上构建并导出镜像（同群晖步骤）
   - 飞牛 fnOS → Docker → 镜像 → 导入 `nowen-note.tar`

2. **创建容器**
   - 选择 `nowen-note` 镜像 → 创建容器
   - **端口映射**：主机 `3001` → 容器 `3001`
   - **卷映射**：
     - 主机路径：`/vol1/docker/nowen-note/data`（根据实际存储卷调整）
     - 容器路径：`/app/data`
   - **重启策略**：除非手动停止

3. **访问使用**
   - 浏览器访问 `http://<飞牛NAS IP>:3001`

---

#### 方式六：威联通 QNAP 安装

**前提：** 已安装 Container Station（QTS 5.0+ / QuTS hero）。

**步骤：**

1. **导入镜像**
   - 在电脑上构建并导出镜像（同群晖步骤）
   - Container Station → 映像档 → 导入 → 选择 `nowen-note.tar`

2. **创建容器**
   - 选择 `nowen-note` 映像 → 创建
   - **网络设置**：NAT 模式，端口映射 `3001` → `3001`
   - **共享文件夹**：
     - 主机路径：`/share/Container/nowen-note/data`
     - 容器路径：`/app/data`
   - **其他**：勾选"自动重新启动"

3. **访问使用**
   - 浏览器访问 `http://<威联通IP>:3001`

> **提示：** QNAP 也支持 docker-compose，在 Container Station → 创建 → 使用 YAML 创建，粘贴本项目的 `docker-compose.yml` 内容即可。

---

#### 方式七：极空间 NAS 安装

**前提：** 极空间 ZOS 已开启 Docker 功能（极空间 Z4S / Z4 Pro / Z2 Pro 等）。

**步骤：**

1. **导入镜像**
   - 在电脑上构建并导出镜像（同群晖步骤）
   - 极空间 → Docker → 镜像 → 本地镜像 → 导入 `nowen-note.tar`

2. **创建容器**
   - 选择 `nowen-note` 镜像 → 创建容器
   - **端口映射**：本地 `3001` → 容器 `3001`
   - **路径映射**：
     - 本地路径：选择一个文件夹（如 `极空间/docker/nowen-note/data`）
     - 容器路径：`/app/data`
   - **重启策略**：自动重启

3. **访问使用**
   - 浏览器访问 `http://<极空间IP>:3001`

---

#### 通用注意事项

- **数据持久化**：务必将容器内的 `/app/data` 目录映射到宿主机，否则容器删除后数据丢失
- **数据备份**：只需备份映射目录中的 `nowen-note.db` 文件
- **端口冲突**：如 3001 端口被占用，可修改主机端口映射（如 `8080:3001`）
- **安全建议**：首次登录后请立即修改默认密码；如需外网访问，建议搭配反向代理（Nginx / Caddy）并启用 HTTPS
- **OnlyOffice**：需要 docker-compose 方式部署才能使用文档编辑功能
- **Ollama**：docker-compose 默认包含 Ollama 服务，首次启动需拉取模型（如 `docker exec nowen-ollama ollama pull qwen2.5:7b`）

### 核心功能

#### 认证系统
- JWT Token 认证（30 天有效期）
- 登录页面（带动画与默认账号提示）
- 修改用户名 / 密码（需验证当前密码）
- SHA256 → bcrypt 密码哈希自动升级

#### 笔记管理
- **三栏布局**：侧边栏 + 笔记列表 + 编辑器（均支持拖拽调整宽度，双击恢复默认）
- **Tiptap 富文本编辑器**：Markdown 快捷键、代码高亮、图片插入、任务列表
- **笔记操作**：置顶、收藏、锁定（前后端双层保护）、软删除（回收站）、恢复、永久删除
- **笔记移动**：右键菜单"移动到..."弹窗（树形笔记本选择器）、编辑器顶栏快速切换笔记本
- **字数统计**：实时显示词数和字符数（中文按字计数，英文按空格分词）
- **笔记大纲**：自动提取 H1-H3 标题生成大纲面板，点击标题跳转定位
- **乐观锁**：version 字段防止编辑冲突

#### 笔记本
- 支持无限层级嵌套（树形结构）
- 右键菜单：新建笔记、新建子笔记本、重命名、删除
- 行内重命名：原地 `<input>` 编辑，Enter 保存、Escape 取消

#### AI 智能助手
- **AI 写作助手**：选中文本后触发，支持 10 种操作
  - 续写、重写、润色、缩写、扩写
  - 中英互译、总结、解释、语法修正
  - 支持「替换选中」或「插入到光标后」两种应用方式
- **AI 生成标题**：基于笔记内容一键生成标题
- **AI 推荐标签**：智能推荐标签并自动创建、关联
- **AI 知识问答（RAG）**：
  - 基于 FTS5 + LIKE 模糊检索知识库相关笔记
  - 将检索到的笔记片段作为上下文组装 RAG 提示词
  - SSE 流式输出，Markdown 格式化渲染
  - 支持多轮对话（自动携带最近 6 条历史消息）
  - 显示参考笔记来源标签
- **多 AI 服务商支持**：

| 服务商 | 默认模型 | 说明 |
|--------|---------|------|
| 通义千问 | qwen-plus | 阿里云 DashScope |
| OpenAI | gpt-4o-mini | OpenAI 官方 |
| Google Gemini | gemini-2.0-flash | Google AI Studio |
| DeepSeek | deepseek-chat | DeepSeek 官方 |
| 豆包（火山引擎） | doubao-1.5-pro-32k | 字节跳动 |
| Ollama | qwen2.5:7b | 本地部署，无需 API Key |

- **卡片式 Provider 选择**：渐变色图标、配置状态指示、自动填充 URL 和模型
- **连接测试 & 模型列表拉取**：实时验证配置可用性

#### 文档中心（OnlyOffice）
- **在线编辑**：Word、Excel、PowerPoint 在线协同编辑
- **文档管理**：创建、上传、下载、搜索、重命名、批量删除
- **JWT 安全认证**：OnlyOffice 与应用间的安全通信
- **文件类型**：Word（蓝色）、Excel（绿色）、PPT（橙色）图标区分

#### 思维导图
- 可视化脑图编辑器，自研树形布局算法
- 节点操作：新增子节点、编辑、删除、折叠/展开
- 支持键盘快捷键（Tab/Enter/Delete/Space）
- 小地图导航，缩放平移，触摸手势
- 右键导出：PNG（2x 高清）、SVG、.xmind 格式
- 移动端适配：长按编辑、响应式布局

#### 任务管理
- **任务中心**：独立任务管理面板
- **优先级**：高 / 中 / 低三级优先级
- **截止日期**：日期选择，智能显示（今天/明天/本周/已逾期）
- **子任务**：父子关系任务拆分
- **多维筛选**：全部 / 今天 / 本周 / 逾期 / 已完成
- **任务统计**：完成率、逾期数等摘要

#### 全文搜索
- 基于 SQLite FTS5 虚拟表
- 通过触发器自动同步索引（INSERT/UPDATE/DELETE）
- 搜索 title + contentText

#### 标签系统
- 多对多关系，彩色标签
- 侧边栏标签面板快速筛选

#### 右键菜单系统
- 通用右键菜单组件（毛玻璃面板 + 动画出入场）
- 边缘碰撞检测（菜单不会溢出屏幕）
- 支持分隔线、危险操作高亮、禁用状态
- 笔记本列表 & 笔记列表均支持右键操作

#### 数据管理
- **导出备份**：全量导出为 ZIP 压缩包（Markdown + YAML frontmatter），含进度条
- **导入笔记**：支持拖拽上传 `.md` / `.txt` / `.zip` 文件，可选择目标笔记本
- **小米云笔记导入**：通过 Cookie 认证连接小米云服务，自动获取笔记列表并批量导入
- **OPPO 云便签导入**：提供浏览器控制台提取脚本（OPPO 便签内容 AES 加密，仅页面端解密），一键复制脚本 → 粘贴 JSON → 选择导入
- **恢复出厂设置**：清空所有数据并重置管理员账户，二次确认防误触（需输入 `RESET`）

#### 设置中心
- **外观设置**：主题切换（浅色 / 深色 / 跟随系统）、站点名称与图标自定义
- **字体管理**：内置 4 种字体方案（默认 / 系统 / 衬线 / 等宽）+ 自定义字体上传（支持 otf/ttf/otc/ttc/woff/woff2，支持批量），实时预览
- **AI 设置**：AI 服务商配置、连接测试、模型管理
- **账号安全**：修改用户名和密码
- **数据管理**：导入导出与恢复出厂

#### 主题与交互
- 深色 / 浅色 / 跟随系统三种主题模式
- 侧边栏可折叠（仅图标模式）
- 国际化支持：中英文双语切换
- 移动端响应式布局，触摸手势支持
- Framer Motion 丝滑动画

### Docker Compose 架构

```
┌─────────────────────────────────────────────────────┐
│                   Docker Compose                     │
│                                                     │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────┐ │
│  │ nowen-note  │  │  OnlyOffice  │  │   Ollama   │ │
│  │  :3001      │  │   :8080      │  │  :11434    │ │
│  │             │  │              │  │            │ │
│  │ ┌─────────┐ │  │  Word/Excel/ │  │  本地 AI   │ │
│  │ │Frontend │ │  │  PPT 在线编辑│  │  推理引擎  │ │
│  │ │ React   │ │  │              │  │            │ │
│  │ │ Tiptap  │ │  └──────────────┘  └────────────┘ │
│  │ ├─────────┤ │                                    │
│  │ │Backend  │ │    外部 AI API:                    │
│  │ │ Hono    │◄────► 通义千问 / OpenAI / Gemini     │
│  │ │ SQLite  │ │    DeepSeek / 豆包                  │
│  │ │ JWT     │ │                                    │
│  │ └─────────┘ │                                    │
│  └─────────────┘                                    │
└─────────────────────────────────────────────────────┘
```

| 服务 | 镜像 | 端口 | 持久化卷 | 说明 |
|------|------|------|---------|------|
| nowen-note | 自构建 | 3001 | nowen-note-data | 主应用（前后端一体 + SQLite） |
| onlyoffice | onlyoffice/documentserver | 8080 | onlyoffice-data, onlyoffice-logs | 文档在线编辑服务器（JWT 认证） |
| ollama | ollama/ollama | 11434 | ollama-data | 本地 AI 推理（可选 GPU 加速） |

### 数据库设计

10 张数据表 + 1 张 FTS5 全文搜索虚拟表：

| 表名 | 说明 |
|------|------|
| `users` | 用户表（用户名/密码哈希/头像） |
| `notebooks` | 笔记本（支持 parentId 无限层级嵌套） |
| `notes` | 笔记（JSON 内容 + 纯文本 + 锁定/置顶/收藏/归档/回收站） |
| `tags` | 标签（彩色标签） |
| `note_tags` | 笔记-标签多对多关联 |
| `attachments` | 附件 |
| `tasks` | 待办任务（支持子任务 parentId + 优先级 + 截止日期） |
| `system_settings` | 系统设置键值对（含 AI 配置） |
| `custom_fonts` | 自定义字体 |
| `notes_fts` | FTS5 全文搜索虚拟表（通过触发器自动同步） |

---

## English Documentation

### Introduction

nowen-note is a self-hosted private knowledge management application with a modern frontend-backend separated architecture. It supports one-click Docker deployment, featuring a Tiptap rich-text editor, AI-powered writing assistant (supporting 6 major AI providers + local Ollama), OnlyOffice document collaboration (Word/Excel/PPT), mind mapping, task management, FTS5 full-text search, data import/export, and more — an all-in-one knowledge management platform.

### Tech Stack

| Layer         | Technology                                                                    |
| ------------- | ----------------------------------------------------------------------------- |
| Frontend      | React 18 + TypeScript + Vite 5                                               |
| Editor        | Tiptap 3 (code highlight, image, task list, underline, text highlight, etc.)  |
| UI Components | Radix UI + shadcn/ui style components + Lucide Icons                          |
| Styling       | Tailwind CSS 3.4 + Framer Motion                                             |
| i18n          | i18next (Chinese/English)                                                    |
| Backend       | Hono 4 + @hono/node-server                                                   |
| Database      | SQLite (better-sqlite3) + FTS5 full-text search                              |
| Auth          | JWT (jsonwebtoken) + bcryptjs password hashing                                |
| Validation    | Zod                                                                           |
| Document      | OnlyOffice Document Server (JWT authentication)                               |
| AI Engine     | Qwen / OpenAI / Google Gemini / DeepSeek / Doubao / Ollama                   |
| Data Utils    | JSZip (compression), Turndown (HTML→Markdown), FileSaver                      |
| Markdown      | react-markdown + remark-gfm (AI chat rendering)                              |

### Installation & Deployment

> **Default admin credentials: `admin` / `admin123`**
>
> Please change the password immediately after first login via Settings → Account Security.

---

#### Option 1: Windows Local Install (Dev / Preview)

**Requirements:** Node.js 20+, Git

```bash
# 1. Clone the project
git clone https://github.com/cropflre/nowen-note.git
cd nowen-note

# 2. Install all dependencies
npm run install:all

# 3. Start backend (port 3001)
npm run dev:backend

# 4. Open a new terminal, start frontend (port 5173, auto-proxies /api → 3001)
npm run dev:frontend
```

Visit `http://localhost:5173` in your browser.

#### Option 2: Docker (Recommended)

Works on any device with Docker installed (Linux / macOS / Windows).

**Method A: docker-compose (Recommended)**

```bash
git clone https://github.com/cropflre/nowen-note.git
cd nowen-note
docker-compose up -d
```

**Method B: docker run (main app only)**

```bash
git clone https://github.com/cropflre/nowen-note.git
cd nowen-note
docker build -t nowen-note .

mkdir -p /opt/nowen-note/data
docker run -d \
  --name nowen-note \
  --restart unless-stopped \
  -p 3001:3001 \
  -v /opt/nowen-note/data:/app/data \
  -e DB_PATH=/app/data/nowen-note.db \
  nowen-note
```

Visit `http://<your-ip>:3001` in your browser.

**Service Ports:**

| Port | Service | Description |
|------|---------|-------------|
| `3001` | nowen-note | Main app (frontend + backend + SQLite) |
| `8080` | OnlyOffice | Online document editing server |
| `11434` | Ollama | Local AI inference (optional) |

**Environment Variables:**

| Variable | Default | Description |
| -------- | ------- | ----------- |
| `PORT` | `3001` | Server listen port |
| `DB_PATH` | `/app/data/nowen-note.db` | Database file path |
| `NODE_ENV` | `production` | Runtime environment |
| `ONLYOFFICE_URL` | `http://onlyoffice:80` | OnlyOffice service URL |
| `ONLYOFFICE_JWT_SECRET` | `nowen-note-onlyoffice-secret` | OnlyOffice JWT secret |
| `OLLAMA_URL` | `http://ollama:11434` | Ollama service URL (Docker internal) |

#### Option 3: NAS Deployment (Synology / QNAP / UGREEN / fnOS / Zspace)

All NAS platforms with Docker support follow the same general steps:

1. **Build & export image** on your PC: `docker build -t nowen-note . && docker save nowen-note -o nowen-note.tar`
2. **Import** `nowen-note.tar` into your NAS Docker manager
3. **Create container** with:
   - Port mapping: host `3001` → container `3001`
   - Volume mapping: host folder → container `/app/data`
   - Restart policy: always / unless-stopped
4. Visit `http://<nas-ip>:3001`

> **Important:** Always map the `/app/data` directory to persist your database. Back up the `nowen-note.db` file for data safety.

### Key Features

#### Authentication
- JWT Token authentication (30-day expiry)
- Login page with animation and default credential hints
- Change username / password (requires current password verification)
- Automatic SHA256 → bcrypt password hash upgrade

#### Note Management
- **Three-column layout**: Sidebar + Note List + Editor (all resizable via drag, double-click to reset)
- **Tiptap rich-text editor**: Markdown shortcuts, code highlighting, image upload, task lists
- **Note operations**: Pin, favorite, lock (frontend + backend dual-layer protection), soft delete (trash), restore, permanent delete
- **Move notes**: Right-click "Move to..." modal (tree notebook selector) + quick notebook switch in editor header
- **Word count**: Real-time word and character count (CJK characters counted individually, English by whitespace)
- **Note outline**: Auto-extract H1-H3 headings into outline panel with click-to-scroll navigation
- **Optimistic locking**: Version field to prevent edit conflicts

#### Notebooks
- Unlimited nested hierarchy (tree structure)
- Context menu: New note, new sub-notebook, rename, delete
- Inline rename: In-place `<input>` editing, Enter to save, Escape to cancel

#### AI Smart Assistant
- **AI Writing Assistant**: Triggered on text selection, 10 operations
  - Continue, rewrite, polish, shorten, expand
  - Translate (CN↔EN), summarize, explain, fix grammar
  - Apply via "Replace selection" or "Insert after cursor"
- **AI Title Generation**: One-click title generation based on note content
- **AI Tag Suggestion**: Smart tag recommendation with auto-creation
- **AI Knowledge Q&A (RAG)**:
  - Retrieves related notes via FTS5 + LIKE fuzzy search
  - Assembles RAG prompt with note snippets as context
  - SSE streaming output with Markdown rendering
  - Multi-turn conversation (last 6 messages as history)
  - Displays referenced note source tags
- **Multi-provider support**:

| Provider | Default Model | Description |
|----------|--------------|-------------|
| Qwen | qwen-plus | Alibaba DashScope |
| OpenAI | gpt-4o-mini | OpenAI Official |
| Google Gemini | gemini-2.0-flash | Google AI Studio |
| DeepSeek | deepseek-chat | DeepSeek Official |
| Doubao (Volcengine) | doubao-1.5-pro-32k | ByteDance |
| Ollama | qwen2.5:7b | Local deployment, no API key needed |

- **Card-style provider selection**: Gradient icons, config status indicators, auto-fill URL & model
- **Connection test & model list fetch**: Real-time configuration validation

#### Document Center (OnlyOffice)
- **Online editing**: Word, Excel, PowerPoint online collaborative editing
- **Document management**: Create, upload, download, search, rename, batch delete
- **JWT authentication**: Secure communication between OnlyOffice and the app
- **File type icons**: Word (blue), Excel (green), PPT (orange)

#### Mind Mapping
- Visual mind map editor with custom tree layout algorithm
- Node operations: add child, edit, delete, collapse/expand
- Keyboard shortcuts (Tab/Enter/Delete/Space)
- Mini-map navigation, zoom/pan, touch gestures
- Right-click export: PNG (2x HD), SVG, .xmind format
- Mobile responsive: long-press to edit, adaptive layout

#### Task Management
- **Task Center**: Dedicated task management panel
- **Priority levels**: High / Medium / Low
- **Due dates**: Date picker with smart display (today/tomorrow/this week/overdue)
- **Subtasks**: Parent-child task breakdown
- **Multi-filter**: All / Today / This Week / Overdue / Completed
- **Task statistics**: Completion rate, overdue count summary

#### Full-text Search
- Based on SQLite FTS5 virtual tables
- Auto-synced via triggers (INSERT/UPDATE/DELETE)
- Searches both title and contentText

#### Tag System
- Many-to-many relationships with colored tags
- Sidebar tag panel for quick filtering

#### Context Menu System
- Reusable component (frosted glass panel + animated transitions)
- Edge collision detection (menu never overflows screen)
- Supports separators, danger action highlighting, disabled states
- Available on both notebook tree and note list

#### Data Management
- **Export backup**: Full export as ZIP archive (Markdown + YAML frontmatter) with progress bar
- **Import notes**: Drag-and-drop `.md` / `.txt` / `.zip` files, choose target notebook
- **Mi Cloud import**: Connect to Xiaomi Cloud via cookie authentication, auto-fetch and batch import
- **OPPO Cloud import**: Browser console extraction script (AES-encrypted, client-side only), copy script → paste JSON → import
- **Factory reset**: Wipe all data and reset admin account, requires typing `RESET` to confirm

#### Settings Center
- **Appearance**: Theme switch (light / dark / system), custom site name and favicon
- **Font management**: 4 built-in font schemes (default / system / serif / monospace) + custom font upload (otf/ttf/otc/ttc/woff/woff2, batch upload), live preview
- **AI settings**: AI provider configuration, connection test, model management
- **Account Security**: Change username and password
- **Data Management**: Import/export and factory reset

#### Theme & Interaction
- Light / Dark / System three theme modes
- Collapsible sidebar (icon-only mode)
- Internationalization: Chinese/English language switching
- Mobile responsive layout with touch gesture support
- Smooth Framer Motion animations

### Docker Compose Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Docker Compose                     │
│                                                     │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────┐ │
│  │ nowen-note  │  │  OnlyOffice  │  │   Ollama   │ │
│  │  :3001      │  │   :8080      │  │  :11434    │ │
│  │             │  │              │  │            │ │
│  │ ┌─────────┐ │  │  Word/Excel/ │  │  Local AI  │ │
│  │ │Frontend │ │  │  PPT editing │  │  inference │ │
│  │ │ React   │ │  │              │  │            │ │
│  │ │ Tiptap  │ │  └──────────────┘  └────────────┘ │
│  │ ├─────────┤ │                                    │
│  │ │Backend  │ │    External AI APIs:               │
│  │ │ Hono    │◄────► Qwen / OpenAI / Gemini         │
│  │ │ SQLite  │ │    DeepSeek / Doubao               │
│  │ │ JWT     │ │                                    │
│  │ └─────────┘ │                                    │
│  └─────────────┘                                    │
└─────────────────────────────────────────────────────┘
```

| Service | Image | Port | Volumes | Description |
|---------|-------|------|---------|-------------|
| nowen-note | Self-built | 3001 | nowen-note-data | Main app (frontend + backend + SQLite) |
| onlyoffice | onlyoffice/documentserver | 8080 | onlyoffice-data, onlyoffice-logs | Online document editing (JWT auth) |
| ollama | ollama/ollama | 11434 | ollama-data | Local AI inference (optional GPU) |
