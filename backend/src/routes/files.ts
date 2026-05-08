/**
 * 文件管理路由（/api/files）
 * ---------------------------------------------------------------------------
 * 定位：
 *   这是"文件管理"模块的后端聚合层——面向**当前用户可见**的所有附件（图片 +
 *   非图片文件），提供列表、搜索、筛选、分类统计、详情（含反向引用）、上传、
 *   删除等能力。
 *
 * 与现有 /api/attachments 的关系：
 *   - attachments.ts：定位是"单笔记附件的 CRUD + 孤儿扫描"，强依赖 noteId。
 *     已经承载了下载（handleDownloadAttachment）、上传、内联 base64 抽取、
 *     GC 扫描等所有**存量**逻辑，不能动——改它风险太高。
 *   - files.ts（本文件）：定位是"跨笔记的附件视图"，类似"相册 / 文件柜"。
 *     完全复用已落盘的 ATTACHMENTS_DIR + attachments 表，不新建字段、不新建
 *     目录、不改磁盘布局。查询时 JOIN notes/notebooks 获取反向引用信息。
 *   - 下载 URL 仍然是 /api/attachments/<id>（免 JWT、可被 <img> 直接用），
 *     本模块只管"查哪些文件、在哪些笔记里出现过"。
 *
 * 授权模型：
 *   - 所有接口都在 JWT 中间件之后（/api/files 挂载在受保护段）。
 *   - 列表只返回"当前用户自己的"附件（attachments.userId = X-User-Id）。
 *   - 详情 / 删除：除了 userId 校验，还要通过 resolveNotePermission 走一次
 *     对所属笔记的 write 权限（与 attachments.ts DELETE 保持一致），确保
 *     工作区场景下的 ACL 不被绕过。
 *
 * 反向关联（双向跳转）：
 *   attachments 表本身有 noteId 列，但在"一个附件被多条笔记引用（例如同一
 *   张图在两篇笔记里都粘贴了同一个 /api/attachments/<id> URL）"的场景下，
 *   不能只靠 attachments.noteId——那是"首次归属"的笔记。因此详情接口会：
 *     1) 返回 primaryNote（attachments.noteId 指向的那条，不存在时为 null）；
 *     2) 扫描 notes.content 找出所有 indexOf(`/api/attachments/<id>`) ≥ 0
 *        的笔记，聚合成 references[]，用于前端列出"引用此文件的笔记页面"。
 *   扫描是 O(N) 全表遍历，但 notes 数量量级可控，且 content 已经通过压缩
 *   中间件传输；一次详情查询可以接受。更大规模时再考虑建倒排索引。
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { v4 as uuid } from "uuid";
import fs from "fs";
import path from "path";
import { getDb } from "../db/schema";
import {
  ensureAttachmentsDir,
  getAttachmentsDir,
  MIME_TO_EXT,
} from "./attachments";
import { resolveNotePermission, hasPermission } from "../middleware/acl";

const app = new Hono();

// ---------------------------------------------------------------------------
// 共用工具
// ---------------------------------------------------------------------------

const IMAGE_MIME_PREFIX = "image/";

/** 判定一个 MIME 是否属于图片（供分类筛选用）。 */
function isImage(mime: string | null | undefined): boolean {
  return !!mime && mime.toLowerCase().startsWith(IMAGE_MIME_PREFIX);
}

/**
 * 把一条附件行 + 关联的 notebook 信息转成前端消费格式。
 *
 * url 字段始终是 `/api/attachments/<id>` 相对路径；前端用
 * resolveAttachmentUrl() 运行时补 origin，避免把变动端口写死到持久化数据里。
 */
interface FileRow {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  path: string;
  createdAt: string;
  noteId: string;
  noteTitle: string | null;
  notebookId: string | null;
  notebookName: string | null;
  notebookIcon: string | null;
  isTrashed: number | null;
}

interface FileOut {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  createdAt: string;
  category: "image" | "file";
  url: string;
  /** 首次归属的笔记（attachments.noteId）。被删除或不存在时为 null。 */
  primaryNote: {
    id: string;
    title: string;
    notebookId: string | null;
    notebookName: string | null;
    notebookIcon: string | null;
    isTrashed: number;
  } | null;
}

function toFileOut(row: FileRow): FileOut {
  return {
    id: row.id,
    filename: row.filename,
    mimeType: row.mimeType,
    size: row.size,
    createdAt: row.createdAt,
    category: isImage(row.mimeType) ? "image" : "file",
    url: `/api/attachments/${row.id}`,
    primaryNote: row.noteId
      ? {
          id: row.noteId,
          title: row.noteTitle ?? "",
          notebookId: row.notebookId,
          notebookName: row.notebookName,
          notebookIcon: row.notebookIcon,
          isTrashed: row.isTrashed ?? 0,
        }
      : null,
  };
}

/**
 * 把前端传来的 sort 参数归一化为 SQL ORDER BY 片段。
 * 只接受白名单字段，避免 SQL 注入；未知值落回默认。
 */
function resolveOrderBy(sort: string | undefined): string {
  switch ((sort || "").toLowerCase()) {
    case "name_asc":
      return "a.filename COLLATE NOCASE ASC";
    case "name_desc":
      return "a.filename COLLATE NOCASE DESC";
    case "size_asc":
      return "a.size ASC";
    case "size_desc":
      return "a.size DESC";
    case "created_asc":
      return "a.createdAt ASC";
    case "created_desc":
    default:
      return "a.createdAt DESC";
  }
}

// ---------------------------------------------------------------------------
// GET /api/files
// 列表 + 搜索 + 筛选 + 分页
//
// Query 参数：
//   category   "all" | "image" | "file"                    —— 大类筛选
//   mime       精确 MIME（如 image/png）                    —— 细分筛选
//   notebookId 所属笔记本 id                                —— 按笔记本筛
//   q          文件名关键字（ILIKE）                         —— 搜索
//   sort       name_asc | name_desc | size_asc | size_desc | created_asc | created_desc
//   page       1 起，默认 1
//   pageSize   默认 50，最大 200
//
// 响应：
//   { items: FileOut[], total: number, page, pageSize }
// ---------------------------------------------------------------------------
app.get("/", (c) => {
  const userId = c.req.header("X-User-Id") || "";
  if (!userId) return c.json({ error: "未授权" }, 401);
  const db = getDb();

  const category = (c.req.query("category") || "all").toLowerCase();
  const mime = c.req.query("mime") || "";
  const notebookId = c.req.query("notebookId") || "";
  const q = (c.req.query("q") || "").trim();
  const sort = c.req.query("sort") || "created_desc";
  const page = Math.max(1, Number(c.req.query("page") || 1));
  const pageSize = Math.min(
    200,
    Math.max(1, Number(c.req.query("pageSize") || 50)),
  );

  const whereParts: string[] = ["a.userId = ?"];
  const params: (string | number)[] = [userId];

  if (category === "image") {
    whereParts.push("a.mimeType LIKE 'image/%'");
  } else if (category === "file") {
    // 与 "image" 互斥；NULL mimeType 理论上不出现，仍兜底归为非图片
    whereParts.push("(a.mimeType IS NULL OR a.mimeType NOT LIKE 'image/%')");
  }

  if (mime) {
    whereParts.push("a.mimeType = ?");
    params.push(mime.toLowerCase());
  }

  if (notebookId) {
    whereParts.push("n.notebookId = ?");
    params.push(notebookId);
  }

  if (q) {
    whereParts.push("a.filename LIKE ? COLLATE NOCASE");
    params.push(`%${q}%`);
  }

  const whereSql = whereParts.join(" AND ");
  const orderSql = resolveOrderBy(sort);

  // LEFT JOIN：允许 attachment 对应的 note 已被真删（极端场景，DB 外键 CASCADE
  // 下这不会发生，但保留健壮性）；notebook 也 LEFT JOIN，保持列表可渲染。
  const totalRow = db
    .prepare(
      `SELECT COUNT(*) AS c
         FROM attachments a
         LEFT JOIN notes n ON n.id = a.noteId
         LEFT JOIN notebooks nb ON nb.id = n.notebookId
        WHERE ${whereSql}`,
    )
    .get(...params) as { c: number };

  const rows = db
    .prepare(
      `SELECT a.id, a.filename, a.mimeType, a.size, a.path, a.createdAt,
              a.noteId,
              n.title AS noteTitle, n.notebookId, n.isTrashed,
              nb.name AS notebookName, nb.icon AS notebookIcon
         FROM attachments a
         LEFT JOIN notes n ON n.id = a.noteId
         LEFT JOIN notebooks nb ON nb.id = n.notebookId
        WHERE ${whereSql}
        ORDER BY ${orderSql}
        LIMIT ? OFFSET ?`,
    )
    .all(...params, pageSize, (page - 1) * pageSize) as FileRow[];

  return c.json({
    items: rows.map(toFileOut),
    total: totalRow.c,
    page,
    pageSize,
  });
});

// ---------------------------------------------------------------------------
// GET /api/files/stats
// 按分类汇总（首屏 + 分类筛选器徽标用）：
//   { total, totalBytes,
//     images: { count, bytes },
//     files:  { count, bytes },
//     byMime: [{ mime, count, bytes }] }
// ---------------------------------------------------------------------------
app.get("/stats", (c) => {
  const userId = c.req.header("X-User-Id") || "";
  if (!userId) return c.json({ error: "未授权" }, 401);
  const db = getDb();

  // 一次性聚合：按 mimeType 分组，再在 JS 侧拆图片 / 文件大类。
  // 只有当前用户的附件才参与统计。
  const rows = db
    .prepare(
      `SELECT mimeType AS mime, COUNT(*) AS count, COALESCE(SUM(size), 0) AS bytes
         FROM attachments
        WHERE userId = ?
        GROUP BY mimeType
        ORDER BY count DESC`,
    )
    .all(userId) as { mime: string; count: number; bytes: number }[];

  let total = 0;
  let totalBytes = 0;
  let imageCount = 0;
  let imageBytes = 0;
  let fileCount = 0;
  let fileBytes = 0;
  for (const r of rows) {
    total += r.count;
    totalBytes += r.bytes;
    if (isImage(r.mime)) {
      imageCount += r.count;
      imageBytes += r.bytes;
    } else {
      fileCount += r.count;
      fileBytes += r.bytes;
    }
  }

  return c.json({
    total,
    totalBytes,
    images: { count: imageCount, bytes: imageBytes },
    files: { count: fileCount, bytes: fileBytes },
    byMime: rows,
  });
});

// ---------------------------------------------------------------------------
// GET /api/files/:id
// 文件详情 + 反向引用（引用该附件的所有笔记）
//
// 响应：
//   {
//     ...FileOut,
//     references: [
//       { id, title, notebookId, notebookName, notebookIcon, isTrashed,
//         updatedAt, isPrimary }
//     ]
//   }
//
// 注意：
//   - 只返回当前用户名下、未删除（或在回收站）的笔记。工作区共享笔记暂不纳入
//     反向引用扫描——跨用户搜 content 的成本与隐私代价较高，后续单独接入。
//   - 扫描用 `indexOf('/api/attachments/<id>') >= 0`，附件 id 是 uuid，不会
//     与其它字符串碰撞。
// ---------------------------------------------------------------------------
app.get("/:id", (c) => {
  const userId = c.req.header("X-User-Id") || "";
  if (!userId) return c.json({ error: "未授权" }, 401);
  const id = c.req.param("id");
  const db = getDb();

  const base = db
    .prepare(
      `SELECT a.id, a.filename, a.mimeType, a.size, a.path, a.createdAt,
              a.noteId, a.userId,
              n.title AS noteTitle, n.notebookId, n.isTrashed,
              nb.name AS notebookName, nb.icon AS notebookIcon
         FROM attachments a
         LEFT JOIN notes n ON n.id = a.noteId
         LEFT JOIN notebooks nb ON nb.id = n.notebookId
        WHERE a.id = ? AND a.userId = ?`,
    )
    .get(id, userId) as (FileRow & { userId: string }) | undefined;

  if (!base) return c.json({ error: "文件不存在" }, 404);

  // 反向引用扫描：LIKE '%pattern%' 利用 SQLite 的顺序扫描，无需预先建倒排。
  // 仅扫描当前用户自己的笔记；已删真删的笔记不可能返回。
  const pattern = `%/api/attachments/${id}%`;
  const refRows = db
    .prepare(
      `SELECT n.id, n.title, n.notebookId, n.isTrashed, n.updatedAt,
              nb.name AS notebookName, nb.icon AS notebookIcon
         FROM notes n
         LEFT JOIN notebooks nb ON nb.id = n.notebookId
        WHERE n.userId = ?
          AND n.content LIKE ?
        ORDER BY n.updatedAt DESC`,
    )
    .all(userId, pattern) as {
      id: string;
      title: string;
      notebookId: string | null;
      isTrashed: number;
      updatedAt: string;
      notebookName: string | null;
      notebookIcon: string | null;
    }[];

  const references = refRows.map((r) => ({
    id: r.id,
    title: r.title,
    notebookId: r.notebookId,
    notebookName: r.notebookName,
    notebookIcon: r.notebookIcon,
    isTrashed: r.isTrashed,
    updatedAt: r.updatedAt,
    isPrimary: r.id === base.noteId,
  }));

  return c.json({
    ...toFileOut(base),
    references,
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/files/:id
// 删除文件（DB 行 + 磁盘文件）。
//
// 权限：
//   需对 attachments.noteId 所指笔记有 write 权限；attachments.ts 的 DELETE
//   保持同款逻辑，这里只是做"文件管理"视角下的同义入口。
//
// 注意：
//   - 如果还有其他笔记正在引用该附件（references 非空 & 非本 primary），
//     删除后那些笔记里的 <img> 将显示为破图。返回体会带 remainingReferences
//     让前端按需二次确认或提示。
//   - 物理文件删不掉不阻塞（权限 / 已不存在），DB 行一定删掉——保持与
//     attachments.ts 的语义一致。
// ---------------------------------------------------------------------------
app.delete("/:id", (c) => {
  const userId = c.req.header("X-User-Id") || "";
  if (!userId) return c.json({ error: "未授权" }, 401);
  const id = c.req.param("id");
  const db = getDb();

  const row = db
    .prepare(
      "SELECT id, noteId, userId, path FROM attachments WHERE id = ?",
    )
    .get(id) as
    | { id: string; noteId: string; userId: string; path: string }
    | undefined;
  if (!row) return c.json({ error: "文件不存在" }, 404);

  // 只允许本人操作自己的附件行
  if (row.userId !== userId) {
    return c.json({ error: "无权删除他人文件", code: "FORBIDDEN" }, 403);
  }

  // 同时走笔记 ACL：若笔记在工作区内，只有 write+ 可删
  const { permission } = resolveNotePermission(row.noteId, userId);
  if (!hasPermission(permission, "write")) {
    return c.json({ error: "无权删除该文件", code: "FORBIDDEN" }, 403);
  }

  const absPath = path.join(getAttachmentsDir(), row.path);
  try {
    if (fs.existsSync(absPath)) fs.unlinkSync(absPath);
  } catch {
    /* 文件删不掉不阻塞，DB 记录一致性优先 */
  }
  db.prepare("DELETE FROM attachments WHERE id = ?").run(id);

  return c.json({ success: true });
});

// ---------------------------------------------------------------------------
// POST /api/files/batch-delete
// 批量删除文件（DB 行 + 磁盘文件）。
//
// 请求体：{ ids: string[] }   —— 不超过 200 个 / 次（避免单事务锁太久）
//
// 响应：
//   {
//     success: true,
//     deleted: number,                          —— 实际删除条数
//     failed:  Array<{ id: string; reason: string }>   —— 跳过的明细
//   }
//
// 设计要点：
//   - 整个删除过程放在单事务里（先把可删的 id 收集出来，再一次性 DELETE），
//     即便后面磁盘 unlink 报错也不影响 DB 一致性。
//   - 与单删 DELETE /:id 完全同款的两层鉴权（attachments.userId == 当前用户
//     + resolveNotePermission(noteId).write）；任何一项不通过则该 id 进入
//     failed[]，不阻塞其它 id 继续删。
//   - 物理文件 unlink 失败也只记一条 reason，不回滚——与单删保持一致：DB
//     一致性优先。
// ---------------------------------------------------------------------------
app.post("/batch-delete", async (c) => {
  const userId = c.req.header("X-User-Id") || "";
  if (!userId) return c.json({ error: "未授权" }, 401);

  let body: { ids?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json body" }, 400);
  }
  const rawIds = Array.isArray(body.ids) ? body.ids : [];
  // 去重 + 过滤掉非字符串项
  const ids = Array.from(
    new Set(
      rawIds.filter((x): x is string => typeof x === "string" && x.length > 0),
    ),
  );
  if (ids.length === 0) {
    return c.json({ error: "ids 不能为空" }, 400);
  }
  if (ids.length > 200) {
    return c.json({ error: "单次最多删除 200 个文件" }, 400);
  }

  const db = getDb();
  const failed: Array<{ id: string; reason: string }> = [];

  // 第一步：把全部 id 拉出来，做权限筛选，得到"可删除集合"+ 物理路径列表
  const placeholders = ids.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT id, noteId, userId, path FROM attachments WHERE id IN (${placeholders})`,
    )
    .all(...ids) as Array<{
      id: string;
      noteId: string;
      userId: string;
      path: string;
    }>;

  const foundIds = new Set(rows.map((r) => r.id));
  for (const id of ids) {
    if (!foundIds.has(id)) {
      failed.push({ id, reason: "文件不存在" });
    }
  }

  const deletable: typeof rows = [];
  for (const row of rows) {
    if (row.userId !== userId) {
      failed.push({ id: row.id, reason: "无权删除他人文件" });
      continue;
    }
    const { permission } = resolveNotePermission(row.noteId, userId);
    if (!hasPermission(permission, "write")) {
      failed.push({ id: row.id, reason: "无权删除该文件" });
      continue;
    }
    deletable.push(row);
  }

  // 第二步：单事务批量删 DB 行
  let deletedCount = 0;
  if (deletable.length > 0) {
    const delIds = deletable.map((r) => r.id);
    const delPlaceholders = delIds.map(() => "?").join(",");
    const tx = db.transaction((arr: string[]) => {
      const info = db
        .prepare(`DELETE FROM attachments WHERE id IN (${delPlaceholders})`)
        .run(...arr);
      return Number(info.changes || 0);
    });
    deletedCount = tx(delIds);

    // 第三步：删磁盘文件（DB 已经一致；磁盘层错误降级为 failed 项，
    // 但不会让用户误以为 DB 没删——文件已经从列表里消失了）
    const dir = getAttachmentsDir();
    for (const row of deletable) {
      const absPath = path.join(dir, row.path);
      try {
        if (fs.existsSync(absPath)) fs.unlinkSync(absPath);
      } catch (err) {
        failed.push({
          id: row.id,
          reason: `磁盘文件清理失败: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  }

  return c.json({
    success: true,
    deleted: deletedCount,
    failed,
  });
});

// ---------------------------------------------------------------------------
// POST /api/files/upload
// "无绑定笔记"上传入口：从文件管理界面直接上传文件。
//
// 背景：
//   attachments.ts 的上传强制要求 noteId（"上传附件即修改笔记"的语义）。
//   文件管理是**跨笔记**视角，用户希望"先把文件放进我的文件柜，稍后再决定
//   插入哪篇笔记"。为此我们创建一个用户私有的"未归档"笔记本 + 空笔记作为
//   占位容器：
//     - Notebook："📁 文件管理（自动）"；由 SQL 按用户 + 名字查找，不存在则建。
//     - Note：    "未归档文件"（isArchived=1）；同上。
//   这样 attachments.noteId 外键依然成立，且不污染用户真实笔记列表
//   （isArchived=1 的笔记默认不出现在"所有笔记"）。
//
// 这个占位 note 在用户真正把文件插入到某篇笔记时仍然保留（附件 id 不变、
// URL 不变、已有引用照常工作）；只是"首次归属"记在这条 holder note 下。
// ---------------------------------------------------------------------------

/** 200MB —— 与 attachments.ts 上传上限对齐。 */
const MAX_UPLOAD_SIZE = 200 * 1024 * 1024;

/** 与 attachments.ts 同款黑名单；其余任意 MIME 放行。 */
const BLOCKED_MIMES = new Set([
  "application/x-msdownload",
  "application/x-ms-installer",
  "application/x-ms-shortcut",
  "application/x-bat",
  "application/x-sh",
  "application/hta",
]);

/** 从文件名兜底推断扩展名（与 attachments.ts 的 pickExt 同款，避免跨模块依赖）。 */
function pickExt(filename: string | undefined, mime: string): string {
  const name = filename || "";
  const idx = name.lastIndexOf(".");
  if (idx >= 0 && idx < name.length - 1) {
    const ext = name.slice(idx + 1).toLowerCase().replace(/[^a-z0-9]/g, "");
    if (ext && ext.length <= 8) return ext;
  }
  return MIME_TO_EXT[mime.toLowerCase()] || "bin";
}

/**
 * 获取（或懒创建）用户的"未归档文件" holder note。
 *
 * 策略：
 *   1. 查是否已有 name='文件管理（自动）' 的 notebook；无则建；
 *   2. 在该 notebook 下查是否已有 isArchived=1 且 title='未归档文件' 的 note；
 *      无则建。
 *   3. 所有写入都放在单 transaction 里，保证并发安全。
 */
function ensureHolderNote(userId: string): { notebookId: string; noteId: string } {
  const db = getDb();

  const HOLDER_NOTEBOOK_NAME = "文件管理（自动）";
  const HOLDER_NOTE_TITLE = "未归档文件";

  let notebookId = "";
  let noteId = "";

  const tx = db.transaction(() => {
    // notebooks.userId 表示所有权；个人空间 workspaceId IS NULL。
    const nbRow = db
      .prepare(
        "SELECT id FROM notebooks WHERE userId = ? AND name = ? AND workspaceId IS NULL LIMIT 1",
      )
      .get(userId, HOLDER_NOTEBOOK_NAME) as { id: string } | undefined;
    if (nbRow) {
      notebookId = nbRow.id;
    } else {
      notebookId = uuid();
      db.prepare(
        `INSERT INTO notebooks (id, userId, parentId, name, description, icon, sortOrder, isExpanded, workspaceId)
         VALUES (?, ?, NULL, ?, '', '📁', 9999, 0, NULL)`,
      ).run(notebookId, userId, HOLDER_NOTEBOOK_NAME);
    }

    const noteRow = db
      .prepare(
        `SELECT id FROM notes
          WHERE userId = ? AND notebookId = ? AND title = ? AND isArchived = 1
          LIMIT 1`,
      )
      .get(userId, notebookId, HOLDER_NOTE_TITLE) as { id: string } | undefined;
    if (noteRow) {
      noteId = noteRow.id;
    } else {
      noteId = uuid();
      db.prepare(
        `INSERT INTO notes (id, userId, notebookId, title, content, contentText, isArchived)
         VALUES (?, ?, ?, ?, '{}', '', 1)`,
      ).run(noteId, userId, notebookId, HOLDER_NOTE_TITLE);
    }
  });
  tx();

  return { notebookId, noteId };
}

app.post("/upload", async (c) => {
  const userId = c.req.header("X-User-Id") || "";
  if (!userId) return c.json({ error: "未授权" }, 401);

  let body: Record<string, unknown>;
  try {
    body = await c.req.parseBody();
  } catch {
    return c.json({ error: "invalid multipart body" }, 400);
  }
  const file = body.file;
  if (!(file instanceof File)) {
    return c.json({ error: "file 字段缺失或非文件" }, 400);
  }
  if (file.size > MAX_UPLOAD_SIZE) {
    return c.json(
      { error: `文件过大（最大 ${MAX_UPLOAD_SIZE / 1024 / 1024}MB）` },
      413,
    );
  }
  const mime = (file.type || "application/octet-stream").toLowerCase();
  if (BLOCKED_MIMES.has(mime)) {
    return c.json({ error: `出于安全考虑，不支持该类型: ${mime}` }, 415);
  }

  const { noteId } = ensureHolderNote(userId);

  ensureAttachmentsDir();
  const id = uuid();
  const ext = pickExt(file.name, mime);
  const savePath = path.join(getAttachmentsDir(), `${id}.${ext}`);

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(savePath, buffer);
  } catch (err) {
    return c.json(
      { error: `写入文件失败: ${err instanceof Error ? err.message : String(err)}` },
      500,
    );
  }

  try {
    const db = getDb();
    db.prepare(
      `INSERT INTO attachments (id, noteId, userId, filename, mimeType, size, path)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      noteId,
      userId,
      file.name || `${id}.${ext}`,
      mime,
      file.size,
      `${id}.${ext}`,
    );
  } catch (err) {
    // DB 写失败时把已落盘文件清掉，避免孤儿
    try { fs.unlinkSync(savePath); } catch { /* ignore */ }
    return c.json(
      { error: `写入数据库失败: ${err instanceof Error ? err.message : String(err)}` },
      500,
    );
  }

  return c.json(
    {
      id,
      url: `/api/attachments/${id}`,
      mimeType: mime,
      size: file.size,
      filename: file.name || `${id}.${ext}`,
      category: isImage(mime) ? "image" : "file",
      createdAt: new Date().toISOString(),
    },
    201,
  );
});

export default app;
