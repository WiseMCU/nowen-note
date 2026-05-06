#!/usr/bin/env node
/**
 * 把 public/ 目录下的 manifest.json、icons、静态 HTML 引用的资源
 * 复制到 dist/，保证装载到浏览器时路径一致。
 *
 * 浏览器目标：
 *   - 默认（无参数 / --browser=chrome）：使用 public/manifest.json
 *   - --browser=firefox：使用 public/manifest.firefox.json，
 *     拷贝到 dist/manifest.json；不再保留多份 manifest，避免商店审核混淆。
 *
 * 走这条单 manifest 路线（而不是同时输出两份 manifest）的原因：
 *   浏览器扩展打包工具（web-ext / chrome.zip）只识别根目录下的 manifest.json，
 *   多余的 manifest.firefox.json 在 Chrome Webstore 校验时会触发"unknown manifest field"
 *   误报。所以构建期就一锤定音。
 */
import { existsSync, mkdirSync, readdirSync, statSync, copyFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const srcDir = join(root, "public");
const dstDir = join(root, "dist");

// 解析 --browser=xxx 参数
const browserArg = process.argv.find((a) => a.startsWith("--browser="));
const browser = browserArg ? browserArg.slice("--browser=".length) : "chrome";
if (!["chrome", "firefox"].includes(browser)) {
  console.error(`[copy-public] 未知的 --browser=${browser}，只支持 chrome | firefox`);
  process.exit(1);
}

if (!existsSync(srcDir)) {
  console.warn("[copy-public] public/ 不存在，跳过");
  process.exit(0);
}
if (!existsSync(dstDir)) mkdirSync(dstDir, { recursive: true });

// 1. 拷贝除 manifest*.json 之外的所有静态资源（图标 / 共享文件）。
//    manifest 由后续步骤按 browser 选择性拷贝，避免 dist 里同时存在两份导致混淆。
function walk(from, to) {
  for (const entry of readdirSync(from)) {
    if (/^manifest(\..+)?\.json$/i.test(entry)) continue;
    const src = join(from, entry);
    const dst = join(to, entry);
    const st = statSync(src);
    if (st.isDirectory()) {
      if (!existsSync(dst)) mkdirSync(dst, { recursive: true });
      walk(src, dst);
    } else {
      copyFileSync(src, dst);
    }
  }
}
walk(srcDir, dstDir);

// 2. 按目标浏览器选择 manifest 源文件，统一落到 dist/manifest.json。
const manifestSrc =
  browser === "firefox"
    ? join(srcDir, "manifest.firefox.json")
    : join(srcDir, "manifest.json");
if (!existsSync(manifestSrc)) {
  console.error(`[copy-public] 缺少 ${manifestSrc}`);
  process.exit(1);
}
copyFileSync(manifestSrc, join(dstDir, "manifest.json"));

// 3. 顺手清掉历史构建可能残留的 manifest.firefox.json。
const stale = join(dstDir, "manifest.firefox.json");
if (existsSync(stale)) rmSync(stale);

// vite 把 HTML entry 输出到 dist/src/popup/index.html 这种位置。
// 我们希望 manifest 里的 popup/index.html 指向 dist/popup/index.html。
// 这一步由 vite 的 input 配置 + output.assetFileNames 控制，不在这里处理。

console.log(`[copy-public] 已复制 public/ → dist/（target=${browser}）`);
