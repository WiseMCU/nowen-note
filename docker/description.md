# nowen-note

自托管私有知识库，对标群晖 Note Station。支持 Docker 一键部署、Electron 桌面客户端、Android 移动端。

> **本项目基于 [cropflre/nowen-note](https://github.com/cropflre/nowen-note) 二次开发。**
> This project is a fork of [cropflre/nowen-note](https://github.com/cropflre/nowen-note).
> 上游仓库 / Upstream: <https://github.com/cropflre/nowen-note>

## 核心功能

- 富文本编辑器（Tiptap）+ Markdown 编辑器（CodeMirror 6）双模式
- AI 智能助手：通义千问 / OpenAI / Gemini / DeepSeek / 豆包 / Ollama
- 实时协作编辑（WebSocket + Y.js CRDT）
- 全文检索、笔记分享、版本历史、任务清单、思维导图
- 文件管理：上传/下载/删除/分类/搜索/预览/反向引用跳转
- 附件上传、自定义字体、多工作空间、日记、快速备忘
- 数据导入：小米云 / Oppo 云 / iCloud / Markdown / HTML / Word / 有道笔记
- 数据导出：Markdown / PDF / SVG / ZIP 备份
- 备份一键发送邮箱（QQ/163/Gmail/Outlook SMTP）

## 快速部署

```bash
docker run -d --name nowen-note --restart unless-stopped \
  -p 3001:3001 \
  -v /opt/nowen-note/data:/app/data \
  wisemcu/nowen-note:latest
```

浏览器打开 `http://localhost:3001`（或 NAS IP:3001）。

**默认账号**：`admin` / `admin123`（登录后请立即修改）。

**忘记密码？** 设置环境变量 `NOWEN_RESET_PASSWORD` 重启容器即可重置：

```bash
docker run -d --name nowen-note --restart unless-stopped \
  -p 3001:3001 \
  -v /opt/nowen-note/data:/app/data \
  -e NOWEN_RESET_PASSWORD=你的新密码 \
  wisemcu/nowen-note:latest
```

密码重置成功后会在数据卷生成 `.password_reset_done` 标记，后续重启即使环境变量还在也不会重复重置。如需再次重置，**先删除数据卷中的 `.password_reset_done` 文件**再重启。

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3001` | 服务端口 |
| `DB_PATH` | `/app/data/nowen-note.db` | SQLite 数据库路径 |
| `JWT_SECRET` | 自动生成并持久化 | JWT 签名密钥 |
| `OLLAMA_URL` | （空） | Ollama 服务地址 |
| `DISABLE_MDNS` | （空） | 设为 `1` 禁用局域网发现 |
| `NOWEN_RESET_PASSWORD` | （空） | 设置后重启容器将管理员密码重置为该值 |
| `SMTP_HOST` | （空） | SMTP 服务器地址（备份邮件发送） |
| `SMTP_PORT` | `465` | SMTP 端口 |
| `SMTP_USER` | （空） | SMTP 登录用户名 |
| `SMTP_PASS` | （空） | SMTP 登录密码 |
| `SMTP_FROM` | （空） | 发件人邮箱地址 |

## 版本号规则

格式：`主版本.次版本.修订号.自定义版本`

- **主版本.次版本.修订号**：与上游仓库保持一致
- **自定义版本**：二次开发的修改次数，从 1 开始递增
- 当上游更新时，同步上游版本号并**重置自定义版本为 1**

## 更新日志

### v1.1.9.1

**上游同步**：基于 cropflre/nowen-note v1.1.9 (commit 68065b9) 融合

**上游新增功能**：
- 多设备笔记同步优化
- 桌面端云端本地模式与访问控制优化
- 修复后端实时删除广播编译错误
- 桌面端本地模式重载循环修复
- 访问控制默认开关调整
- upk 绿联打包配置更新

**二次开发功能**：
- AI 助手悬浮框支持拖拽移动
- 移除笔记栏日历筛选按钮
- 笔记列表空状态显示导入 Markdown 按钮（垂直排列）
- 笔记列表顶部添加导入 Markdown 按钮

### v1.1.7.2

**上游同步**：基于 cropflre/nowen-note v1.1.7 (commit 53c2e4d) 融合

**二次开发功能**：
- Docker 优化：Alpine + UPX 压缩（镜像 ~123MB）
- Docker 密码重置：`NOWEN_RESET_PASSWORD` 环境变量
- Docker 版本号自动纠偏
- 注册默认关闭
- AI 角色化 system prompt + 严格 format_markdown
- AI 标题生成修复（移除 max_tokens 限制）
- AI 助手默认全文处理
- 主题切换按钮（NavRail 底部）
- 笔记本右键导入 Markdown
- 笔记列表导入按钮
- 锁定笔记复制按钮 + 移动拦截
- 文件管理清理未引用按钮
- 禁用拼写检查
- Markdown 导入空行保留
- 段落间距/默认字体调整
- 移除 NoteCard 切换动画
- 禁用自动更新日志弹窗

**上游新增功能**：
- 用户偏好系统（useUserPreferences）：大纲默认开关、进入笔记自动锁定
- 附件健康检查与修复功能
- 笔记本软删除 + 回收站恢复
- Mermaid 图表 / LaTeX 数学公式 / 脚注
- 视频嵌入扩展（Bilibili、YouTube、腾讯视频）
- 搜索替换面板
- DOCX 自研解析器
- 公众号文章一键导入
- 附件预览抽屉
- AI 多会话 / 批量操作 / RAG 知识库
- 本地模式 / 离线阅读 / 同步引擎
- Electron 桌面端框架 + 内嵌后端启动

**二次开发功能**：
- Docker 优化：Alpine + UPX 压缩（镜像 ~123MB）
- Docker 密码重置：`NOWEN_RESET_PASSWORD` 环境变量
- Docker 版本号自动纠偏：启动时从 package.json 纠正版本号
- 注册默认关闭
- AI 角色化 system prompt（format/analysis/edit 三类）
- AI format_markdown 严格化（不改原文措辞）
- AI 标题生成修复：移除 max_tokens 限制
- AI 助手默认全文处理
- 主题切换按钮（NavRail 底部）
- 笔记本右键导入 Markdown
- 笔记列表导入按钮
- 锁定笔记复制按钮 + 移动拦截
- 文件管理清理未引用按钮
- 禁用拼写检查
- Markdown 导入空行保留
- 段落间距调整
- 编辑器默认等宽字体
- 移除 NoteCard 切换动画
- 禁用登录后自动更新日志弹窗

### v1.0.28

- 文件管理：新增多选批量操作（选择模式 / 全选 / 批量删除）
- 文件管理：新增一键清理未引用文件（扫描全量文件 references，自动删除无引用文件）
- 新增全局确认弹窗组件（`ui/confirm.tsx`），替代浏览器原生 `window.confirm/prompt`
- 文件管理：支持 Ctrl+V 粘贴上传文件
- 文件管理、数据管理等：确认/输入弹窗统一迁移至新组件
- 后端新增 `POST /api/files/batch-delete` 批量删除端点

### v1.0.27

- Docker 镜像体积大幅优化：241MB → 68MB（UPX 压缩 + 裸 Alpine 运行时）
- 修复"所有笔记"视图下导入笔记按钮无响应的问题（改为先选笔记本再选文件）
- 同步上游文档：README 重构为极简版，新增英文版 README 和 10 种部署方式指南
- 新增 .gitattributes 强制 Shell 脚本 LF 换行符

### v1.0.26

- 新增文件管理模块：上传/下载/删除/分类/搜索/预览/反向引用跳转
- 备份一键发送邮箱（支持 QQ/163/Gmail/Outlook SMTP 配置）
- 支持导入外部 .bak/.zip 备份到备份仓库
- 单笔记导出 PDF / SVG
- 标签右键/长按切换颜色（TagColorPopover 浮层）
- 数据管理引入二级 Tab 分栏重构
- 编辑器修复：图片序号不再顺延、邮箱链接不误唤起邮件客户端
- 修复实时协作中本人编辑时误提示"XX 正在编辑"
- 导出空段落往返修复：导出 .md 后重新导入不再丢失空白行
- 笔记列表移除切换动画，消除多笔记切换时的向上冲效果
- 编辑器默认字体改为等宽字体（可在设置→外观中切换）
- 笔记本右键菜单新增导入 Markdown
- NoteList 空笔记本和日历旁新增导入笔记快捷按钮
- 融合上游 v1.0.26 全部更新

### v1.0.25

- 锁定笔记自动显示复制按钮（DOM splitText 精准定位 + 去重）
- 侧边栏重构：笔记本上移、导航/标签折叠、主题切换按钮
- AI 测试连接改为 toast 通知
- frontmatter 收尾 --- 补全 + CRLF 兼容
- Docker 密码重置仅生效一次（防重复标记）

### v1.0.24

- 锁定笔记后自动显示一键复制按钮，点击即可复制 URL、密钥、模型名等敏感内容
- 编辑器拼写检查默认关闭，消除 API Key 下方红色波浪线
- 修复粘贴配置类文本被误识别为代码块的问题
- 段落/标题间距规范化，空行不再异常增高
- 修复 AI 生成标题在 DeepSeek-R1 等推理模型下失败的问题
- AI Markdown 格式化不再篡改原文措辞
- AI 助手悬浮面板支持拖拽移动
- 未选中内容时 AI 助手默认处理全文
- 公开用户注册默认关闭
- Docker 镜像进一步精简（UPX 压缩 + 裸 Alpine 运行时，241MB → 123MB）
- 融合上游仓库大量更新：RAG 语义搜索、向量存储、日记/任务增强、导出优化等

### v1.0.23

- AI Markdown 格式化不再改动原文措辞，仅添加格式标记
- AI 助手悬浮面板支持拖拽移动
- 未选中内容时 AI 助手默认处理全文，替换/插入行为适配
- Docker 镜像体积优化（运行时切换 Alpine，约 236MB → 100MB）
- 导出功能增强：图片 base64 内联、下划线转义修复、双空行折叠

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
