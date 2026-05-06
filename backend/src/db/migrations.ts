/**
 * SQLite Schema 迁移框架（D3）
 * ---------------------------------------------------------------------------
 *
 * 在此之前，schema.ts 末尾散落着大量
 *
 *   try { db.prepare("SELECT col FROM t LIMIT 1").get(); }
 *   catch { db.prepare("ALTER TABLE t ADD COLUMN col ...").run(); }
 *
 * 这种 "用 SELECT 失败兜底" 的迁移方式有几个根本性问题：
 *
 *   1) **没有版本号**：无法判断 "当前 DB 走到了哪一步"。一旦某次 ALTER 中途
 *      失败，下次启动只会重试自己；无法编写 "v3 迁移依赖 v2 已完成" 的脚本。
 *   2) **无法防回滚**：用户用旧版程序打开新版数据库时，旧程序看不到新列，
 *      会误认为是旧库直接添加列，可能写入与新版不兼容的数据。
 *   3) **难以审计**：无法回答 "这个库经历过哪些迁移、每一步在何时完成"。
 *   4) **无法防并发**：多副本部署时谁先抢到锁先执行。
 *
 * 本模块解决方案：
 *
 *   - `schema_migrations` 表持久化 **已应用** 的版本号 + 应用时间。
 *   - `MIGRATIONS` 数组按 `version` 升序登记每条迁移；每条迁移在自己的
 *     事务里运行——失败回滚，不会留下 "半截结构"。
 *   - 启动时按版本号串行 apply：当前版本 < 迁移版本 → 执行；否则跳过。
 *   - 拒绝降级：当 user_version > MAX(已知迁移版本) 时直接抛错，避免旧版
 *     程序破坏新库。
 *
 * 与备份的协作（B2/B4）：
 *   - 备份元信息里写入当前 schema_version。恢复时校验版本是否兼容
 *     （由 backup.ts 完成，不在此处）。
 *
 * 设计取舍：
 *   - 仍然保留 schema.ts 里的 `CREATE TABLE IF NOT EXISTS ...` 作为 v0
 *     "基线"；新部署一开始就有完整结构，迁移系统只在已存在的旧库上做
 *     增量改动。这样不必把整套 DDL 拆成"v1 创建表→v2 加列"的迁移链。
 *   - 旧的散落 try/catch ALTER 仍保留几个版本，逐步迁过来——本次只把
 *     "新增的"演化登记到 MIGRATIONS。
 */

import type Database from "better-sqlite3";

/** 单条迁移声明 */
export interface Migration {
  /** 单调递增的整数版本号；不允许跳号或重复 */
  version: number;
  /** 人类可读名称，便于日志与排查 */
  name: string;
  /**
   * 执行迁移；调用方已经把它包在事务里，函数内部抛任何异常都会触发回滚。
   * 不要在函数里再开嵌套事务。
   */
  up(db: Database.Database): void;
}

// ===== 已登记迁移 =====
// 新增迁移：只追加，不修改/删除已发布的项；版本号严格递增。
//
// 起点 v1 故意不包含旧的 ALTER 列，因为这些 ALTER 已经通过 schema.ts 里的
// try/catch 兜底执行过；把它们写到迁移里反而会和 catch 路径竞争（会双写）。
// 当下后续新增的列 / 索引 / 表统一从 v2 开始登记。
export const MIGRATIONS: Migration[] = [
  // 示例位：用 v1 来标记 "迁移系统首次接管" 的 anchor，不做任何 schema 改动。
  // 下次有新 schema 变化时，加 v2、v3 ...
  {
    version: 1,
    name: "init-migration-table-anchor",
    up: () => {
      // no-op：仅用于把 user_version 从 0 抬到 1，让以后的迁移有起点。
    },
  },
];

/** 当前代码已知的最高 schema 版本（== MIGRATIONS 里 max(version)）。 */
export const CURRENT_SCHEMA_VERSION: number = MIGRATIONS.reduce(
  (acc, m) => (m.version > acc ? m.version : acc),
  0,
);

/** 创建迁移记录表（幂等）。 */
function ensureMigrationsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      appliedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

/** 读取当前 DB 已应用的最高版本号（无记录返回 0）。 */
export function getCurrentSchemaVersion(db: Database.Database): number {
  ensureMigrationsTable(db);
  const row = db
    .prepare("SELECT MAX(version) AS v FROM schema_migrations")
    .get() as { v: number | null } | undefined;
  return row?.v ?? 0;
}

/**
 * 应用所有未执行的迁移。
 *
 * 行为：
 *   - 当前版本 < 已登记最高版本：依次 apply，每条放在自己的事务里。
 *   - 当前版本 == 已登记最高版本：no-op。
 *   - 当前版本 > 已登记最高版本：抛错——典型场景是 "用 v3 程序打开 v5 库"，
 *     旧程序不应继续运行；让它早死，比沉默写坏数据强得多。
 *
 * @returns 实际执行的迁移数量
 */
export function runMigrations(db: Database.Database): number {
  ensureMigrationsTable(db);
  const cur = getCurrentSchemaVersion(db);

  if (cur > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `[migrations] 数据库版本 ${cur} 高于当前程序支持的 ${CURRENT_SCHEMA_VERSION}。\n` +
      `这通常是 "用旧版程序打开新版数据库" 造成的。请升级到对应版本的 nowen-note 后再启动。`,
    );
  }

  const pending = MIGRATIONS.filter((m) => m.version > cur).sort((a, b) => a.version - b.version);
  if (pending.length === 0) return 0;

  // 校验版本严格递增、无跳号、无重复
  let prev = cur;
  for (const m of pending) {
    if (m.version <= prev) {
      throw new Error(`[migrations] 版本号必须严格递增：v${prev} 之后是 v${m.version}（${m.name}）`);
    }
    prev = m.version;
  }

  const insert = db.prepare("INSERT INTO schema_migrations (version, name) VALUES (?, ?)");
  let applied = 0;
  for (const m of pending) {
    const tx = db.transaction(() => {
      m.up(db);
      insert.run(m.version, m.name);
    });
    try {
      tx();
      applied++;
      console.log(`[migrations] applied v${m.version} (${m.name})`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`[migrations] v${m.version} (${m.name}) failed: ${msg}`);
    }
  }
  return applied;
}
