# nowen-note

自托管私有知识库，对标群晖 Note Station。支持 Docker 一键部署、Electron 桌面客户端、Android 移动端。

## 核心功能

- 富文本编辑器（Tiptap）+ Markdown 编辑器（CodeMirror 6）双模式
- AI 智能助手：通义千问 / OpenAI / Gemini / DeepSeek / 豆包 / Ollama
- 实时协作编辑（WebSocket + Y.js CRDT）
- 全文检索、笔记分享、版本历史、任务清单、思维导图
- 附件上传、自定义字体、多工作空间、日记、快速备忘
- 数据导入：小米云 / Oppo 云 / iCloud / Markdown / HTML / Word

## 快速部署

```bash
docker run -d --name nowen-note --restart unless-stopped \
  -p 3001:3001 \
  -v /opt/nowen-note/data:/app/data \
  wisemcu/nowen-note:latest
```

浏览器打开 `http://localhost:3001`（或 NAS IP:3001）。

**默认账号**：`admin` / `admin123`（登录后请立即修改）。

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3001` | 服务端口 |
| `DB_PATH` | `/app/data/nowen-note.db` | SQLite 数据库路径 |
| `JWT_SECRET` | 自动生成并持久化 | JWT 签名密钥 |
| `OLLAMA_URL` | （空） | Ollama 服务地址 |
| `DISABLE_MDNS` | （空） | 设为 `1` 禁用局域网发现 |

## 更新日志

### v1.0.22

- Docker 镜像体积优化：运行时切换至 Alpine，从约 236MB 降至约 100MB
- README 补充原始项目来源说明
- 修复 v1.0.21 提交记录中的编码问题

### v1.0.21

- 禁用编辑器拼写检查，消除 API Key / URL 下红色波浪线
- 修复粘贴配置类文本被误识别为代码块
- 段落间距规范化：空行不再异常增高，标题与正文间距更紧凑
- 修复 AI 生成标题在 DeepSeek-R1 等推理模型下失败的问题
- 新增 Docker 镜像自动构建与发布（amd64 + arm64 双架构）

### v1.0.20

- 项目初始发布
