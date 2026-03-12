import { Hono } from "hono";
import { getDb } from "../db/schema";
import crypto from "crypto";

const diary = new Hono();

// 发布一条说说
diary.post("/", (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;

  return c.req.json().then((body: any) => {
    const { contentText, mood } = body;
    if (!contentText || !contentText.trim()) {
      return c.json({ error: "Content is required" }, 400);
    }

    const id = crypto.randomUUID();
    db.prepare(
      "INSERT INTO diaries (id, userId, contentText, mood) VALUES (?, ?, ?, ?)"
    ).run(id, userId, contentText.trim(), mood || "");

    const created = db.prepare("SELECT * FROM diaries WHERE id = ?").get(id);
    return c.json(created, 201);
  });
});

// 获取时间线（分页，按时间倒序）
diary.get("/timeline", (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;
  const cursor = c.req.query("cursor"); // 上次最后一条的 createdAt
  const limit = Math.min(parseInt(c.req.query("limit") || "20"), 50);

  let rows;
  if (cursor) {
    rows = db.prepare(
      `SELECT * FROM diaries 
       WHERE userId = ? AND createdAt < ?
       ORDER BY createdAt DESC
       LIMIT ?`
    ).all(userId, cursor, limit);
  } else {
    rows = db.prepare(
      `SELECT * FROM diaries 
       WHERE userId = ?
       ORDER BY createdAt DESC
       LIMIT ?`
    ).all(userId, limit);
  }

  const hasMore = rows.length === limit;
  const nextCursor = rows.length > 0 ? (rows[rows.length - 1] as any).createdAt : null;

  return c.json({ items: rows, hasMore, nextCursor });
});

// 删除一条说说
diary.delete("/:id", (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;
  const id = c.req.param("id");

  const row = db.prepare(
    "SELECT * FROM diaries WHERE id = ? AND userId = ?"
  ).get(id, userId);
  if (!row) return c.json({ error: "Not found" }, 404);

  db.prepare("DELETE FROM diaries WHERE id = ?").run(id);
  return c.json({ success: true });
});

// 统计
diary.get("/stats", (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;

  const total = (db.prepare(
    "SELECT COUNT(*) as count FROM diaries WHERE userId = ?"
  ).get(userId) as any).count;

  // 今日发布数
  const today = new Date().toISOString().split("T")[0];
  const todayCount = (db.prepare(
    "SELECT COUNT(*) as count FROM diaries WHERE userId = ? AND createdAt >= ?"
  ).get(userId, today) as any).count;

  return c.json({ total, todayCount });
});

export default diary;
