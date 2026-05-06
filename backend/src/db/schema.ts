import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { runMigrations, getCurrentSchemaVersion, CURRENT_SCHEMA_VERSION } from "./migrations.js";

const DB_PATH = process.env.DB_PATH || path.join(process.env.ELECTRON_USER_DATA || path.join(process.cwd(), "data"), "nowen-note.db");

let db: Database.Database;

/**
 * 返回当前 SQLite 数据库文件的绝对路径。
 * 用途：
 *   - 数据管理模块导出/导入 .data 整库文件
 *   - 占用空间统计（fs.statSync）
 * 注意：返回的是**主数据库文件**路径，不含 -wal / -shm 旁路文件。
 */
export function getDbPath(): string {
  return DB_PATH;
}

/**
 * 关闭当前数据库连接。
 *
 * 用于：
 *   1. 数据库导入替换文件前必须先关闭——Windows 上文件被占用无法重命名；
 *   2. 进程优雅关停时主动 checkpoint WAL，确保 .db 主文件包含所有事务，
 *      避免"用户拿 cp .db 做冷备结果丢最近事务"的隐藏故障。
 *
 * 调用后下次 getDb() 会重新打开。
 */
export function closeDb(): void {
  if (db) {
    try {
      // TRUNCATE 模式：把 -wal 内的事务全部 checkpoint 进 .db，并把 -wal 截断到 0；
      // 之后冷拷贝 .db 单文件就是完整的一致性快照。
      db.pragma("wal_checkpoint(TRUNCATE)");
    } catch { /* ignore：实例已损坏或只读时不阻塞关停 */ }
    try { db.close(); } catch { /* ignore */ }
    // @ts-expect-error: 允许重新打开
    db = undefined;
  }
}

export function getDb(): Database.Database {
  if (!db) {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    // ---- P1 加固 PRAGMA ----
    // busy_timeout：极短时间窗口内允许 SQLite 内部重试，避免多连接 / 多进程
    // 同时写时直接抛 SQLITE_BUSY。better-sqlite3 单例本身已串行化所有 SQL，
    // 但当出现"主进程 + 备份子进程""主进程 + CLI 工具""Electron 主 + 子"
    // 这类多连接场景时，没有 busy_timeout 会立刻报错；5s 是一个安全窗口。
    db.pragma("busy_timeout = 5000");
    // synchronous = NORMAL：WAL 模式下 NORMAL 已经能在断电时保证持久化，
    // 性能比 FULL 好得多；这是 SQLite 官方对 WAL 的推荐值。
    db.pragma("synchronous = NORMAL");
    // 完整性快速自检：5~50ms 量级，能发现绝大多数 page-level 损坏。
    // 损坏时直接抛错让进程拒绝启动——比"看似能跑、读到一半才报错"安全得多。
    try {
      const r = db.prepare("PRAGMA quick_check").get() as { quick_check: string } | undefined;
      const result = r?.quick_check;
      if (result && result !== "ok") {
        throw new Error(
          `[db] SQLite quick_check failed: ${result}\n` +
          `数据库文件可能已损坏：${DB_PATH}\n` +
          `修复指引：\n` +
          `  1) 立即停止服务，避免进一步写入；\n` +
          `  2) 备份当前文件（含 -wal/-shm）到只读介质；\n` +
          `  3) 优先使用 nowen-note 的备份恢复功能（POST /api/backups/<file>/restore?dryRun=1 预览）；\n` +
          `  4) 若无可用备份，可尝试：\n` +
          `       sqlite3 ${path.basename(DB_PATH)} ".recover" | sqlite3 recovered.db\n` +
          `     再用 recovered.db 替换原文件。`
        );
      }
    } catch (e) {
      // quick_check 自身抛错（极端损坏）也让启动失败。
      if (e instanceof Error && e.message.startsWith("[db]")) throw e;
      throw new Error(
        `[db] SQLite quick_check 执行异常: ${e instanceof Error ? e.message : String(e)}\n` +
        `数据库文件可能已损坏：${DB_PATH}`
      );
    }
    initSchema(db);
    // ---- D3：版本化迁移 ----
    // initSchema 内部用 IF NOT EXISTS / ALTER 兜底负责"基线 + 历史增量"，
    // 之后所有新 schema 演化通过 migrations.ts 的 MIGRATIONS 数组登记，
    // 由 runMigrations 在事务里串行执行并把版本写进 schema_migrations。
    // 拒绝降级：发现 DB 版本高于程序支持版本时直接抛错，避免旧程序写坏新库。
    try {
      runMigrations(db);
    } catch (e) {
      // 让进程启动失败：迁移失败比"看似能跑"安全得多。
      try { db.close(); } catch { /* ignore */ }
      // @ts-expect-error: 允许重新打开
      db = undefined;
      throw e;
    }
  }
  return db;
}

/**
 * 返回当前数据库文件实际应用到的 schema 版本号。
 * 备份系统用它写入 meta.json，恢复时校验"备份的 schema 是否与当前程序兼容"。
 */
export function getDbSchemaVersion(): number {
  return getCurrentSchemaVersion(getDb());
}

/** 当前程序代码已知的最高 schema 版本号（== max(MIGRATIONS.version)）。 */
export function getCodeSchemaVersion(): number {
  return CURRENT_SCHEMA_VERSION;
}

function initSchema(db: Database.Database) {
  db.exec(`
    -- 用户表
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      email TEXT UNIQUE,
      passwordHash TEXT NOT NULL,
      avatarUrl TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 笔记本表 (支持无限层级)
    CREATE TABLE IF NOT EXISTS notebooks (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      parentId TEXT,
      name TEXT NOT NULL,
      description TEXT,
      icon TEXT DEFAULT '📒',
      color TEXT,
      sortOrder INTEGER DEFAULT 0,
      isExpanded INTEGER DEFAULT 1,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (parentId) REFERENCES notebooks(id) ON DELETE CASCADE
    );

    -- 笔记表
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      notebookId TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '无标题笔记',
      content TEXT DEFAULT '{}',
      contentText TEXT DEFAULT '',
      isPinned INTEGER DEFAULT 0,
      isFavorite INTEGER DEFAULT 0,
      isLocked INTEGER DEFAULT 0,
      isArchived INTEGER DEFAULT 0,
      isTrashed INTEGER DEFAULT 0,
      trashedAt TEXT,
      version INTEGER DEFAULT 1,
      sortOrder INTEGER DEFAULT 0,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (notebookId) REFERENCES notebooks(id) ON DELETE CASCADE
    );

    -- 标签表
    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT DEFAULT '#58a6ff',
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(userId, name)
    );

    -- 笔记-标签 多对多关联表
    CREATE TABLE IF NOT EXISTS note_tags (
      noteId TEXT NOT NULL,
      tagId TEXT NOT NULL,
      PRIMARY KEY (noteId, tagId),
      FOREIGN KEY (noteId) REFERENCES notes(id) ON DELETE CASCADE,
      FOREIGN KEY (tagId) REFERENCES tags(id) ON DELETE CASCADE
    );

    -- 附件表
    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      noteId TEXT NOT NULL,
      userId TEXT NOT NULL,
      filename TEXT NOT NULL,
      mimeType TEXT NOT NULL,
      size INTEGER NOT NULL,
      path TEXT NOT NULL,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (noteId) REFERENCES notes(id) ON DELETE CASCADE,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );

    -- 系统设置表（键值对）
    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT '',
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 待办任务表
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      title TEXT NOT NULL,
      isCompleted INTEGER DEFAULT 0,
      priority INTEGER DEFAULT 2,
      dueDate TEXT,
      noteId TEXT,
      parentId TEXT,
      sortOrder INTEGER DEFAULT 0,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (noteId) REFERENCES notes(id) ON DELETE SET NULL,
      FOREIGN KEY (parentId) REFERENCES tasks(id) ON DELETE CASCADE
    );

    -- 自定义字体表
    CREATE TABLE IF NOT EXISTS custom_fonts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      fileName TEXT NOT NULL UNIQUE,
      format TEXT NOT NULL,
      fileSize INTEGER DEFAULT 0,
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 说说/动态表
    CREATE TABLE IF NOT EXISTS diaries (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      contentText TEXT DEFAULT '',
      mood TEXT DEFAULT '',
      -- 图片：JSON 数组字符串，元素是 diary_attachments.id（uuid）。
      -- 默认 '[]' 而不是 NULL，方便 SQL/前端无脑 JSON.parse。
      images TEXT NOT NULL DEFAULT '[]',
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_diaries_user_created ON diaries(userId, createdAt DESC);

    -- 说说图片附件表（与 notes 的 attachments 表平行，避免 noteId NOT NULL 限制）
    --   diaryId 可空：发布前先上传（拿到 id 后再 attach 到 diary），
    --                 配合 createdAt 做"超时未绑定 → 视为孤儿清理"
    --   path 与 attachments 表语义一致：相对 ATTACHMENTS_DIR 的文件名
    CREATE TABLE IF NOT EXISTS diary_attachments (
      id TEXT PRIMARY KEY,
      diaryId TEXT,
      userId TEXT NOT NULL,
      mimeType TEXT NOT NULL,
      size INTEGER NOT NULL,
      path TEXT NOT NULL,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (diaryId) REFERENCES diaries(id) ON DELETE CASCADE,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_diary_attachments_diary ON diary_attachments(diaryId);
    CREATE INDEX IF NOT EXISTS idx_diary_attachments_user_created ON diary_attachments(userId, createdAt);

    -- 分享记录表
    CREATE TABLE IF NOT EXISTS shares (
      id TEXT PRIMARY KEY,
      noteId TEXT NOT NULL,
      ownerId TEXT NOT NULL,
      shareToken TEXT NOT NULL UNIQUE,
      shareType TEXT NOT NULL DEFAULT 'link',
      permission TEXT NOT NULL DEFAULT 'view',
      password TEXT,
      expiresAt TEXT,
      maxViews INTEGER,
      viewCount INTEGER DEFAULT 0,
      isActive INTEGER DEFAULT 1,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (noteId) REFERENCES notes(id) ON DELETE CASCADE,
      FOREIGN KEY (ownerId) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_shares_note ON shares(noteId);
    CREATE INDEX IF NOT EXISTS idx_shares_owner ON shares(ownerId);
    CREATE INDEX IF NOT EXISTS idx_shares_token ON shares(shareToken);

    -- 笔记版本历史表
    CREATE TABLE IF NOT EXISTS note_versions (
      id TEXT PRIMARY KEY,
      noteId TEXT NOT NULL,
      userId TEXT NOT NULL,
      title TEXT,
      content TEXT,
      contentText TEXT,
      version INTEGER NOT NULL,
      changeType TEXT DEFAULT 'edit',
      changeSummary TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (noteId) REFERENCES notes(id) ON DELETE CASCADE,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_note_versions_note ON note_versions(noteId, version DESC);

    -- 评论批注表
    CREATE TABLE IF NOT EXISTS share_comments (
      id TEXT PRIMARY KEY,
      noteId TEXT NOT NULL,
      userId TEXT NOT NULL,
      parentId TEXT,
      content TEXT NOT NULL,
      anchorData TEXT,
      isResolved INTEGER DEFAULT 0,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (noteId) REFERENCES notes(id) ON DELETE CASCADE,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (parentId) REFERENCES share_comments(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_share_comments_note ON share_comments(noteId);

    -- 全文搜索虚拟表
    CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
      title,
      contentText,
      content='notes',
      content_rowid='rowid'
    );

    -- 索引优化
    CREATE INDEX IF NOT EXISTS idx_notes_notebook ON notes(notebookId);
    CREATE INDEX IF NOT EXISTS idx_notes_user ON notes(userId);
    CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updatedAt DESC);
    CREATE INDEX IF NOT EXISTS idx_notes_trashed ON notes(isTrashed);
    CREATE INDEX IF NOT EXISTS idx_notebooks_parent ON notebooks(parentId);
    CREATE INDEX IF NOT EXISTS idx_notebooks_user ON notebooks(userId);
    CREATE INDEX IF NOT EXISTS idx_note_tags_note ON note_tags(noteId);
    CREATE INDEX IF NOT EXISTS idx_note_tags_tag ON note_tags(tagId);
    CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(userId);
    CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(dueDate);
    CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parentId);
    CREATE INDEX IF NOT EXISTS idx_tasks_completed ON tasks(isCompleted);

    -- FTS 同步触发器
    CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
      INSERT INTO notes_fts(rowid, title, contentText) VALUES (new.rowid, new.title, new.contentText);
    END;

    CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
      INSERT INTO notes_fts(notes_fts, rowid, title, contentText) VALUES('delete', old.rowid, old.title, old.contentText);
    END;

    -- 升级触发器：老库可能存在无条件重写 FTS 的旧版本，直接 DROP 后重建为带 WHEN 的条件版本。
    -- 条件：只有 title 或 contentText 真正发生变化时，才重写 FTS 行。
    -- 收益：每次保存都会 bump version/updatedAt，但正文经常没动；避免无用的 FTS 索引维护 I/O。
    -- NULL 安全比较：用 IS NOT 而非 !=，避免任一侧为 NULL 时判断结果是 NULL（假）。
    DROP TRIGGER IF EXISTS notes_au;
    CREATE TRIGGER notes_au AFTER UPDATE ON notes
    WHEN old.title IS NOT new.title OR old.contentText IS NOT new.contentText
    BEGIN
      INSERT INTO notes_fts(notes_fts, rowid, title, contentText) VALUES('delete', old.rowid, old.title, old.contentText);
      INSERT INTO notes_fts(rowid, title, contentText) VALUES (new.rowid, new.title, new.contentText);
    END;
  `);

  // ==============================================================
  // Collaboration Phase 1: 多用户协作基础表
  // ==============================================================
  db.exec(`
    -- 工作区（团队空间）
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      icon TEXT DEFAULT '🏢',
      ownerId TEXT NOT NULL,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (ownerId) REFERENCES users(id) ON DELETE CASCADE
    );

    -- 工作区成员（role: owner|admin|editor|commenter|viewer）
    CREATE TABLE IF NOT EXISTS workspace_members (
      workspaceId TEXT NOT NULL,
      userId TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'editor',
      joinedAt TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (workspaceId, userId),
      FOREIGN KEY (workspaceId) REFERENCES workspaces(id) ON DELETE CASCADE,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );

    -- 工作区邀请码
    CREATE TABLE IF NOT EXISTS workspace_invites (
      id TEXT PRIMARY KEY,
      workspaceId TEXT NOT NULL,
      code TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'editor',
      maxUses INTEGER DEFAULT 10,
      useCount INTEGER DEFAULT 0,
      expiresAt TEXT,
      createdBy TEXT NOT NULL,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (workspaceId) REFERENCES workspaces(id) ON DELETE CASCADE,
      FOREIGN KEY (createdBy) REFERENCES users(id) ON DELETE CASCADE
    );

    -- 笔记级 ACL 覆写（默认继承笔记本 workspace 权限；此表用于个别授权）
    CREATE TABLE IF NOT EXISTS note_acl (
      noteId TEXT NOT NULL,
      userId TEXT NOT NULL,
      permission TEXT NOT NULL, -- 'read'|'comment'|'write'|'manage'
      grantedBy TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (noteId, userId),
      FOREIGN KEY (noteId) REFERENCES notes(id) ON DELETE CASCADE,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_ws_owner ON workspaces(ownerId);
    CREATE INDEX IF NOT EXISTS idx_ws_members_user ON workspace_members(userId);
    CREATE INDEX IF NOT EXISTS idx_ws_members_ws ON workspace_members(workspaceId);
    CREATE INDEX IF NOT EXISTS idx_ws_invites_code ON workspace_invites(code);
    CREATE INDEX IF NOT EXISTS idx_ws_invites_ws ON workspace_invites(workspaceId);
    CREATE INDEX IF NOT EXISTS idx_note_acl_user ON note_acl(userId);
    CREATE INDEX IF NOT EXISTS idx_note_acl_note ON note_acl(noteId);
  `);

  // ==============================================================
  // Collaboration Phase 3: Y.js CRDT 持久化
  // ==============================================================
  db.exec(`
    -- 增量 Y update（每次客户端 update 追加一条；服务重启时按序回放）
    CREATE TABLE IF NOT EXISTS note_yupdates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      noteId TEXT NOT NULL,
      userId TEXT,
      update_blob BLOB NOT NULL,
      clock INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (noteId) REFERENCES notes(id) ON DELETE CASCADE
    );

    -- Y 文档快照（每 N 条 update 或定时生成一次；合并后可清理旧 updates）
    CREATE TABLE IF NOT EXISTS note_ysnapshots (
      noteId TEXT PRIMARY KEY,
      snapshot_blob BLOB NOT NULL,
      updatesMergedTo INTEGER NOT NULL DEFAULT 0,
      updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (noteId) REFERENCES notes(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_note_yupdates_note ON note_yupdates(noteId, id);
  `);

  // notebooks 表增加 workspaceId 字段（NULL 表示归属于用户的个人空间）
  try {
    db.prepare("SELECT workspaceId FROM notebooks LIMIT 1").get();
  } catch {
    db.prepare("ALTER TABLE notebooks ADD COLUMN workspaceId TEXT").run();
    db.exec("CREATE INDEX IF NOT EXISTS idx_notebooks_workspace ON notebooks(workspaceId);");
  }

  // users 表补充多用户相关字段：role / isDisabled / displayName / lastLoginAt
  try {
    db.prepare("SELECT role FROM users LIMIT 1").get();
  } catch {
    db.prepare("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'").run();
    // 把存量首个用户升级为 admin（兼容单机旧库）
    const first = db.prepare("SELECT id FROM users ORDER BY createdAt ASC LIMIT 1").get() as { id: string } | undefined;
    if (first) db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(first.id);
  }
  try {
    db.prepare("SELECT isDisabled FROM users LIMIT 1").get();
  } catch {
    db.prepare("ALTER TABLE users ADD COLUMN isDisabled INTEGER NOT NULL DEFAULT 0").run();
  }
  try {
    db.prepare("SELECT displayName FROM users LIMIT 1").get();
  } catch {
    db.prepare("ALTER TABLE users ADD COLUMN displayName TEXT").run();
  }
  try {
    db.prepare("SELECT lastLoginAt FROM users LIMIT 1").get();
  } catch {
    db.prepare("ALTER TABLE users ADD COLUMN lastLoginAt TEXT").run();
  }

  // Phase 5 安全加固：
  //   tokenVersion          — 每次密码重置 / 账号禁用时自增，使所有旧 JWT 立即失效
  //   mustChangePassword    — factory-reset 后强制下次登录修改密码
  //   failedLoginAttempts   — 累计失败次数（用于账号锁定）
  //   lastFailedLoginAt     — 最近一次失败时间（滑动窗口清零判断用）
  //   lockedUntil           — 账号锁定到期时间（ISO），当前时间 < lockedUntil 禁止登录
  try {
    db.prepare("SELECT tokenVersion FROM users LIMIT 1").get();
  } catch {
    db.prepare("ALTER TABLE users ADD COLUMN tokenVersion INTEGER NOT NULL DEFAULT 0").run();
  }
  try {
    db.prepare("SELECT mustChangePassword FROM users LIMIT 1").get();
  } catch {
    db.prepare("ALTER TABLE users ADD COLUMN mustChangePassword INTEGER NOT NULL DEFAULT 0").run();
  }
  try {
    db.prepare("SELECT failedLoginAttempts FROM users LIMIT 1").get();
  } catch {
    db.prepare("ALTER TABLE users ADD COLUMN failedLoginAttempts INTEGER NOT NULL DEFAULT 0").run();
  }
  try {
    db.prepare("SELECT lastFailedLoginAt FROM users LIMIT 1").get();
  } catch {
    db.prepare("ALTER TABLE users ADD COLUMN lastFailedLoginAt TEXT").run();
  }
  try {
    db.prepare("SELECT lockedUntil FROM users LIMIT 1").get();
  } catch {
    db.prepare("ALTER TABLE users ADD COLUMN lockedUntil TEXT").run();
  }

  // notes 表冗余一个 workspaceId 便于高性能过滤（通过 notebook 同步维护）
  try {
    db.prepare("SELECT workspaceId FROM notes LIMIT 1").get();
  } catch {
    db.prepare("ALTER TABLE notes ADD COLUMN workspaceId TEXT").run();
    db.exec("CREATE INDEX IF NOT EXISTS idx_notes_workspace ON notes(workspaceId);");
  }

  // 数据库迁移：为已有表添加新字段
  try {
    db.prepare("SELECT isLocked FROM notes LIMIT 1").get();
  } catch {
    db.prepare("ALTER TABLE notes ADD COLUMN isLocked INTEGER DEFAULT 0").run();
  }

  // 迁移：如果旧版 diaries 表有 date 列，删掉重建
  try {
    db.prepare("SELECT date FROM diaries LIMIT 1").get();
    // 旧表存在 date 列 → 重建
    db.exec("DROP TABLE IF EXISTS diaries");
    db.exec(`
      CREATE TABLE IF NOT EXISTS diaries (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        contentText TEXT DEFAULT '',
        mood TEXT DEFAULT '',
        images TEXT NOT NULL DEFAULT '[]',
        createdAt TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_diaries_user_created ON diaries(userId, createdAt DESC);
    `);
  } catch {
    // 新表或表不存在，跳过
  }

  // 迁移：旧版 diaries 表（date 已清理但还没有 images 列）补加 images 列。
  // 与 notes.isLocked / users.lockedUntil 等迁移同款 ALTER TABLE 模式。
  try {
    db.prepare("SELECT images FROM diaries LIMIT 1").get();
  } catch {
    db.prepare("ALTER TABLE diaries ADD COLUMN images TEXT NOT NULL DEFAULT '[]'").run();
  }

  // 迁移：补建 diary_attachments 表（旧库初始化时这张表还不存在）。
  // CREATE TABLE IF NOT EXISTS 是幂等的，直接 exec 即可。
  db.exec(`
    CREATE TABLE IF NOT EXISTS diary_attachments (
      id TEXT PRIMARY KEY,
      diaryId TEXT,
      userId TEXT NOT NULL,
      mimeType TEXT NOT NULL,
      size INTEGER NOT NULL,
      path TEXT NOT NULL,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (diaryId) REFERENCES diaries(id) ON DELETE CASCADE,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_diary_attachments_diary ON diary_attachments(diaryId);
    CREATE INDEX IF NOT EXISTS idx_diary_attachments_user_created ON diary_attachments(userId, createdAt);
  `);

  // 任务附件表（待办事项模块支持插入图片）
  // ----------------------------------------------------------------------
  // 设计要点：
  //   - 与 attachments / diary_attachments 同款：文件落盘到 ATTACHMENTS_DIR，
  //     行里只存元数据。
  //   - taskId 可空：允许"先上传图片、再随新任务一起提交"的链路（典型场景：
  //     用户在新建任务输入框里粘贴图片，那一刻 task 行还没创建）。前端创建
  //     任务后再把附件 id 关联回 task。未关联的附件由定期清理脚本处理。
  //   - userId NOT NULL：用于上传 ACL（自己上传的自己能删）+ 孤儿清理审计。
  //   - 不与 attachments 表合并：attachments 强外键到 notes，语义耦合度太高
  //     （ACL、CASCADE、迁移工具）。新表保持解耦更简单。
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_attachments (
      id TEXT PRIMARY KEY,
      taskId TEXT,
      userId TEXT NOT NULL,
      filename TEXT NOT NULL,
      mimeType TEXT NOT NULL,
      size INTEGER NOT NULL,
      path TEXT NOT NULL,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (taskId) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_task_attachments_task ON task_attachments(taskId);
    CREATE INDEX IF NOT EXISTS idx_task_attachments_user_created ON task_attachments(userId, createdAt);
  `);

  // ==============================================================
  // 安全加固 Phase 6：2FA（TOTP）+ 会话管理
  // ==============================================================
  //
  // users 表新增 2FA 字段：
  //   twoFactorSecret       — base32 编码的 TOTP secret（仅在 enabled 时有值；disable 后 NULL）
  //   twoFactorEnabledAt    — 启用时间，用于前端展示；NULL 即未启用
  //   twoFactorBackupCodes  — JSON 数组，元素是 sha256 过的一次性恢复码；匹配并消费后移除
  try {
    db.prepare("SELECT twoFactorSecret FROM users LIMIT 1").get();
  } catch {
    db.prepare("ALTER TABLE users ADD COLUMN twoFactorSecret TEXT").run();
  }
  try {
    db.prepare("SELECT twoFactorEnabledAt FROM users LIMIT 1").get();
  } catch {
    db.prepare("ALTER TABLE users ADD COLUMN twoFactorEnabledAt TEXT").run();
  }
  try {
    db.prepare("SELECT twoFactorBackupCodes FROM users LIMIT 1").get();
  } catch {
    db.prepare("ALTER TABLE users ADD COLUMN twoFactorBackupCodes TEXT").run();
  }

  // sessions 表：每次签发登录 JWT 都落一条记录，服务端可列出用户的活跃 session，
  // 并通过 revokedAt 做"吊销"而不必 bump tokenVersion（避免误伤所有端）。
  //
  //   id          会话 ID，同时作为 JWT 的 jti claim
  //   userId      所属用户
  //   createdAt   登录时间
  //   lastSeenAt  最近一次带该 jti 的请求到达时间（JWT 中间件会异步更新）
  //   expiresAt   与 JWT exp 对齐，仅用于过期清理
  //   ip          首次登录的 IP
  //   userAgent   首次登录的 UA，前端做"显示设备名"
  //   deviceLabel 用户自己起的名字，可选
  //   revokedAt   被管理员或用户吊销；非 NULL 后该 jti 的 token 一律失效
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      lastSeenAt TEXT NOT NULL DEFAULT (datetime('now')),
      expiresAt TEXT,
      ip TEXT DEFAULT '',
      userAgent TEXT DEFAULT '',
      deviceLabel TEXT,
      revokedAt TEXT,
      revokedReason TEXT,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(userId, revokedAt, lastSeenAt DESC);
  `);

  // ==============================================================
  // AI 知识问答聊天记录（跨会话持久化）
  // ==============================================================
  //
  // 每条消息一行：user 的提问和 assistant 的回复各存一条，按 createdAt 升序即为对话时间线。
  //   id              消息 ID（前端生成的也可以，只要全局唯一；本端路由直接用时间戳+随机串）
  //   userId          所属用户；ON DELETE CASCADE 使账号删除时连带清理
  //   role            'user' | 'assistant'
  //   content         纯文本消息内容（Markdown 原文）
  //   referencesJson  可选，仅 assistant 消息使用，存 [{id,title},...] 的 JSON 字符串；
  //                   笔记后续可能被删，恢复时前端点击跳转自行容错即可
  //   createdAt       创建时间，用于排序和按时间窗口裁剪
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_chat_messages (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      referencesJson TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_ai_chat_user_created ON ai_chat_messages(userId, createdAt);
  `);

  // ==============================================================
  // RAG Phase 1：笔记向量化（Embedding）基础表
  // ==============================================================
  //
  // 设计要点：
  //   - note_embeddings：每个 chunk 一行；当前 Phase 1 还没接 sqlite-vec，
  //     向量先以 JSON 文本形式存在 vectorJson（一维 float 数组）。
  //     Phase 2 接入 sqlite-vec 时会再建一个虚表 vec_note_chunks 并按 rowid
  //     关联，本表的 vectorJson 列保留作"原始向量备份"。
  //   - embedding_queue：异步任务队列，单条 noteId 对应一行。
  //     status: 'pending' | 'processing' | 'done' | 'failed'
  //     用 ON CONFLICT(noteId) DO UPDATE 实现"覆盖入队"——
  //     笔记连续修改 5 次只会留 1 条 pending。
  //   - 触发器：notes INSERT / contentText 或 title 变化时自动入队。
  //     和现有的 notes_au FTS 触发器同款条件，避免无意义重排。
  //   - 删除笔记 → CASCADE 清理 note_embeddings；队列也加触发器同步删除。
  db.exec(`
    CREATE TABLE IF NOT EXISTS note_embeddings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      noteId TEXT NOT NULL,
      userId TEXT NOT NULL,
      model TEXT NOT NULL,
      dim INTEGER NOT NULL,
      chunkIndex INTEGER NOT NULL DEFAULT 0,
      chunkText TEXT NOT NULL DEFAULT '',
      vectorJson TEXT NOT NULL DEFAULT '[]',
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (noteId) REFERENCES notes(id) ON DELETE CASCADE,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_note_embeddings_note ON note_embeddings(noteId);
    CREATE INDEX IF NOT EXISTS idx_note_embeddings_user ON note_embeddings(userId);
    CREATE INDEX IF NOT EXISTS idx_note_embeddings_model ON note_embeddings(model);

    CREATE TABLE IF NOT EXISTS embedding_queue (
      noteId TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      retries INTEGER NOT NULL DEFAULT 0,
      lastError TEXT,
      enqueuedAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (noteId) REFERENCES notes(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_embedding_queue_status ON embedding_queue(status, enqueuedAt);

    -- INSERT 触发：新笔记入队（contentText 可能为空，由 worker 决定是否真的算 embedding）
    DROP TRIGGER IF EXISTS notes_embed_ai;
    CREATE TRIGGER notes_embed_ai AFTER INSERT ON notes
    WHEN new.isTrashed = 0
    BEGIN
      INSERT INTO embedding_queue (noteId, userId, status, retries, enqueuedAt, updatedAt)
      VALUES (new.id, new.userId, 'pending', 0, datetime('now'), datetime('now'))
      ON CONFLICT(noteId) DO UPDATE SET
        status = 'pending',
        retries = 0,
        lastError = NULL,
        updatedAt = datetime('now');
    END;

    -- UPDATE 触发：仅当 title/contentText 真正变化时才重新入队
    -- isTrashed: 0→1 进回收站时不重排（也可以选择删除，简单起见交给 worker 跳过）
    DROP TRIGGER IF EXISTS notes_embed_au;
    CREATE TRIGGER notes_embed_au AFTER UPDATE ON notes
    WHEN (old.title IS NOT new.title OR old.contentText IS NOT new.contentText)
         AND new.isTrashed = 0
    BEGIN
      INSERT INTO embedding_queue (noteId, userId, status, retries, enqueuedAt, updatedAt)
      VALUES (new.id, new.userId, 'pending', 0, datetime('now'), datetime('now'))
      ON CONFLICT(noteId) DO UPDATE SET
        status = 'pending',
        retries = 0,
        lastError = NULL,
        updatedAt = datetime('now');
    END;
  `);

  // 一次性回填：老库存量笔记入队，方便首次启动后台 worker 后能逐步建立索引。
  // 仅在 embedding_queue 完全为空时执行，避免重启时反复回填。
  // 注意：只入队没有任何 embedding 的笔记，避免破坏已建好的索引。
  try {
    const queued = db.prepare("SELECT COUNT(*) as c FROM embedding_queue").get() as { c: number };
    if (queued.c === 0) {
      db.prepare(`
        INSERT INTO embedding_queue (noteId, userId, status, retries, enqueuedAt, updatedAt)
        SELECT n.id, n.userId, 'pending', 0, datetime('now'), datetime('now')
        FROM notes n
        WHERE n.isTrashed = 0
          AND NOT EXISTS (SELECT 1 FROM note_embeddings e WHERE e.noteId = n.id)
        ON CONFLICT(noteId) DO NOTHING
      `).run();
    }
  } catch (e) {
    // 回填失败不影响主流程
    console.warn("[schema] backfill embedding_queue failed:", e);
  }
}
