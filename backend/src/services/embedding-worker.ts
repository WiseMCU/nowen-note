/**
 * Embedding Worker — RAG Phase 1
 *
 * 职责：定时从 embedding_queue 拉取 pending 任务，调用配置的 AI provider 的
 *      `/embeddings` 接口算向量，写入 note_embeddings；失败重试到上限后标 failed。
 *
 * 设计要点：
 *   - 完全异步、与请求链路解耦：不阻塞笔记保存。
 *   - 配置缺失（未配 embedding URL/key）时优雅降级：把任务标 failed 并跳过；
 *     用户配好以后可以手动 /api/ai/embeddings/rebuild 重新入队。
 *   - 单进程串行处理（同时间只跑一个 fetch），避免对 OpenAI 类账号触发 RPM 限流；
 *     批量场景下吞吐由 BATCH_SIZE × 单次延迟决定，已经够 1000+ 篇笔记/小时。
 *   - 文本太短（<10 字符）直接跳过，节约 API 配额。
 *   - 大文本简单按 ~1500 字符切段；当前 Phase 1 暂不做语义切分，整篇笔记作为
 *     1~3 个 chunk 已能满足绝大多数笔记应用场景。Phase 2 可考虑按 Markdown 标题切。
 *
 * 与 schema.ts 中 embedding_queue 表的契约：
 *   status: pending | processing | done | failed
 *   retries: 失败累计次数；超过 MAX_RETRIES 的任务不再被 pickPending 选中
 *
 * 与 sqlite-vec 的关系：
 *   Phase 1 不依赖 sqlite-vec；向量以 JSON 字符串落 note_embeddings.vectorJson。
 *   Phase 2 接入 sqlite-vec 时新建虚表 vec_note_chunks 并把现有 vectorJson 灌进去。
 */
import { getDb } from "../db/schema";
import type Database from "better-sqlite3";
import {
  isVecAvailable,
  upsertVectors,
  deleteVectorsByRowids,
  resetVecTable,
  getVecDim,
  clearAllVectors,
} from "./vec-store";

// ====== 调参 ======
const POLL_INTERVAL_MS = 5_000;          // 轮询间隔（无任务时）
const BATCH_SIZE = 5;                    // 单轮处理多少条
const MAX_RETRIES = 3;                   // 单任务最大重试次数
const MIN_CONTENT_LENGTH = 10;           // 文本短于此长度直接 skip
const CHUNK_SIZE = 1500;                 // 单 chunk 字符数（粗略，按字符切）
const MAX_CHUNKS_PER_NOTE = 8;           // 防止超长笔记把队列卡死
const HTTP_TIMEOUT_MS = 30_000;          // 单次 embedding 请求超时
const DEFAULT_DIM = 1536;                // 仅作元数据，实际维度由 provider 返回为准

// ====== 内部状态 ======
let timer: NodeJS.Timeout | null = null;
let running = false;            // 是否有 tick 正在执行
let stopped = false;            // 是否已 stop（防止 tick 在 stop 后再排下一次）

// ============================================================
// 配置读取
// ============================================================
//
// 复用 system_settings 表，与 ai_provider/ai_api_url/ai_api_key 同表。
// 新增三个 key：
//   ai_embedding_url    — embedding 接口 base url（不含 /embeddings 后缀，去尾斜杠）
//                         留空时回退到 ai_api_url
//   ai_embedding_model  — embedding 模型名，例如 "text-embedding-3-small"、"bge-m3"
//                         留空 worker 直接 noop
//   ai_embedding_key    — 单独 key，留空时回退到 ai_api_key
interface EmbeddingConfig {
  url: string;            // 已规范化（去尾斜杠）
  model: string;
  apiKey: string;         // 可空（Ollama 等本地模型）
  provider: string;       // 透传 ai_provider，用于潜在 provider-specific 适配
}

function readEmbeddingConfig(db: Database.Database): EmbeddingConfig | null {
  const rows = db
    .prepare(
      "SELECT key, value FROM system_settings WHERE key IN ('ai_provider','ai_api_url','ai_api_key','ai_embedding_url','ai_embedding_model','ai_embedding_key')",
    )
    .all() as { key: string; value: string }[];
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;

  const model = (map.ai_embedding_model || "").trim();
  if (!model) return null;

  const url = ((map.ai_embedding_url || map.ai_api_url || "").trim()).replace(/\/+$/, "");
  if (!url) return null;

  const apiKey = (map.ai_embedding_key || map.ai_api_key || "").trim();
  const provider = (map.ai_provider || "").trim();

  // Ollama 是少数允许空 key 的 provider；其它 provider 一般必须给 key
  if (!apiKey && provider !== "ollama") {
    // 仍然返回配置，让 worker 尝试一次；如果接口确实需要 key 会以 401 失败标 failed
    // 这样用户在 UI 上能看到具体错误，而不是"为啥 worker 一直不跑"
  }

  return { url, model, apiKey, provider };
}

// ============================================================
// 文本切分（粗略版）
// ============================================================
//
// 当前策略：按 CHUNK_SIZE 字符硬切，最多 MAX_CHUNKS_PER_NOTE 段。
// 不做句子边界识别（中文不容易），笔记应用场景下重叠 0、按字符切已经够用。
// 标题作为第 0 段单独算一次 embedding，让短查询命中标题的概率显著上升。
function chunkText(title: string, body: string): { idx: number; text: string }[] {
  const chunks: { idx: number; text: string }[] = [];
  const t = (title || "").trim();
  const b = (body || "").trim();

  // chunk 0：标题（哪怕正文为空，也至少要有标题向量）
  if (t) {
    chunks.push({ idx: 0, text: t });
  }

  if (!b) return chunks;

  // chunk 1..N：正文
  let i = 0;
  let chunkIdx = 1;
  while (i < b.length && chunkIdx <= MAX_CHUNKS_PER_NOTE) {
    const piece = b.slice(i, i + CHUNK_SIZE);
    chunks.push({ idx: chunkIdx, text: piece });
    i += CHUNK_SIZE;
    chunkIdx++;
  }
  return chunks;
}

// ============================================================
// HTTP 调用：兼容 OpenAI /embeddings 协议
// ============================================================
//
// 请求体：{ model, input: string | string[] }
// 响应体：{ data: [{ embedding: number[], index }], model, usage }
// 通义/智谱/DeepSeek/Ollama(/v1) 都遵循这个协议；少数 provider 需要单独适配再说。
async function callEmbeddings(
  cfg: EmbeddingConfig,
  inputs: string[],
): Promise<number[][]> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.apiKey) headers["Authorization"] = `Bearer ${cfg.apiKey}`;

  const res = await fetch(`${cfg.url}/embeddings`, {
    method: "POST",
    headers,
    body: JSON.stringify({ model: cfg.model, input: inputs }),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${errText.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    data?: { embedding: number[]; index?: number }[];
  };
  if (!data.data || !Array.isArray(data.data)) {
    throw new Error("响应缺少 data 数组");
  }
  // 按 index 排序；很多 provider 已经按顺序返回，这里防御一下
  const sorted = [...data.data].sort(
    (a, b) => (a.index ?? 0) - (b.index ?? 0),
  );
  const vectors = sorted.map((d) => d.embedding);
  if (vectors.length !== inputs.length) {
    throw new Error(`返回向量数量 ${vectors.length} 与请求数 ${inputs.length} 不匹配`);
  }
  return vectors;
}

// ============================================================
// 单条任务处理
// ============================================================
async function processOne(
  db: Database.Database,
  cfg: EmbeddingConfig,
  task: { noteId: string; userId: string; retries: number },
): Promise<void> {
  // 取笔记内容
  const note = db
    .prepare(
      "SELECT id, userId, title, contentText, isTrashed FROM notes WHERE id = ?",
    )
    .get(task.noteId) as
    | { id: string; userId: string; title: string; contentText: string; isTrashed: number }
    | undefined;

  if (!note || note.isTrashed) {
    // 笔记已不存在或被丢进回收站 → 直接清队列项
    db.prepare("DELETE FROM embedding_queue WHERE noteId = ?").run(task.noteId);
    return;
  }

  const chunks = chunkText(note.title || "", note.contentText || "");
  if (chunks.length === 0 || chunks.every((c) => c.text.length < MIN_CONTENT_LENGTH)) {
    // 内容过短：标 done 不算 embedding，避免反复重试
    db.prepare(
      "UPDATE embedding_queue SET status = 'done', updatedAt = datetime('now'), lastError = 'skipped: content too short' WHERE noteId = ?",
    ).run(task.noteId);
    return;
  }

  // 过滤掉过短的 chunk（比如标题很短但正文很长，标题保留靠下面 length>=2 的兜底）
  const valid = chunks.filter((c) => c.text.length >= 2);
  const inputs = valid.map((c) => c.text);

  // 调 provider
  const vectors = await callEmbeddings(cfg, inputs);
  const dim = vectors[0]?.length || DEFAULT_DIM;

  // 事务写入：先删旧的，再插新的；同步收集新插入的 rowid 用于灌 vec 表
  const newRowIds: number[] = [];
  const tx = db.transaction(() => {
    // 先把旧 rowid 抓出来，事务结束后从 vec 表里删干净（避免脏数据）
    const oldRows = db
      .prepare("SELECT id FROM note_embeddings WHERE noteId = ?")
      .all(task.noteId) as { id: number }[];
    if (oldRows.length > 0) {
      try { deleteVectorsByRowids(oldRows.map((r) => r.id)); } catch { /* vec 不可用时忽略 */ }
    }
    db.prepare("DELETE FROM note_embeddings WHERE noteId = ?").run(task.noteId);

    const ins = db.prepare(`
      INSERT INTO note_embeddings (noteId, userId, model, dim, chunkIndex, chunkText, vectorJson, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);
    for (let i = 0; i < valid.length; i++) {
      const info = ins.run(
        note.id,
        note.userId,
        cfg.model,
        dim,
        valid[i].idx,
        valid[i].text,
        JSON.stringify(vectors[i]),
      );
      // better-sqlite3 同步 API：lastInsertRowid 直接可用
      newRowIds.push(Number(info.lastInsertRowid));
    }
    db.prepare(
      "UPDATE embedding_queue SET status = 'done', lastError = NULL, updatedAt = datetime('now') WHERE noteId = ?",
    ).run(task.noteId);
  });
  tx();

  // 灌 vec0 表：放在事务外，避免 vec 维度不匹配抛错把整笔 note_embeddings 写入也回滚
  // （note_embeddings.vectorJson 是真相源；vec0 表只是加速结构，缺失了可重建）
  if (isVecAvailable() || getVecDim() === null /* 还没建表，第一条会建 */) {
    try {
      // 维度变了：先 reset vec 表（会清空，由调用 /embeddings/rebuild 时已经 clear 过 note_embeddings）
      // 这里仅在 vec 表已经存在且维度不一致时才 reset；否则会反复清表
      const vecDim = getVecDim();
      if (vecDim !== null && vecDim !== dim) {
        // 安全做法：用户应通过 /embeddings/rebuild + reindex-vec 主动切；
        // 但如果这里直接 reset 也只是丢了 vec 表里的"上一个模型"残余向量，
        // note_embeddings 已经被本笔记 DELETE+INSERT 覆盖了，整体仍一致。
        resetVecTable(dim);
      }
      const pairs = newRowIds.map((rowid, i) => ({ rowid, vector: vectors[i] }));
      upsertVectors(pairs);
    } catch (e) {
      // vec 写入失败不影响主流程；下次 reindex-vec 能修
      console.warn("[embedding-worker] vec upsert failed:", e);
    }
  }
}

// ============================================================
// 主循环
// ============================================================
async function tick(): Promise<void> {
  if (running || stopped) return;
  running = true;
  try {
    const db = getDb();

    const cfg = readEmbeddingConfig(db);
    if (!cfg) {
      // 没配模型 → 啥也不做（下次轮询再试）
      return;
    }

    // 拉一批 pending（排除已超过最大重试的）
    const tasks = db
      .prepare(
        `SELECT noteId, userId, retries
         FROM embedding_queue
         WHERE status = 'pending' AND retries < ?
         ORDER BY enqueuedAt ASC
         LIMIT ?`,
      )
      .all(MAX_RETRIES, BATCH_SIZE) as {
      noteId: string;
      userId: string;
      retries: number;
    }[];

    if (tasks.length === 0) return;

    // 标 processing（防止重复领取——单进程不严格需要，但 future-proof）
    const markProcessing = db.prepare(
      "UPDATE embedding_queue SET status = 'processing', updatedAt = datetime('now') WHERE noteId = ?",
    );
    for (const t of tasks) markProcessing.run(t.noteId);

    for (const task of tasks) {
      try {
        await processOne(db, cfg, task);
      } catch (e: any) {
        const msg = (e?.message || String(e)).slice(0, 500);
        const newRetries = task.retries + 1;
        const newStatus = newRetries >= MAX_RETRIES ? "failed" : "pending";
        db.prepare(
          `UPDATE embedding_queue
           SET status = ?, retries = ?, lastError = ?, updatedAt = datetime('now')
           WHERE noteId = ?`,
        ).run(newStatus, newRetries, msg, task.noteId);
        // 出错后稍微歇一下再继续下一条，避免对 provider 接口连击
        await sleep(500);
      }
    }
  } catch (e) {
    console.warn("[embedding-worker] tick error:", e);
  } finally {
    running = false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ============================================================
// 对外 API
// ============================================================

/** 启动 worker（幂等）。在 index.ts 启动时调用一次即可。 */
export function startEmbeddingWorker(): void {
  if (timer) return;
  stopped = false;
  // 启动后立即跑一轮，再进入定时循环（首次跑能加速冷启动回填）
  setImmediate(() => { void tick(); });
  timer = setInterval(() => { void tick(); }, POLL_INTERVAL_MS);
  // 让 timer 不阻塞进程退出
  if (typeof timer.unref === "function") timer.unref();
  console.log("[embedding-worker] started");
}

/** 停止 worker（用于优雅关停 / 单测） */
export function stopEmbeddingWorker(): void {
  stopped = true;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/**
 * 把所有"未被回收"的笔记重新入队。
 * 用途：
 *   - 用户切换 embedding 模型后，老向量需要全部重算
 *   - 用户手动点"重建索引"
 * 同时会清空 note_embeddings（因为模型变了，老向量无意义）。
 */
export function rebuildAllEmbeddings(opts: { clearExisting?: boolean } = {}): {
  enqueued: number;
} {
  const db = getDb();
  const tx = db.transaction(() => {
    if (opts.clearExisting) {
      db.prepare("DELETE FROM note_embeddings").run();
    }
    db.prepare(
      `INSERT INTO embedding_queue (noteId, userId, status, retries, enqueuedAt, updatedAt)
       SELECT id, userId, 'pending', 0, datetime('now'), datetime('now')
       FROM notes WHERE isTrashed = 0
       ON CONFLICT(noteId) DO UPDATE SET
         status = 'pending',
         retries = 0,
         lastError = NULL,
         updatedAt = datetime('now')`,
    ).run();
  });
  tx();
  // 同步清 vec 表（事务外做：vec0 是虚表，与主表事务回滚保护无关）
  if (opts.clearExisting) {
    try { clearAllVectors(); } catch { /* vec 不可用时忽略 */ }
  }
  const enqueued = (db
    .prepare("SELECT COUNT(*) as c FROM embedding_queue WHERE status = 'pending'")
    .get() as { c: number }).c;
  return { enqueued };
}

/** 给前端展示用的统计信息 */
export function getEmbeddingStats(userId?: string): {
  totalNotes: number;
  indexedNotes: number;
  pending: number;
  processing: number;
  failed: number;
  configured: boolean;
  model: string | null;
  vecAvailable: boolean;
  vecDim: number | null;
} {
  const db = getDb();
  const cfg = readEmbeddingConfig(db);

  const userFilter = userId ? "WHERE userId = ? AND isTrashed = 0" : "WHERE isTrashed = 0";
  const userParams = userId ? [userId] : [];

  const totalNotes = (db
    .prepare(`SELECT COUNT(*) as c FROM notes ${userFilter}`)
    .get(...userParams) as { c: number }).c;

  const indexedSql = userId
    ? "SELECT COUNT(DISTINCT noteId) as c FROM note_embeddings WHERE userId = ?"
    : "SELECT COUNT(DISTINCT noteId) as c FROM note_embeddings";
  const indexedNotes = (db
    .prepare(indexedSql)
    .get(...userParams) as { c: number }).c;

  const queueSql = userId
    ? "SELECT status, COUNT(*) as c FROM embedding_queue WHERE userId = ? GROUP BY status"
    : "SELECT status, COUNT(*) as c FROM embedding_queue GROUP BY status";
  const queueRows = db.prepare(queueSql).all(...userParams) as {
    status: string;
    c: number;
  }[];
  const counts: Record<string, number> = {};
  for (const r of queueRows) counts[r.status] = r.c;

  return {
    totalNotes,
    indexedNotes,
    pending: counts.pending || 0,
    processing: counts.processing || 0,
    failed: counts.failed || 0,
    configured: !!cfg,
    model: cfg?.model || null,
    vecAvailable: isVecAvailable(),
    vecDim: getVecDim(),
  };
}

// ============================================================
// 查询向量化（给 /ask 用）
// ============================================================
//
// 把用户的问题文本转成向量，用于 vec_note_chunks KNN 检索。
// - 复用 readEmbeddingConfig：保证查询和入库用同一个 model/url，维度一致
// - 配置缺失返回 null，调用方降级走 BM25
// - 失败也返回 null（吞错）：用户已经在等回复，不能因为 embedding 接口抖动导致 /ask 整个挂掉

export async function embedQuery(text: string): Promise<number[] | null> {
  const t = (text || "").trim();
  if (t.length < 2) return null;

  const db = getDb();
  const cfg = readEmbeddingConfig(db);
  if (!cfg) return null;

  try {
    const vectors = await callEmbeddings(cfg, [t.slice(0, 4000)]);
    return vectors[0] || null;
  } catch (e) {
    console.warn("[embedding-worker] embedQuery failed:", e);
    return null;
  }
}
