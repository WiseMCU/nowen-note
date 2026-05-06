import { Hono } from "hono";
import { getDb } from "../db/schema";
import { v4 as uuid } from "uuid";
import {
  getUserWorkspaceRole,
  hasRole,
  resolveNotebookPermission,
  hasPermission,
  buildVisibilityWhere,
} from "../middleware/acl";

const app = new Hono();

/**
 * 获取所有笔记本（树形结构）
 * 支持可选 workspaceId 查询参数：
 *   未传 → 返回个人空间 + 所有加入的工作区笔记本（用于旧客户端兼容）
 *   传 'personal' → 仅个人空间
 *   传 <workspaceId> → 指定工作区
 */
app.get("/", (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id") || "";
  const workspaceId = c.req.query("workspaceId");

  let rows: any[];

  // noteCount 采用「递归口径」：每个笔记本的徽标数 = 自身直属笔记 + 所有子孙笔记本下的笔记
  // 通过递归 CTE 建立 ancestor → descendant 映射，再 JOIN notes 计数
  if (workspaceId === "personal") {
    rows = db
      .prepare(
        `
        WITH RECURSIVE nb_tree(ancestorId, descendantId) AS (
          SELECT id, id FROM notebooks
          WHERE userId = ? AND workspaceId IS NULL
          UNION ALL
          SELECT t.ancestorId, n.id
          FROM nb_tree t
          INNER JOIN notebooks n ON n.parentId = t.descendantId
          WHERE n.userId = ? AND n.workspaceId IS NULL
        )
        SELECT nb.*, COALESCE(nc.noteCount, 0) AS noteCount
        FROM notebooks nb
        LEFT JOIN (
          SELECT t.ancestorId AS notebookId, COUNT(notes.id) AS noteCount
          FROM nb_tree t
          INNER JOIN notes ON notes.notebookId = t.descendantId
          WHERE notes.userId = ? AND notes.isTrashed = 0 AND notes.workspaceId IS NULL
          GROUP BY t.ancestorId
        ) nc ON nb.id = nc.notebookId
        WHERE nb.userId = ? AND nb.workspaceId IS NULL
        ORDER BY nb.sortOrder ASC
      `,
      )
      .all(userId, userId, userId, userId);
  } else if (workspaceId) {
    // 指定工作区：校验成员身份
    const role = getUserWorkspaceRole(workspaceId, userId);
    if (!role) return c.json({ error: "无权访问该工作区" }, 403);

    rows = db
      .prepare(
        `
        WITH RECURSIVE nb_tree(ancestorId, descendantId) AS (
          SELECT id, id FROM notebooks WHERE workspaceId = ?
          UNION ALL
          SELECT t.ancestorId, n.id
          FROM nb_tree t
          INNER JOIN notebooks n ON n.parentId = t.descendantId
          WHERE n.workspaceId = ?
        )
        SELECT nb.*, COALESCE(nc.noteCount, 0) AS noteCount
        FROM notebooks nb
        LEFT JOIN (
          SELECT t.ancestorId AS notebookId, COUNT(notes.id) AS noteCount
          FROM nb_tree t
          INNER JOIN notes ON notes.notebookId = t.descendantId
          WHERE notes.isTrashed = 0 AND notes.workspaceId = ?
          GROUP BY t.ancestorId
        ) nc ON nb.id = nc.notebookId
        WHERE nb.workspaceId = ?
        ORDER BY nb.sortOrder ASC
      `,
      )
      .all(workspaceId, workspaceId, workspaceId, workspaceId);
  } else {
    // 兼容模式：个人空间
    rows = db
      .prepare(
        `
        WITH RECURSIVE nb_tree(ancestorId, descendantId) AS (
          SELECT id, id FROM notebooks
          WHERE userId = ? AND workspaceId IS NULL
          UNION ALL
          SELECT t.ancestorId, n.id
          FROM nb_tree t
          INNER JOIN notebooks n ON n.parentId = t.descendantId
          WHERE n.userId = ? AND n.workspaceId IS NULL
        )
        SELECT nb.*, COALESCE(nc.noteCount, 0) AS noteCount
        FROM notebooks nb
        LEFT JOIN (
          SELECT t.ancestorId AS notebookId, COUNT(notes.id) AS noteCount
          FROM nb_tree t
          INNER JOIN notes ON notes.notebookId = t.descendantId
          WHERE notes.userId = ? AND notes.isTrashed = 0 AND notes.workspaceId IS NULL
          GROUP BY t.ancestorId
        ) nc ON nb.id = nc.notebookId
        WHERE nb.userId = ? AND nb.workspaceId IS NULL
        ORDER BY nb.sortOrder ASC
      `,
      )
      .all(userId, userId, userId, userId);
  }

  return c.json(rows);
});

// 创建笔记本
app.post("/", async (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id") || "";
  const body = await c.req.json();
  const workspaceId: string | null = body.workspaceId || null;

  // 如果指定了工作区，必须是 editor 以上角色
  if (workspaceId) {
    const role = getUserWorkspaceRole(workspaceId, userId);
    if (!hasRole(role, "editor")) {
      return c.json({ error: "您在该工作区无创建权限" }, 403);
    }
  }

  const id = uuid();
  db.prepare(
    `INSERT INTO notebooks (id, userId, workspaceId, parentId, name, icon, color, sortOrder)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    userId,
    workspaceId,
    body.parentId || null,
    body.name,
    body.icon || "📒",
    body.color || null,
    body.sortOrder || 0,
  );
  const notebook = db.prepare("SELECT * FROM notebooks WHERE id = ?").get(id);
  return c.json(notebook, 201);
});

// 移动笔记本
app.put("/:id/move", async (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id") || "";
  const id = c.req.param("id");
  const body = await c.req.json();

  const newParentId: string | null | undefined = body.parentId;
  const newSortOrder: number | undefined =
    typeof body.sortOrder === "number" ? body.sortOrder : undefined;

  const { permission, workspaceId } = resolveNotebookPermission(id, userId);
  if (!hasPermission(permission, "write")) {
    return c.json({ error: "forbidden" }, 403);
  }

  if (newParentId !== undefined && newParentId !== null) {
    if (newParentId === id) {
      return c.json({ error: "cannot move notebook into itself" }, 400);
    }
    const parent = db
      .prepare("SELECT id, userId, workspaceId FROM notebooks WHERE id = ?")
      .get(newParentId) as { id: string; userId: string; workspaceId: string | null } | undefined;
    if (!parent) return c.json({ error: "target parent not found" }, 404);

    // 父笔记本必须和当前笔记本同属一个空间
    if ((parent.workspaceId || null) !== (workspaceId || null)) {
      return c.json({ error: "cannot move notebook across workspaces" }, 400);
    }
    const parentPerm = resolveNotebookPermission(newParentId, userId);
    if (!hasPermission(parentPerm.permission, "write")) {
      return c.json({ error: "forbidden" }, 403);
    }

    // 循环引用防护
    let cursor: string | null = newParentId;
    const visited = new Set<string>();
    while (cursor) {
      if (visited.has(cursor)) break;
      visited.add(cursor);
      if (cursor === id) {
        return c.json({ error: "cannot move notebook into its own descendant" }, 400);
      }
      const row = db.prepare("SELECT parentId FROM notebooks WHERE id = ?").get(cursor) as
        | { parentId: string | null }
        | undefined;
      cursor = row?.parentId ?? null;
    }
  }

  const sets: string[] = [];
  const args: any[] = [];
  if (newParentId !== undefined) {
    sets.push("parentId = ?");
    args.push(newParentId);
  }
  if (newSortOrder !== undefined) {
    sets.push("sortOrder = ?");
    args.push(newSortOrder);
  }
  sets.push("updatedAt = datetime('now')");
  args.push(id);

  db.prepare(`UPDATE notebooks SET ${sets.join(", ")} WHERE id = ?`).run(...args);
  const notebook = db.prepare("SELECT * FROM notebooks WHERE id = ?").get(id);
  return c.json(notebook);
});

// 批量更新笔记本排序
app.put("/reorder/batch", async (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id") || "";
  const body = await c.req.json();
  const items: { id: string; sortOrder: number }[] = body.items;
  if (!Array.isArray(items)) return c.json({ error: "items is required" }, 400);

  // 逐条校验权限
  const stmt = db.prepare("UPDATE notebooks SET sortOrder = ? WHERE id = ?");
  const updateMany = db.transaction((list: { id: string; sortOrder: number }[]) => {
    for (const item of list) {
      const { permission } = resolveNotebookPermission(item.id, userId);
      if (hasPermission(permission, "write")) {
        stmt.run(item.sortOrder, item.id);
      }
    }
  });
  updateMany(items);
  return c.json({ success: true });
});

// 更新笔记本
app.put("/:id", async (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id") || "";
  const id = c.req.param("id");
  const body = await c.req.json();

  const { permission } = resolveNotebookPermission(id, userId);
  if (!hasPermission(permission, "write")) {
    return c.json({ error: "forbidden" }, 403);
  }

  db.prepare(
    `
    UPDATE notebooks SET name = COALESCE(?, name), icon = COALESCE(?, icon),
    color = COALESCE(?, color), parentId = COALESCE(?, parentId),
    sortOrder = COALESCE(?, sortOrder), isExpanded = COALESCE(?, isExpanded),
    updatedAt = datetime('now')
    WHERE id = ?
  `,
  ).run(
    body.name,
    body.icon,
    body.color,
    body.parentId,
    body.sortOrder,
    body.isExpanded,
    id,
  );
  const notebook = db.prepare("SELECT * FROM notebooks WHERE id = ?").get(id);
  return c.json(notebook);
});

// 删除笔记本
app.delete("/:id", (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id") || "";
  const id = c.req.param("id");

  const { permission } = resolveNotebookPermission(id, userId);
  if (!hasPermission(permission, "manage")) {
    return c.json({ error: "forbidden" }, 403);
  }

  db.prepare("DELETE FROM notebooks WHERE id = ?").run(id);
  return c.json({ success: true });
});

export default app;
// 保留给其他模块使用
export { buildVisibilityWhere };
