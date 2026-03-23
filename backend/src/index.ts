import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import path from "path";
import fs from "fs";
import jwt from "jsonwebtoken";
import notebooksRouter from "./routes/notebooks";
import notesRouter from "./routes/notes";
import tagsRouter from "./routes/tags";
import searchRouter from "./routes/search";
import tasksRouter from "./routes/tasks";
import exportRouter from "./routes/export";
import settingsRouter from "./routes/settings";
import fontsRouter from "./routes/fonts";
import micloudRouter from "./routes/micloud";
import oppoCloudRouter from "./routes/oppocloud";
import icloudRouter from "./routes/icloud";
import mindmapsRouter from "./routes/mindmaps";
import diaryRouter from "./routes/diary";

import aiRouter from "./routes/ai";
import pipelinesRouter from "./routes/pipelines";
import pluginsRouter from "./routes/plugins";
import webhooksRouter from "./routes/webhooks";
import auditRouter from "./routes/audit";
import backupsRouter from "./routes/backups";
import { sharesRouter, sharedRouter } from "./routes/shares";
import authRouter, { JWT_SECRET } from "./routes/auth";
import { seedDatabase } from "./db/seed";
import { getDb } from "./db/schema";
import { generateOpenAPISpec } from "./services/openapi";
import { getBackupManager } from "./services/backup";

const app = new Hono();

app.use("*", logger());
app.use("*", cors({
  origin: (origin) => origin || "*",
  allowMethods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowHeaders: ["Content-Type", "X-User-Id", "Authorization"],
  credentials: true,
}));

// 初始化数据库
getDb();
seedDatabase();

// 认证路由（无需 JWT）
app.route("/api/auth", authRouter);

// 分享公开访问路由（无需 JWT）
// Phase 5: 速率限制 — 防止暴力破解密码和恶意轮询
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

app.use("/api/shared/*", async (c, next) => {
  const ip = c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "unknown";
  const now = Date.now();
  const windowMs = 60000; // 1分钟窗口
  const maxRequests = 60;  // 每分钟最多60次

  const entry = rateLimitMap.get(ip);
  if (entry && entry.resetAt > now) {
    if (entry.count >= maxRequests) {
      return c.json({ error: "请求过于频繁，请稍后重试" }, 429);
    }
    entry.count++;
  } else {
    rateLimitMap.set(ip, { count: 1, resetAt: now + windowMs });
  }

  // 定期清理过期条目（每1000次请求清理一次）
  if (rateLimitMap.size > 1000) {
    for (const [key, val] of rateLimitMap.entries()) {
      if (val.resetAt <= now) rateLimitMap.delete(key);
    }
  }

  // Phase 5: 安全响应头
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("X-XSS-Protection", "1; mode=block");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");

  await next();
});

// 密码验证接口加强速率限制（每分钟最多10次）
const passwordRateLimitMap = new Map<string, { count: number; resetAt: number }>();

app.use("/api/shared/*/verify", async (c, next) => {
  const ip = c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "unknown";
  const now = Date.now();
  const windowMs = 60000;
  const maxAttempts = 10;

  const entry = passwordRateLimitMap.get(ip);
  if (entry && entry.resetAt > now) {
    if (entry.count >= maxAttempts) {
      return c.json({ error: "密码验证过于频繁，请1分钟后重试" }, 429);
    }
    entry.count++;
  } else {
    passwordRateLimitMap.set(ip, { count: 1, resetAt: now + windowMs });
  }

  await next();
});

app.route("/api/shared", sharedRouter);

// 健康检查（无需 JWT）
app.get("/api/health", (c) => c.json({ status: "ok", version: "1.0.0" }));

// OpenAPI 规范（无需 JWT）
app.get("/api/openapi.json", (c) => c.json(generateOpenAPISpec()));

// 站点设置（GET 无需 JWT，允许未登录时加载品牌信息）
app.get("/api/settings", (c) => {
  const db = getDb();
  const rows = db.prepare("SELECT key, value FROM system_settings WHERE key LIKE 'site_%' OR key LIKE 'editor_%'").all() as { key: string; value: string }[];
  const result: Record<string, string> = { site_title: "nowen-note", site_favicon: "", editor_font_family: "" };
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return c.json(result);
});

// 字体文件下载 & 字体列表（无需 JWT，@font-face 浏览器请求不带 Authorization）
app.get("/api/fonts", (c) => {
  const db = getDb();
  const rows = db.prepare(
    "SELECT id, name, fileName, format, createdAt FROM custom_fonts ORDER BY createdAt DESC"
  ).all();
  return c.json(rows);
});
app.get("/api/fonts/file/:id", (c) => {
  const id = c.req.param("id");
  const db = getDb();
  const row = db.prepare("SELECT id, fileName, format FROM custom_fonts WHERE id = ?").get(id) as any;
  if (!row) return c.json({ error: "字体不存在" }, 404);

  const fontsDir = path.join(process.env.ELECTRON_USER_DATA || path.join(process.cwd(), "data"), "fonts");
  const filePath = path.join(fontsDir, `${row.id}.${row.format}`);
  if (!fs.existsSync(filePath)) return c.json({ error: "字体文件丢失" }, 404);

  const mimeMap: Record<string, string> = {
    otf: "font/otf", ttf: "font/ttf", otc: "font/collection",
    ttc: "font/collection", woff: "font/woff", woff2: "font/woff2",
  };
  const buffer = fs.readFileSync(filePath);
  return new Response(buffer, {
    headers: {
      "Content-Type": mimeMap[row.format] || "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
});

// JWT 鉴权中间件：保护所有 /api/* 路由（auth 和 health 已在上方注册，不受影响）
app.use("/api/*", async (c, next) => {
  const authHeader = c.req.header("Authorization");

  if (authHeader && authHeader.startsWith("Bearer ")) {
    try {
      const token = authHeader.slice(7);
      const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; username: string };
      c.req.raw.headers.set("X-User-Id", decoded.userId);
    } catch {
      return c.json({ error: "Token 无效或已过期" }, 401);
    }
  } else {
    return c.json({ error: "未授权，请先登录" }, 401);
  }

  await next();
});

// API 路由（受 JWT 保护）
app.route("/api/notebooks", notebooksRouter);
app.route("/api/notes", notesRouter);
app.route("/api/tags", tagsRouter);
app.route("/api/search", searchRouter);
app.route("/api/tasks", tasksRouter);
app.route("/api/export", exportRouter);
app.route("/api/micloud", micloudRouter);
app.route("/api/oppocloud", oppoCloudRouter);
app.route("/api/icloud", icloudRouter);
app.route("/api/mindmaps", mindmapsRouter);
app.route("/api/diary", diaryRouter);
app.route("/api/ai", aiRouter);
app.route("/api/pipelines", pipelinesRouter);
app.route("/api/plugins", pluginsRouter);
app.route("/api/webhooks", webhooksRouter);
app.route("/api/audit", auditRouter);
app.route("/api/backups", backupsRouter);
app.route("/api/shares", sharesRouter);

app.route("/api/settings", settingsRouter);
app.route("/api/fonts", fontsRouter);

// 获取当前登录用户信息
app.get("/api/me", (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id");
  const user = db.prepare("SELECT id, username, email, avatarUrl, createdAt FROM users WHERE id = ?").get(userId);
  return c.json(user);
});

const port = Number(process.env.PORT) || 3001;

// 生产模式：服务前端静态文件
if (process.env.NODE_ENV === "production") {
  const frontendDist = process.env.FRONTEND_DIST || path.resolve(process.cwd(), "frontend/dist");
  console.log("[Static] Serving frontend from:", frontendDist);

  // MIME 类型映射
  const mimeTypes: Record<string, string> = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".eot": "application/vnd.ms-fontobject",
    ".webp": "image/webp",
    ".map": "application/json",
  };

  // 静态资源 + SPA fallback（排除 /api 路径）
  app.get("*", (c) => {
    if (c.req.path.startsWith("/api")) {
      return c.json({ error: "Not Found" }, 404);
    }
    // 尝试提供静态文件
    const reqPath = c.req.path === "/" ? "/index.html" : c.req.path;
    const filePath = path.join(frontendDist, reqPath);
    // 安全检查：防止路径遍历
    if (!filePath.startsWith(frontendDist)) {
      return c.json({ error: "Forbidden" }, 403);
    }
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const contentType = mimeTypes[ext] || "application/octet-stream";
      const content = fs.readFileSync(filePath);
      return c.body(content, 200, { "Content-Type": contentType });
    }
    // SPA fallback：返回 index.html
    const indexPath = path.join(frontendDist, "index.html");
    if (fs.existsSync(indexPath)) {
      return c.html(fs.readFileSync(indexPath, "utf-8"));
    }
    return c.json({ error: "Not Found" }, 404);
  });
}

// 启动自动备份（每24小时）
try {
  getBackupManager().startAutoBackup(24);
} catch { /* 备份启动失败不阻塞服务 */ }

console.log(`🚀 nowen-note API running on http://localhost:${port}`);
console.log(`📖 OpenAPI 文档: http://localhost:${port}/api/openapi.json`);
serve({ fetch: app.fetch, port });
