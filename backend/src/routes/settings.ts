import { Hono } from "hono";
import { getDb } from "../db/schema";
import { isSystemAdmin } from "../middleware/acl";

const settings = new Hono();

export interface SiteSettings {
  site_title: string;
  site_favicon: string;
  editor_font_family: string;
}

const DEFAULTS: SiteSettings = {
  site_title: "nowen-note",
  site_favicon: "",
  editor_font_family: "",
};

// 获取所有站点设置
settings.get("/", (c) => {
  const db = getDb();
  const rows = db.prepare("SELECT key, value FROM system_settings WHERE key LIKE 'site_%' OR key LIKE 'editor_%'").all() as { key: string; value: string }[];
  const result: Record<string, string> = { ...DEFAULTS };
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return c.json(result);
});

// 更新站点设置
//
// 字段级权限：
//   - site_title / site_favicon 是「站点标识」，全站所有用户共享同一份，
//     允许任何登录用户修改会导致普通成员把整个站点的品牌改掉 —— 因此只允许系统管理员写。
//   - editor_font_family 是字体偏好，目前也是站点级（system_settings 单表共享），
//     按现状保留为所有登录用户均可改；后续若要做"个人字体"，需要迁移到 user_preferences。
//
// 设计权衡：没有把 requireAdmin 挂在整条路由上，因为这样会把字体切换也连带锁死。
// 改成在 handler 里按 body 字段判断，普通用户只要不带 site_title / site_favicon 就放行。
settings.put("/", async (c) => {
  const body = await c.req.json() as Partial<SiteSettings>;
  const userId = c.req.header("X-User-Id") || "";

  const wantsSiteIdentity =
    body.site_title !== undefined || body.site_favicon !== undefined;
  if (wantsSiteIdentity && !isSystemAdmin(userId)) {
    return c.json(
      { error: "仅管理员可修改站点标识", code: "FORBIDDEN" },
      403,
    );
  }

  const db = getDb();

  const upsert = db.prepare(`
    INSERT INTO system_settings (key, value, updatedAt)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = datetime('now')
  `);

  const tx = db.transaction(() => {
    if (body.site_title !== undefined) {
      upsert.run("site_title", body.site_title.trim().slice(0, 20));
    }
    if (body.site_favicon !== undefined) {
      upsert.run("site_favicon", body.site_favicon);
    }
    if (body.editor_font_family !== undefined) {
      upsert.run("editor_font_family", body.editor_font_family);
    }
  });
  tx();

  // 返回更新后的全部设置
  const rows = db.prepare("SELECT key, value FROM system_settings WHERE key LIKE 'site_%' OR key LIKE 'editor_%'").all() as { key: string; value: string }[];
  const result: Record<string, string> = { ...DEFAULTS };
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return c.json(result);
});

export default settings;
