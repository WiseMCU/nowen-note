# 二次开发功能清单

本文档记录所有相对于上游仓库（cropflre/nowen-note）的二次开发功能，用于下次融合上游版本时对照检查。

**上游基线**：v1.1.12 (commit aa9a2fd)
**当前版本**：1.1.12.2
**最后同步**：2026-05-29

## 版本号规则

格式：`主版本.次版本.修订号.自定义版本`

- **主版本.次版本.修订号**：与上游仓库保持一致
- **自定义版本**：二次开发的修改次数，从 1 开始递增
- 当上游更新时，同步上游版本号并**重置自定义版本为 1**

---

## 一、从上游移除的内容

每次融合上游版本后，需要重新移除以下内容：

### 1. iOS 支持
- 删除 `frontend/ios/` 整个目录
- 删除 `.github/workflows/ios-release.yml`
- 删除 `docs/iOS-Release.md`
- 从 `package.json` 移除 `cap:sync:ios`、`cap:open:ios` 脚本
- 从 `frontend/package.json` 移除 `@capacitor/ios` 依赖

### 2. 赞助/打赏
- 删除 `weixin.jpg`（根目录和 frontend/public/）
- 从 `SettingsModal.tsx` 的 AboutPanel 中移除赞助区块（showSponsor、sponsorPreviewOpen、ImageLightbox）
- 从 i18n 中移除 `about.sponsor*` 相关键

### 3. 作者感言
- 删除 `AUTHOR_STORY.md`、`AUTHOR_STORY.en.md`
- 删除 `frontend/public/author-story.*.md`
- 删除 `frontend/src/components/AuthorStoryModal.tsx`
- 从 `SettingsModal.tsx` 移除 AuthorStoryModal 引用和 showAuthorStory 状态

### 4. 体验账号机制
- 从 `backend/src/routes/auth.ts` 移除 `isDemoUser()` 函数及所有守卫
- 从 `backend/src/routes/auth.ts` 的 SELECT 查询中移除 `isDemo` 字段
- 从登录响应中移除 `isDemo` 字段
- 删除 `backend/scripts/seed-demo.mjs`
- 从 `frontend/src/components/LoginPage.tsx` 移除 demo banner 代码
- 从 i18n 中移除 `auth.demoBanner.*` 相关键

### 5. 自动更新日志弹窗
- 在 `frontend/src/App.tsx` 中将 `useWhatsNew(!!user)` 改为 `useWhatsNew(false)`

---

## 二、二次开发功能

### 1. Docker 优化

**文件**：
- `Dockerfile` — Alpine + UPX 压缩
- `.dockerignore` — 全面排除规则
- `docker-entrypoint.sh` — 密码重置 + 版本号自动纠偏
- `.gitattributes` — 强制 .sh 文件 LF 换行

**功能**：
- 镜像从 ~241MB 缩减至 ~123MB（UPX 压缩 Node.js 二进制）
- `NOWEN_RESET_PASSWORD` 环境变量一键重置管理员密码
- 启动时从 `package.json` 自动纠正 `NOWEN_APP_VERSION`

### 2. Docker CI/CD 流水线

**文件**：
- `.github/workflows/docker-publish.yml`
- `docker/description.md`

**功能**：
- 监听 develop 分支 package.json 版本号变化自动发布
- 多架构构建（linux/amd64, linux/arm64）
- 自动更新 Docker Hub 描述

### 3. Android APK 构建

**文件**：`.github/workflows/android-release.yml`

**功能**：
- tag 触发自动构建 APK 并发布到 GitHub Release
- 支持手动触发构建
- 先安装根目录依赖（`@capacitor/cli`），再安装前端依赖

### 4. 后端改动

**文件**：`backend/src/routes/auth.ts`

**功能**：注册默认关闭
```
getRegistrationOpen() 中 if (!row) return false;
```

**文件**：`backend/src/routes/ai.ts`

**功能**：AI 角色化 system prompt
- format 类（format_markdown, format_code）：严格不改原文措辞
- analysis 类（title, tags, summarize, explain）：直接输出分析结果
- edit 类：通用写作助手

**功能**：format_markdown 严格化
```
"仅可添加格式标记，不得改动任何原文措辞、不得自行扩写或删减内容，不得变更段落先后顺序"
```

### 4. 主题切换按钮

**文件**：`frontend/src/components/NavRail.tsx`

**改动**：
- 添加 `import { useTheme } from "next-themes"` 和 `Sun, Moon` 图标
- 在 NavRail 底部（设置按钮下方）添加主题切换按钮

### 5. 笔记本导入 Markdown

**文件**：`frontend/src/components/Sidebar.tsx`

**改动**：
- 添加 `Upload` 图标导入
- notebookMenuItems 中添加 `import_md` 菜单项
- 添加 `importInputRef`、`importNotebookIdRef` 引用
- 添加 `handleImportFiles` 回调函数
- 添加隐藏的 `<input type="file">` 元素

### 6. 笔记列表导入按钮

**文件**：`frontend/src/components/NoteList.tsx`

**改动**：
- 添加 `Upload` 图标导入
- 添加 `importFileInputRef`、`pendingImportNotebookRef` 引用
- 添加 `handleImportClick`、`handleImportFiles`、`executeImport` 函数
- 在移动端和桌面端头部添加导入按钮
- 添加 `pickerMode` 状态支持导入模式的笔记本选择

### 7. 锁定笔记复制按钮

**文件**：`frontend/src/components/TiptapEditor.tsx`

**改动**：
- 在 `editor.setEditable(editable)` effect 后添加复制按钮 effect
- 使用 `addEventListener("mousedown", ..., true)` 捕获阶段拦截
- 使用 `addEventListener("click", ..., true)` 处理复制逻辑
- 按父元素去重：同 parent 只处理一次
- 过滤短文本节点（<=3 字符）
- 排除代码块（pre, .code-block-wrapper）内的文本
- 按钮文本去重：内层按钮文本是外层子串时移除内层

### 8. 锁定笔记移动拦截

**文件**：`frontend/src/components/EditorPane.tsx`

**改动**：
- 在 `handleMoveToNotebook` 函数开头添加 `effectiveLocked` 检查
- 锁定时显示 toast 警告并阻止移动

### 9. MobileFloatingToolbar

**文件**：`frontend/src/components/MobileFloatingToolbar.tsx`（新文件）

**功能**：移动端浮动工具栏，吸附键盘上方

### 10. AI 测试连接 toast

**文件**：`frontend/src/components/AISettingsPanel.tsx`

**改动**：
- 移除 `testResult` 状态和内联显示
- 改用 `toast.success()` / `toast.error()` 弹窗提示
- 添加 `import { toast } from "@/lib/toast"`

### 11. 文件管理清理按钮

**文件**：`frontend/src/components/FileManager.tsx`

**改动**：
- 添加 `cleaning` 状态
- 添加 `handleCleanup` 函数（扫描所有文件，找出未引用的并批量删除）
- 添加 `Eraser` 图标导入
- 在上传按钮后添加"清理未引用"按钮（红色）
- 删除后调用 `invalidateFileListCache()` 清除缓存

### 12. 禁用拼写检查

**文件**：`frontend/src/components/TiptapEditor.tsx`

**改动**：
- 在 `editorProps.attributes` 中添加 `spellcheck: "false"`

### 13. Markdown 导入空行保留

**文件**：`frontend/src/lib/importService.ts`

**改动**：
- 在 `markdownToSimpleHtml` 函数中添加空行检测：连续 4+ 换行转换为 `<!--blank-->` 占位符
- 在 `marked.parse` 后添加空行还原：`<!--blank-->` 替换为 `<p>&nbsp;</p>`

### 14. 段落间距调整

**文件**：`frontend/src/index.css`

**改动**：
- `.ProseMirror p` 的 margin 从 `0.625rem 0` 改为 `0`
- line-height 从 `1.8` 改为 `1.6`
- 添加 `.ProseMirror p + p { margin-top: 0.375rem }`
- 添加 `.ProseMirror p + h1/h2/h3 { margin-top: 0.5rem }`

### 15. 编辑器默认字体

**文件**：`frontend/src/hooks/useSiteSettings.tsx`

**改动**：
- `DEFAULT_CONFIG.editorFontFamily` 从 `""` 改为 `"__mono"`（等宽字体）

### 16. 移除 NoteCard 动画

**文件**：`frontend/src/components/NoteList.tsx`

**改动**：
- NoteCard 组件从 `motion.div` 改为普通 `div`
- 移除 `initial`、`animate`、`exit` 动画属性
- 移除列表的 `AnimatePresence` 包裹

### 17. i18n 新增

**文件**：`frontend/src/i18n/locales/zh-CN.json`、`en.json`

**新增键**：
- `sidebar.importMarkdown` — "导入 Markdown" / "Import Markdown"
- `editor.aiNotConfigured` — "请先在设置中配置 AI 服务" / "Please configure AI service in Settings"

### 18. AI 标题生成修复

**文件**：`backend/src/routes/ai.ts`

**改动**：
- 移除 title 和 tags 的 `max_tokens` 限制，让模型自己决定输出长度
- summarize 的 max_tokens 从 300 提升到 500

**原因**：上游的 max_tokens 限制（title=50, tags=100）过小，导致 AI 生成标题失败

### 19. AI 助手默认全文处理

**文件**：`frontend/src/components/TiptapEditor.tsx`

**改动**：
- 添加 `isFullDocRef` 引用，记录 AI 处理的是全文还是选区
- 修改 `openAIAssistant`：未选中文本时，AI 助手默认处理全文
- 修改 `handleAIInsert`：全文场景插入到文档开头
- 修改 `handleAIReplace`：全文场景替换整个文档

**原因**：上游的 AI 助手只处理选中文本，未选中时行为不符合预期

### 20. 文件管理清理后缓存清除

**文件**：`frontend/src/components/FileManager.tsx`

**改动**：
- 在 `handleCleanup` 删除操作后调用 `invalidateFileListCache()` 清除缓存
- 重置分页到第 1 页

**原因**：上游清理后未清除列表缓存，导致删除的文件仍然显示

### 21. 复制按钮去重逻辑

**文件**：`frontend/src/components/TiptapEditor.tsx`

**改动**：
- 过滤长度 <= 3 的短文本节点
- 排除代码块（`<pre>`、`.code-block-wrapper`）内的文本
- 按父元素去重：同 parent 只处理一次
- 按钮文本去重：内层按钮文本是外层子串时移除内层

**原因**：URL 和启发式正则同时匹配到同一文本时，会出现重复的复制按钮

---

## 三、融合上游版本检查清单

每次融合上游新版本时，按以下步骤操作：

### Step 1: 移除不需要的上游内容
- [ ] 删除 iOS 相关文件
- [ ] 删除赞助/打赏内容
- [ ] 删除作者感言
- [ ] 删除体验账号机制
- [ ] 禁用自动更新日志弹窗

### Step 2: 移植 Docker 优化
- [ ] 替换 Dockerfile（Alpine + UPX）
- [ ] 替换 .dockerignore
- [ ] 替换 docker-entrypoint.sh（密码重置 + 版本纠偏）
- [ ] 保留 .gitattributes
- [ ] 保留 docker-publish.yml
- [ ] 保留 docker/description.md

### Step 3: 移植后端改动
- [ ] auth.ts：注册默认关闭
- [ ] ai.ts：角色化 prompt + 严格 format_markdown
- [ ] ai.ts：移除 title/tags 的 max_tokens 限制

### Step 4: 移植前端功能
- [ ] NavRail.tsx：主题切换按钮
- [ ] Sidebar.tsx：笔记本导入 Markdown
- [ ] NoteList.tsx：导入按钮 + 移除 NoteCard 动画
- [ ] TiptapEditor.tsx：锁定笔记复制按钮 + spellcheck + AI 全文处理
- [ ] EditorPane.tsx：锁定笔记移动拦截
- [ ] FileManager.tsx：清理未引用按钮 + 缓存清除
- [ ] AISettingsPanel.tsx：AI 测试连接 toast
- [ ] App.tsx：禁用自动更新日志
- [ ] importService.ts：空行保留
- [ ] index.css：段落间距
- [ ] useSiteSettings.tsx：默认字体

### Step 5: 检查已上游化的功能
以下功能上游已包含，确认无需重复移植：
- [ ] confirm 弹窗系统
- [ ] FileManager 批量操作
- [ ] NavRail 导航栏
- [ ] MobileFloatingToolbar（检查上游是否已包含）

### Step 6: 构建验证
- [ ] 前端构建通过
- [ ] 后端构建通过
- [ ] Docker 构建通过
- [ ] 功能测试通过

---

## 四、融合经验总结

### 成功经验（v1.1.9 → v1.1.12 融合）

#### 1. 增量合并策略
**不要直接复制替换文件**，而是只添加上游新增的部分。这样可以：
- 保留我们的自定义修改
- 避免丢失已有的功能
- 减少合并冲突

#### 2. 文件分类处理
将需要处理的文件分为三类：
- **无冲突文件**（直接复制）：新文件、我们没有修改的文件
- **有冲突文件**（手动合并）：我们和上游都修改了的文件
- **不需要的文件**（跳过）：iOS、赞助、changelog 等

#### 3. TypeScript 类型收窄问题
当使用三元表达式 `state.viewMode === "trash" ? A : B` 时，在 B 分支中 TypeScript 已经知道 `state.viewMode !== "trash"`，此时再写 `state.viewMode !== "trash" &&` 会报 TS2367 错误。解决方案：删除多余的比较。

#### 4. CSS 变量兼容性
上游将段落间距改为 CSS 变量（`--pm-p-margin`、`--pm-p-line-height`），支持阅读密度切换。我们的自定义修改需要适配这个新架构，而不是直接覆盖固定值。

#### 5. 图标导入变更
上游可能移除或重命名图标（如 `Table2` → `TableGridPicker` 组件）。需要检查并更新所有使用位置。

#### 6. 默认值覆盖问题
后端返回的空字符串会覆盖前端的默认值。例如 `editorFontFamily: data.editor_font_family || ""` 会覆盖 DEFAULT_CONFIG 的 `__mono`。解决方案：使用 `|| "__mono"` 提供正确的默认值。

### 融合流程优化

1. **先分析再动手**：用 `git diff` 查看上游改动，了解新增功能和修改范围
2. **分批处理**：按文件分组处理，每处理完一批就提交，便于回滚
3. **构建验证**：每完成一个阶段就构建验证，及时发现问题
4. **保留备份**：融合前给 develop 打标签，便于回滚

### 常见陷阱

1. **三元表达式类型收窄**：TypeScript 会自动收窄类型，多余的比较会报错
2. **CSS 变量覆盖**：上游可能改为使用 CSS 变量，直接覆盖固定值会破坏主题切换
3. **图标组件变更**：上游可能将图标替换为自定义组件，需要检查导入和使用
4. **后端默认值**：后端返回的空字符串会覆盖前端默认值，需要正确处理
