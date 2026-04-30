/**
 * 任务附件路由（/api/task-attachments）
 * ---------------------------------------------------------------------------
 * 背景：
 *   待办事项模块（TaskCenter）支持在新建任务时插入图片。任务的 title 字段
 *   会以 Markdown 形式保存图片标记 `![filename](/api/task-attachments/<id>)`，
 *   渲染时在列表里显示成缩略图，详情面板里显示成完整图片。
 *
 *   不复用 attachments 表的原因：
 *     - attachments.noteId 强外键到 notes 表（NOT NULL + CASCADE）；
 *     - attachments 的 ACL 是按 note 的 read/write 权限做的，与 task 模型不一致；
 *     - 拆分后双方独立演进，任务的"用户级附件"语义更清晰。
 *
 *   不复用 base64 内联的原因：
 *     - 与 notes.content 同样的问题：title 字段会膨胀，列表 SQL 拖慢；
 *     - 浏览器无法对 data URI 缓存，每次刷新都要重新解码。
 *
 * 模块导出：
 *   - taskAttachmentsAuthRouter：挂在 /api/task-attachments，走 JWT 中间件。
 *     承接 POST（上传）/ DELETE。
 *   - handleDownloadTaskAttachment：挂在 JWT 中间件**之前**的下载 handler，
 *     与 attachments 同款"id 不可枚举"授权模型。
 *
 * 文件复用同一个 ATTACHMENTS_DIR：
 *   省掉再开一个目录，文件名仍然是 uuid+ext，与 attachments 不会冲突。
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { getDb } from "../db/schema";
import { v4 as uuid } from "uuid";
import fs from "fs";
import path from "path";
import { ensureAttachmentsDir, getAttachmentsDir, MIME_TO_EXT } from "./attachments";

// 与 attachments 一致的 MIME 白名单（图片类）。
// 任务附件场景几乎都是截图/示意图，先与笔记模块保持一致；后续若要支持文件
// 附件再放宽。
const ALLOWED_IMAGE_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/svg+xml",
  "image/x-icon",
  "image/vnd.microsoft.icon",
]);

// 单个附件最大 50MB（与 attachments 对齐）。
const MAX_ATTACHMENT_SIZE = 50 * 1024 * 1024;

/**
 * 不需要 JWT 的下载 handler。index.ts 直接把它挂在 JWT 中间件**之前**。
 *
 * 授权模型：与 attachments 完全一致——uuid 不可枚举即视为隐式授权。
 * 任务列表是用户私有的，附件 id 仅在用户自己的 task.title 里存在，泄露面
 * 与笔记附件等同。
 */
export function handleDownloadTaskAttachment(c: Context): Response {
  const id = c.req.param("id");
  const db = getDb();
  const row = db
    .prepare("SELECT id, mimeType, path FROM task_attachments WHERE id = ?")
    .get(id) as { id: string; mimeType: string; path: string } | undefined;
  if (!row) return c.json({ error: "附件不存在" }, 404);

  const absPath = path.join(getAttachmentsDir(), row.path);
  if (!fs.existsSync(absPath)) {
    return c.json({ error: "附件文件丢失" }, 404);
  }

  const buffer = fs.readFileSync(absPath);
  return new Response(buffer, {
    headers: {
      "Content-Type": row.mimeType || "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}

const app = new Hono();

/**
 * 上传任务附件。
 *
 * 请求：
 *   POST /api/task-attachments
 *   multipart/form-data：
 *     file:   File
 *     taskId: string  // 可选——新任务尚未创建时不传，前端创建 task 后再 PATCH 关联
 *
 * 响应：
 *   { id, url, mimeType, size, filename }
 *   url = `/api/task-attachments/<id>`，前端写到 markdown 图片标记里。
 *
 * 权限：登录用户即可上传到自己名下；若传了 taskId，校验该 task 属于当前用户。
 */
app.post("/", async (c) => {
  const userId = c.req.header("X-User-Id") || "";
  const db = getDb();

  let body: Record<string, any>;
  try {
    body = await c.req.parseBody();
  } catch {
    return c.json({ error: "invalid multipart body" }, 400);
  }

  const file = body.file;
  const taskId = typeof body.taskId === "string" && body.taskId ? body.taskId : null;

  if (!(file instanceof File)) {
    return c.json({ error: "file 字段缺失或非文件" }, 400);
  }

  // ACL：若指定 taskId，必须属于当前用户；不传 taskId 表示"待绑定的孤儿"，
  // 由前端在 createTask 后调用 PATCH 关联，超时未关联走清理脚本。
  if (taskId) {
    const task = db
      .prepare("SELECT userId FROM tasks WHERE id = ?")
      .get(taskId) as { userId: string } | undefined;
    if (!task) return c.json({ error: "任务不存在" }, 404);
    if (task.userId !== userId) {
      return c.json({ error: "无权向该任务上传附件", code: "FORBIDDEN" }, 403);
    }
  }

  if (file.size > MAX_ATTACHMENT_SIZE) {
    return c.json(
      { error: `文件过大（最大 ${MAX_ATTACHMENT_SIZE / 1024 / 1024}MB）` },
      413,
    );
  }
  const mime = (file.type || "application/octet-stream").toLowerCase();
  if (!ALLOWED_IMAGE_MIMES.has(mime)) {
    return c.json({ error: `不支持的 MIME 类型: ${mime}` }, 415);
  }

  ensureAttachmentsDir();
  const id = uuid();
  const ext = MIME_TO_EXT[mime] || "bin";
  const filename = `${id}.${ext}`;
  const savePath = path.join(getAttachmentsDir(), filename);

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(savePath, buffer);
  } catch (err: any) {
    return c.json({ error: `写入文件失败: ${err?.message || err}` }, 500);
  }

  try {
    db.prepare(
      `INSERT INTO task_attachments (id, taskId, userId, filename, mimeType, size, path)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, taskId, userId, file.name || filename, mime, file.size, filename);
  } catch (err: any) {
    try { fs.unlinkSync(savePath); } catch { /* ignore */ }
    return c.json({ error: `写入数据库失败: ${err?.message || err}` }, 500);
  }

  return c.json(
    {
      id,
      url: `/api/task-attachments/${id}`,
      mimeType: mime,
      size: file.size,
      filename: file.name || filename,
    },
    201,
  );
});

/**
 * 把孤儿附件关联到具体 task（前端在 createTask 之后调用）。
 * 同时校验当前用户对该 task 的所有权。
 */
app.patch("/:id/bind", async (c) => {
  const userId = c.req.header("X-User-Id") || "";
  const db = getDb();
  const id = c.req.param("id");

  let body: any;
  try { body = await c.req.json(); } catch { body = {}; }
  const taskId = typeof body.taskId === "string" ? body.taskId : "";
  if (!taskId) return c.json({ error: "taskId 必传" }, 400);

  const att = db
    .prepare("SELECT id, userId FROM task_attachments WHERE id = ?")
    .get(id) as { id: string; userId: string } | undefined;
  if (!att) return c.json({ error: "附件不存在" }, 404);
  if (att.userId !== userId) {
    return c.json({ error: "无权绑定该附件", code: "FORBIDDEN" }, 403);
  }

  const task = db
    .prepare("SELECT userId FROM tasks WHERE id = ?")
    .get(taskId) as { userId: string } | undefined;
  if (!task) return c.json({ error: "任务不存在" }, 404);
  if (task.userId !== userId) {
    return c.json({ error: "无权操作该任务", code: "FORBIDDEN" }, 403);
  }

  db.prepare("UPDATE task_attachments SET taskId = ? WHERE id = ?").run(taskId, id);
  return c.json({ success: true });
});

/**
 * 删除附件。一般在用户主动从 task.title 里去掉图片时由前端调用；
 * task 被删除时数据库 ON DELETE CASCADE 自动清行，物理文件靠定期清理脚本扫描。
 */
app.delete("/:id", (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id") || "";
  const id = c.req.param("id");

  const row = db
    .prepare("SELECT id, userId, path FROM task_attachments WHERE id = ?")
    .get(id) as { id: string; userId: string; path: string } | undefined;
  if (!row) return c.json({ error: "附件不存在" }, 404);
  if (row.userId !== userId) {
    return c.json({ error: "无权删除该附件", code: "FORBIDDEN" }, 403);
  }

  const absPath = path.join(getAttachmentsDir(), row.path);
  try {
    if (fs.existsSync(absPath)) fs.unlinkSync(absPath);
  } catch {
    /* 文件删不掉不阻塞，DB 记录仍然要清掉 */
  }
  db.prepare("DELETE FROM task_attachments WHERE id = ?").run(id);

  return c.json({ success: true });
});

export default app;
