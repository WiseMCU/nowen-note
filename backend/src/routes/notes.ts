import { Hono } from "hono";
import { getDb } from "../db/schema";
import { v4 as uuid } from "uuid";
import { emitWebhook } from "../services/webhook";
import { logAudit } from "../services/audit";

const app = new Hono();

// 获取笔记列表（按笔记本筛选）
app.get("/", (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id") || "demo";
  const notebookId = c.req.query("notebookId");
  const isFavorite = c.req.query("isFavorite");
  const isTrashed = c.req.query("isTrashed");
  const search = c.req.query("search");
  const tagId = c.req.query("tagId");
  const dateFrom = c.req.query("dateFrom"); // YYYY-MM-DD
  const dateTo = c.req.query("dateTo");     // YYYY-MM-DD

  let query = `SELECT id, userId, notebookId, title, contentText, isPinned, isFavorite, isLocked,
    isArchived, isTrashed, version, createdAt, updatedAt FROM notes WHERE userId = ?`;
  const params: any[] = [userId];

  if (search) {
    const ftsResults = db.prepare(`
      SELECT rowid FROM notes_fts WHERE notes_fts MATCH ?
    `).all(search) as { rowid: number }[];
    if (ftsResults.length === 0) return c.json([]);
    const rowids = ftsResults.map((r) => r.rowid).join(",");
    query += ` AND rowid IN (${rowids})`;
  } else if (isTrashed === "1") {
    query += " AND isTrashed = 1";
  } else if (isFavorite === "1") {
    query += " AND isFavorite = 1 AND isTrashed = 0";
  } else if (tagId) {
    query += " AND isTrashed = 0 AND id IN (SELECT noteId FROM note_tags WHERE tagId = ?)";
    params.push(tagId);
  } else if (notebookId) {
    query += " AND notebookId = ? AND isTrashed = 0";
    params.push(notebookId);
  } else {
    query += " AND isTrashed = 0";
  }

  // 日期范围筛选（基于 updatedAt）
  if (dateFrom) {
    query += " AND updatedAt >= ?";
    params.push(dateFrom + " 00:00:00");
  }
  if (dateTo) {
    query += " AND updatedAt <= ?";
    params.push(dateTo + " 23:59:59");
  }

  query += " ORDER BY isPinned DESC, updatedAt DESC";
  const notes = db.prepare(query).all(...params);
  return c.json(notes);
});

// 获取单个笔记（完整内容）
app.get("/:id", (c) => {
  const db = getDb();
  const id = c.req.param("id");
  const note = db.prepare("SELECT * FROM notes WHERE id = ?").get(id);
  if (!note) return c.json({ error: "Note not found" }, 404);

  const tags = db.prepare(`
    SELECT t.* FROM tags t
    JOIN note_tags nt ON t.id = nt.tagId
    WHERE nt.noteId = ?
  `).all(id);

  return c.json({ ...note as any, tags });
});

// 创建笔记
app.post("/", async (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id") || "demo";
  const body = await c.req.json();
  const id = uuid();
  db.prepare(`
    INSERT INTO notes (id, userId, notebookId, title, content, contentText)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, userId, body.notebookId, body.title || "无标题笔记", body.content || "{}", body.contentText || "");
  const note = db.prepare("SELECT * FROM notes WHERE id = ?").get(id);

  // 触发 Webhook 和审计日志
  emitWebhook("note.created", userId, { noteId: id, title: body.title || "无标题笔记" });
  logAudit(userId, "note", "create", { noteId: id, title: body.title }, { targetType: "note", targetId: id });

  return c.json({ ...note as any, tags: [] }, 201);
});

// 更新笔记
app.put("/:id", async (c) => {
  const db = getDb();
  const id = c.req.param("id");
  const body = await c.req.json();

  // 乐观锁：检查版本号
  if (body.version !== undefined) {
    const current = db.prepare("SELECT version FROM notes WHERE id = ?").get(id) as { version: number } | undefined;
    if (current && current.version !== body.version) {
      return c.json({ error: "Version conflict", currentVersion: current.version }, 409);
    }
  }

  // 锁定保护：锁定状态下禁止修改内容（但允许切换 isLocked 本身和元数据操作）
  const contentFields = ["title", "content", "contentText", "notebookId"];
  const isContentChange = contentFields.some((f) => body[f] !== undefined);
  const isOnlyLockToggle = body.isLocked !== undefined && Object.keys(body).filter(k => k !== "isLocked" && k !== "version").length === 0;

  if (isContentChange && !isOnlyLockToggle) {
    const note = db.prepare("SELECT isLocked FROM notes WHERE id = ?").get(id) as { isLocked: number } | undefined;
    if (note && note.isLocked === 1) {
      return c.json({ error: "Note is locked", code: "NOTE_LOCKED" }, 403);
    }
  }

  // Phase 3: 保存版本历史（仅在内容有实质变更时）
  if (body.content !== undefined || body.title !== undefined) {
    const currentNote = db.prepare("SELECT title, content, contentText, version, userId FROM notes WHERE id = ?").get(id) as any;
    if (currentNote) {
      const hasContentChange = (body.content !== undefined && body.content !== currentNote.content)
        || (body.title !== undefined && body.title !== currentNote.title);
      if (hasContentChange) {
        const versionId = uuid();
        db.prepare(`
          INSERT INTO note_versions (id, noteId, userId, title, content, contentText, version, changeType)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'edit')
        `).run(versionId, id, currentNote.userId, currentNote.title, currentNote.content, currentNote.contentText, currentNote.version);
      }
    }
  }

  const fields: string[] = [];
  const params: any[] = [];

  if (body.title !== undefined) { fields.push("title = ?"); params.push(body.title); }
  if (body.content !== undefined) { fields.push("content = ?"); params.push(body.content); }
  if (body.contentText !== undefined) { fields.push("contentText = ?"); params.push(body.contentText); }
  if (body.notebookId !== undefined) { fields.push("notebookId = ?"); params.push(body.notebookId); }
  if (body.isPinned !== undefined) { fields.push("isPinned = ?"); params.push(body.isPinned); }
  if (body.isFavorite !== undefined) { fields.push("isFavorite = ?"); params.push(body.isFavorite); }
  if (body.isLocked !== undefined) { fields.push("isLocked = ?"); params.push(body.isLocked); }
  if (body.isArchived !== undefined) { fields.push("isArchived = ?"); params.push(body.isArchived); }
  if (body.isTrashed !== undefined) {
    fields.push("isTrashed = ?"); params.push(body.isTrashed);
    if (body.isTrashed) { fields.push("trashedAt = datetime('now')"); }
  }

  // 仅在内容字段（标题、正文、笔记本）变更时更新 updatedAt
  // 元数据操作（收藏、置顶、锁定、归档、回收站）不应修改 updatedAt
  const contentFieldNames = ["title", "content", "contentText", "notebookId"];
  const hasContentFieldChange = contentFieldNames.some((f) => body[f] !== undefined);

  fields.push("version = version + 1");
  if (hasContentFieldChange) {
    fields.push("updatedAt = datetime('now')");
  }
  params.push(id);

  db.prepare(`UPDATE notes SET ${fields.join(", ")} WHERE id = ?`).run(...params);
  const note = db.prepare("SELECT * FROM notes WHERE id = ?").get(id);

  const tags = db.prepare(`
    SELECT t.* FROM tags t
    JOIN note_tags nt ON t.id = nt.tagId
    WHERE nt.noteId = ?
  `).all(id);

  return c.json({ ...note as any, tags });
});

// 删除笔记（永久）
app.delete("/:id", (c) => {
  const db = getDb();
  const id = c.req.param("id");

  // 锁定保护：禁止删除锁定的笔记
  const note = db.prepare("SELECT isLocked FROM notes WHERE id = ?").get(id) as { isLocked: number } | undefined;
  if (note && note.isLocked === 1) {
    return c.json({ error: "Note is locked", code: "NOTE_LOCKED" }, 403);
  }

  db.prepare("DELETE FROM notes WHERE id = ?").run(id);

  // 触发 Webhook 和审计日志
  const userId = c.req.header("X-User-Id") || "demo";
  emitWebhook("note.deleted", userId, { noteId: id });
  logAudit(userId, "note", "delete", { noteId: id }, { targetType: "note", targetId: id });

  return c.json({ success: true });
});

export default app;
