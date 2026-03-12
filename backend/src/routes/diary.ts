import { Hono } from "hono";
import { getDb } from "../db/schema";
import crypto from "crypto";

const diary = new Hono();

// 获取指定月份的日记列表（摘要）
diary.get("/month/:year/:month", (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;
  const year = c.req.param("year");
  const month = c.req.param("month").padStart(2, "0");

  const rows = db.prepare(
    `SELECT id, date, mood, weather, wordCount, 
            SUBSTR(contentText, 1, 100) as preview,
            createdAt, updatedAt
     FROM diaries 
     WHERE userId = ? AND date LIKE ?
     ORDER BY date ASC`
  ).all(userId, `${year}-${month}-%`);

  return c.json(rows);
});

// 获取指定日期的日记
diary.get("/date/:date", (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;
  const date = c.req.param("date"); // YYYY-MM-DD

  const row = db.prepare(
    "SELECT * FROM diaries WHERE userId = ? AND date = ?"
  ).get(userId, date);

  if (!row) return c.json(null);
  return c.json(row);
});

// 获取单篇日记
diary.get("/:id", (c) => {
  const db = getDb();
  const id = c.req.param("id");

  const row = db.prepare("SELECT * FROM diaries WHERE id = ?").get(id);
  if (!row) return c.json({ error: "Diary not found" }, 404);
  return c.json(row);
});

// 创建或更新日记（upsert — 同一天只能有一篇）
diary.put("/date/:date", (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;
  const date = c.req.param("date");

  return c.req.json().then((body: any) => {
    const { content, contentText, mood, weather } = body;
    const wordCount = contentText ? contentText.replace(/\s/g, "").length : 0;

    const existing = db.prepare(
      "SELECT id FROM diaries WHERE userId = ? AND date = ?"
    ).get(userId, date) as any;

    if (existing) {
      // 更新
      const sets: string[] = [];
      const params: any[] = [];

      if (content !== undefined) { sets.push("content = ?"); params.push(content); }
      if (contentText !== undefined) { sets.push("contentText = ?"); params.push(contentText); }
      if (mood !== undefined) { sets.push("mood = ?"); params.push(mood); }
      if (weather !== undefined) { sets.push("weather = ?"); params.push(weather); }
      sets.push("wordCount = ?"); params.push(wordCount);
      sets.push("updatedAt = datetime('now')");

      params.push(existing.id);
      db.prepare(`UPDATE diaries SET ${sets.join(", ")} WHERE id = ?`).run(...params);

      const updated = db.prepare("SELECT * FROM diaries WHERE id = ?").get(existing.id);
      return c.json(updated);
    } else {
      // 创建
      const id = crypto.randomUUID();
      db.prepare(`
        INSERT INTO diaries (id, userId, date, content, contentText, mood, weather, wordCount)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, userId, date, content || "{}", contentText || "", mood || "", weather || "", wordCount);

      const created = db.prepare("SELECT * FROM diaries WHERE id = ?").get(id);
      return c.json(created, 201);
    }
  });
});

// 删除日记
diary.delete("/:id", (c) => {
  const db = getDb();
  const id = c.req.param("id");

  const row = db.prepare("SELECT * FROM diaries WHERE id = ?").get(id);
  if (!row) return c.json({ error: "Diary not found" }, 404);

  db.prepare("DELETE FROM diaries WHERE id = ?").run(id);
  return c.json({ success: true });
});

// 获取统计信息
diary.get("/stats/summary", (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;

  const total = (db.prepare(
    "SELECT COUNT(*) as count FROM diaries WHERE userId = ?"
  ).get(userId) as any).count;

  const totalWords = (db.prepare(
    "SELECT COALESCE(SUM(wordCount), 0) as total FROM diaries WHERE userId = ?"
  ).get(userId) as any).total;

  // 连续写日记天数（从今天往前数）
  const today = new Date().toISOString().split("T")[0];
  const allDates = db.prepare(
    "SELECT date FROM diaries WHERE userId = ? AND date <= ? ORDER BY date DESC"
  ).all(userId, today) as { date: string }[];

  let streak = 0;
  const currentDate = new Date(today);
  for (const { date } of allDates) {
    const expected = currentDate.toISOString().split("T")[0];
    if (date === expected) {
      streak++;
      currentDate.setDate(currentDate.getDate() - 1);
    } else {
      break;
    }
  }

  // 本月日记数
  const monthPrefix = today.slice(0, 7);
  const monthCount = (db.prepare(
    "SELECT COUNT(*) as count FROM diaries WHERE userId = ? AND date LIKE ?"
  ).get(userId, `${monthPrefix}%`) as any).count;

  return c.json({ total, totalWords, streak, monthCount });
});

export default diary;
