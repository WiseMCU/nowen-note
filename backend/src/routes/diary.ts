import { Hono } from "hono";
import { getDb } from "../db/schema";
import { v4 as uuidv4 } from "uuid";

const app = new Hono();

function ensureTable() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS diary_entries (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      content TEXT NOT NULL,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_diary_user ON diary_entries(userId);
    CREATE INDEX IF NOT EXISTS idx_diary_created ON diary_entries(createdAt DESC);
  `);
}

ensureTable();

// 获取日记列表（分页 + 游标）
app.get("/", (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id");
  const limit = Math.min(Math.max(Number(c.req.query("limit")) || 20, 1), 100);
  const cursor = c.req.query("cursor"); // createdAt of last item

  let rows;
  if (cursor) {
    rows = db.prepare(
      "SELECT * FROM diary_entries WHERE userId = ? AND createdAt < ? ORDER BY createdAt DESC LIMIT ?"
    ).all(userId, cursor, limit + 1);
  } else {
    rows = db.prepare(
      "SELECT * FROM diary_entries WHERE userId = ? ORDER BY createdAt DESC LIMIT ?"
    ).all(userId, limit + 1);
  }

  const hasMore = (rows as any[]).length > limit;
  const items = hasMore ? (rows as any[]).slice(0, limit) : (rows as any[]);
  const nextCursor = hasMore ? items[items.length - 1].createdAt : null;

  return c.json({ items, nextCursor, hasMore });
});

// 发布新日记
app.post("/", async (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id");

  let body: { content?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "请求体格式错误" }, 400);
  }

  const content = body.content?.trim();
  if (!content) {
    return c.json({ error: "内容不能为空" }, 400);
  }

  const id = uuidv4();
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);

  db.prepare(
    "INSERT INTO diary_entries (id, userId, content, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)"
  ).run(id, userId, content, now, now);

  const entry = db.prepare("SELECT * FROM diary_entries WHERE id = ?").get(id);
  return c.json(entry, 201);
});

// 更新日记
app.put("/:id", async (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id");
  const id = c.req.param("id");

  let body: { content?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "请求体格式错误" }, 400);
  }

  const content = body.content?.trim();
  if (!content) {
    return c.json({ error: "内容不能为空" }, 400);
  }

  const existing = db.prepare(
    "SELECT id FROM diary_entries WHERE id = ? AND userId = ?"
  ).get(id, userId);
  if (!existing) {
    return c.json({ error: "日记不存在或无权操作" }, 404);
  }

  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  db.prepare(
    "UPDATE diary_entries SET content = ?, updatedAt = ? WHERE id = ? AND userId = ?"
  ).run(content, now, id, userId);

  const entry = db.prepare(
    "SELECT * FROM diary_entries WHERE id = ? AND userId = ?"
  ).get(id, userId);
  return c.json(entry);
});

// 删除日记
app.delete("/:id", (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id");
  const id = c.req.param("id");

  const result = db.prepare(
    "DELETE FROM diary_entries WHERE id = ? AND userId = ?"
  ).run(id, userId);

  if (result.changes === 0) {
    return c.json({ error: "日记不存在或无权操作" }, 404);
  }

  return c.json({ success: true });
});

export default app;
