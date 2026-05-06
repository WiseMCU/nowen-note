/**
 * 数据备份与恢复 API
 *
 * - GET    /api/backups                       — 列出备份
 * - GET    /api/backups/status                — 健康指标（含同卷告警）
 * - GET    /api/backups/dir                   — 当前备份目录 + 数据目录（管理员）
 * - POST   /api/backups/dir                   — 切换备份目录（管理员 + sudo；?dryRun=1 仅校验）
 * - POST   /api/backups                       — 创建备份（管理员 + sudo）
 * - GET    /api/backups/:filename/download    — 下载备份（管理员）
 * - POST   /api/backups/:filename/restore     — 从备份恢复（管理员 + sudo；支持 ?dryRun=1）
 * - DELETE /api/backups/:filename             — 删除备份（管理员 + sudo）
 * - POST   /api/backups/auto                  — 启动/停止自动备份（管理员 + sudo）
 *
 * 安全：
 *  - 整个路由组都强制 requireAdmin —— 备份文件是全库 dump，普通用户既不该看到
 *    其他人的快照，也不该有权限恢复 / 删除。
 *  - 破坏性操作（POST、DELETE、restore、auto）额外要求 sudoToken：
 *    与 /api/data-file/import 一致的 H2 二次验证模式，避免会话被劫持后被一键
 *    "恢复到三个月前"或"删光所有备份"。
 *  - restore 必须先以 dryRun=true 调用一次让前端弹出
 *    "将清空 N 行 / 将插入 M 行 / 含 K 个附件" 的二次确认对话框，再正式提交。
 *  - 当 status.sameVolume=true 时前端应在备份页给出红色横幅，明确告知"备份与
 *    数据在同一物理卷，无法防御卷级故障，请在 docker-compose 配置 BACKUP_DIR
 *    指向独立卷"。
 */

import { Hono } from "hono";
import type { Context } from "hono";
import fs from "fs";
import { getBackupManager } from "../services/backup.js";
import { requireAdmin } from "../middleware/acl.js";
import { getDb } from "../db/schema.js";
import { verifySudoFromRequest } from "../lib/auth-security.js";

const backupsRouter = new Hono();

// ============================================================================
// 全路由守门：必须是系统管理员
// ----------------------------------------------------------------------------
// 备份文件覆盖全库（含其他用户的私密笔记 / 加密 secret），不能让普通用户访问。
// 采用 router.use(*, requireAdmin) 避免每个 handler 重复挂。
// ============================================================================
backupsRouter.use("*", requireAdmin);

/**
 * 高危操作的 sudo 校验封装。
 *
 * 与 routes/users.ts 的 requireSudoOrDeny 一脉相承：拿当前 userId 的
 * tokenVersion 去 verifySudoFromRequest，命中即返回 null（放行），未命中
 * 返回带 SUDO_REQUIRED/SUDO_INVALID 的 403/401，前端会据此弹密码框重试。
 *
 * 备份场景下不接审计日志（routes/users.ts 才接），原因：
 *  - 操作主体已是单一管理员（不像用户管理涉及"我对别人做了什么"）；
 *  - 备份创建/删除已经在 BackupManager 内部 console.log 留痕；
 *  - 服务器日志足够追踪谁在何时点了 restore。
 */
function requireBackupSudo(c: Context): Response | null {
  const userId = c.req.header("X-User-Id") || "";
  const db = getDb();
  const me = db
    .prepare("SELECT tokenVersion FROM users WHERE id = ?")
    .get(userId) as { tokenVersion: number } | undefined;
  const sudo = verifySudoFromRequest(c, userId, me?.tokenVersion ?? 0);
  if (!sudo.ok) {
    return c.json({ error: sudo.message, code: sudo.code }, sudo.status as 401 | 403);
  }
  return null;
}

// ===== GET /api/backups =====
backupsRouter.get("/", (c) => {
  const manager = getBackupManager();
  return c.json(manager.listBackups());
});

// ===== GET /api/backups/status =====
backupsRouter.get("/status", (c) => {
  const manager = getBackupManager();
  return c.json(manager.getHealth());
});

// ===== GET /api/backups/dir =====
// 返回 { backupDir, dataDir }，供前端"备份目录配置区"显示当前生效值。
// 不需要 sudo——只是读路径字符串，不暴露备份内容。
backupsRouter.get("/dir", (c) => {
  const manager = getBackupManager();
  return c.json({
    backupDir: manager.getBackupDir(),
    dataDir: manager.getDataDir(),
  });
});

// ===== POST /api/backups/dir =====
// body: { path: string }
// query: ?dryRun=1   仅校验路径合法性 + 同卷/可用空间，不真正切换
//
// 安全：
//   - dryRun 仍需 admin（防嗅探）但不需 sudo——前端要先用它给出
//     "同卷警告/可用空间显示/不可写报错"才决定要不要弹密码框；
//   - 真正切换必须 sudo——这是会影响往后所有备份落地位置的全局性操作。
//
// 注意：切换后旧目录的备份文件不会被自动迁移，需管理员手动 cp（前端文案已说明）。
backupsRouter.post("/dir", async (c) => {
  const qDry = c.req.query("dryRun");
  const body = (await c.req.json().catch(() => ({}))) as { path?: string; dryRun?: boolean };
  const dryRun = qDry === "1" || qDry === "true" || body.dryRun === true;
  const target = String(body.path || "").trim();

  if (!target) {
    return c.json({ error: "缺少 path 参数" }, 400);
  }

  if (!dryRun) {
    const denied = requireBackupSudo(c);
    if (denied) return denied;
  }

  const manager = getBackupManager();
  const result = dryRun ? manager.previewBackupDir(target) : manager.setBackupDir(target);

  if (!result.ok) {
    // 校验失败属于客户端输入错（路径不合法/不可写），返回 400 + reason 让前端做 i18n
    return c.json(
      {
        ok: false,
        reason: result.reason,
        message: result.message,
        resolved: result.resolved,
      },
      400,
    );
  }

  return c.json({
    ok: true,
    dryRun,
    resolved: result.resolved,
    sameVolume: result.sameVolume,
    freeBytes: result.freeBytes,
  });
});

// ===== POST /api/backups =====
// 创建备份本身不是破坏性的，但会消耗磁盘 + 暴露全库快照路径，
// 仍要求 sudo —— 与 /data-file/export 的"管理员可下载"语义保持一致严格度。
backupsRouter.post("/", async (c) => {
  const denied = requireBackupSudo(c);
  if (denied) return denied;

  const body = (await c.req.json().catch(() => ({}))) as { type?: "full" | "db-only"; description?: string };
  const manager = getBackupManager();

  try {
    const info = await manager.createBackup({
      type: body.type || "db-only",
      description: body.description,
    });
    return c.json(info, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: `备份失败: ${msg}` }, 500);
  }
});

// ===== GET /api/backups/:filename/download =====
backupsRouter.get("/:filename/download", (c) => {
  const filename = c.req.param("filename");
  const manager = getBackupManager();
  const filePath = manager.getBackupPath(filename);

  if (!filePath) return c.json({ error: "备份不存在" }, 404);

  const content = fs.readFileSync(filePath);
  return new Response(content, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": content.length.toString(),
    },
  });
});

// ===== POST /api/backups/:filename/restore =====
// 查询参数 ?dryRun=1 时只预览不动数据；body 也可传 { dryRun: true }
//
// 安全分层：
//   - dryRun=true 仍需 admin（防嗅探），但 **不强制 sudo**——前端要先调它
//     才能展示"将清空 N 行"的预览，让用户在密码框前看到风险；
//   - dryRun=false 必须 sudo——这是真正的破坏性提交。
backupsRouter.post("/:filename/restore", async (c) => {
  const filename = c.req.param("filename");
  const manager = getBackupManager();
  const qDry = c.req.query("dryRun");
  const body = (await c.req.json().catch(() => ({}))) as { dryRun?: boolean };
  const dryRun = qDry === "1" || qDry === "true" || body.dryRun === true;

  if (!dryRun) {
    const denied = requireBackupSudo(c);
    if (denied) return denied;
  }

  const result = await manager.restoreFromBackup(filename, { dryRun });
  if (!result.success) {
    return c.json({ error: result.error }, 400);
  }
  return c.json(result);
});

// ===== DELETE /api/backups/:filename =====
backupsRouter.delete("/:filename", (c) => {
  const denied = requireBackupSudo(c);
  if (denied) return denied;

  const filename = c.req.param("filename");
  const manager = getBackupManager();
  const result = manager.deleteBackup(filename);
  return c.json({ success: result });
});

// ===== POST /api/backups/auto =====
// body: { enabled: boolean, intervalHours?: number }
//   - enabled=false: 立即停止；intervalHours 仍会被持久化为"下次启用时使用的值"
//   - enabled=true:  以 intervalHours（缺省 24）启动并持久化
//
// 持久化由 BackupManager.startAutoBackup / stopAutoBackup 内部完成，
// 写入 system_settings 表的 backup:auto 键。重启后 BackupManager 构造时会读它。
backupsRouter.post("/auto", async (c) => {
  const denied = requireBackupSudo(c);
  if (denied) return denied;

  const body = (await c.req.json().catch(() => ({}))) as { enabled?: boolean; intervalHours?: number };
  const manager = getBackupManager();

  // 间隔范围校验：1h ~ 720h(30 天)。低于 1h 会让备份吞 IO；高于 30 天等于没开。
  let interval = body.intervalHours ?? 24;
  if (!Number.isFinite(interval) || interval < 1) interval = 1;
  if (interval > 720) interval = 720;

  if (body.enabled === false) {
    manager.stopAutoBackup({ persist: true, intervalHours: interval });
    return c.json({ success: true, message: "自动备份已停止", enabled: false, intervalHours: interval });
  }

  manager.startAutoBackup(interval, { persist: true });
  return c.json({
    success: true,
    message: `自动备份已启动，间隔 ${interval} 小时`,
    enabled: true,
    intervalHours: interval,
  });
});

export default backupsRouter;
