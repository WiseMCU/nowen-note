import JSZip from "jszip";
import { saveAs } from "file-saver";
import TurndownService from "turndown";
import i18n from "i18next";
import { generateHTML } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import Underline from "@tiptap/extension-underline";
import Highlight from "@tiptap/extension-highlight";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Table, TableRow, TableHeader, TableCell } from "@tiptap/extension-table";
import { common, createLowlight } from "lowlight";
import { api } from "./api";

// TipTap 扩展列表（需与 importService / 编辑器保持一致，否则某些节点会被吞掉）
const lowlight = createLowlight(common);
const tiptapExtensions = [
  StarterKit.configure({
    codeBlock: false,
    heading: { levels: [1, 2, 3] },
  }),
  Image.configure({ inline: false, allowBase64: true }),
  CodeBlockLowlight.configure({ lowlight }),
  Underline,
  Highlight.configure({ multicolor: true }),
  TaskList,
  TaskItem.configure({ nested: true }),
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader,
  TableCell,
];

/**
 * 把 note.content 规范化为 HTML。
 * - Tiptap JSON：用 generateHTML 渲染，确保 <pre><code class="language-xxx"> 结构被 turndown
 *   识别为 fenced code block（否则代码块内的 # 注释再次导入会被当成 Markdown 标题）。
 * - 已经是 HTML：原样返回。
 * - 纯文本或解析失败：回退到 contentText / content。
 */
function noteContentToHtml(rawContent: string, contentText: string): string {
  const src = rawContent || "";
  if (!src) return contentText || "";

  const trimmed = src.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(src);
      // 仅当看起来是 Tiptap doc 时才走 generateHTML
      if (parsed && typeof parsed === "object" && (parsed.type === "doc" || Array.isArray(parsed.content))) {
        return generateHTML(parsed, tiptapExtensions);
      }
    } catch {
      /* fallthrough */
    }
    return contentText || "";
  }
  return src;
}

interface ExportNote {
  id: string;
  title: string;
  content: string;
  contentText: string;
  notebookName: string | null;
  createdAt: string;
  updatedAt: string;
}

// 清理文件名中的非法字符
function sanitizeFilename(name: string): string {
  return name.replace(/[\/\\?<>:*|"]/g, "_").replace(/\s+/g, " ").trim() || i18n.t('common.untitledNote');
}

// ============================================================================
// 图片抽取：把 HTML 里的 data: 内联图片拆成独立文件，替换为相对路径 ./assets/xxx
// 用于 zip 导出，生成可被 Typora / Obsidian / VSCode 正常预览的 Markdown
// ============================================================================

// MIME -> 扩展名
const MIME_EXT_MAP: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
  "image/x-icon": "ico",
};

function mimeToExt(mime: string): string {
  return MIME_EXT_MAP[mime.toLowerCase()] || "bin";
}

/** 浏览器端 SHA-1 摘要，返回十六进制字符串（只用前 N 位作文件名） */
async function sha1Hex(input: string): Promise<string> {
  // 为减少计算量，只取 base64 的前 2KB 作散列材料（已足够区分不同图片）
  const material = input.length > 2048 ? input.slice(0, 2048) + ":" + input.length : input;
  const bytes = new TextEncoder().encode(material);
  const digest = await crypto.subtle.digest("SHA-1", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * 解析 HTML 中所有 <img src="data:image/...;base64,...">：
 * - 抽出 base64 payload，按 SHA-1 前 10 位去重命名；
 * - 把 src 就地替换成 `./assets/<hash>.<ext>`；
 * - 收集 (相对路径 -> base64) 映射供外部写入 zip。
 *
 * 返回替换后的 HTML 以及图片清单。若 html 里没有 data:image，则不修改。
 * 对外链 http(s) 图片保持原样，不下载。
 */
export interface ExtractedImage {
  /** zip 内的相对路径，例如 "assets/abc123.png" */
  relPath: string;
  /** base64 字符串（不含 data: 前缀） */
  base64: string;
}

async function extractDataImages(
  html: string,
  registry: Map<string, string> // 全局 hash -> relPath，用于跨笔记去重
): Promise<{ html: string; images: ExtractedImage[] }> {
  // 仅在包含 data:image 时才进入解析分支，避免无谓开销
  if (!html || !/src=["']data:image\//i.test(html)) {
    return { html, images: [] };
  }

  const images: ExtractedImage[] = [];
  // 匹配 <img ... src="data:image/xxx;base64,YYY" ...>
  // 注意 src 可能是双引号或单引号
  const imgRe = /<img\b([^>]*?)\bsrc\s*=\s*(["'])data:(image\/[a-zA-Z0-9.+-]+);base64,([^"']+)\2([^>]*)>/gi;

  const replacements: Array<{ match: string; replacement: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(html)) !== null) {
    const fullMatch = m[0];
    const beforeSrc = m[1] || "";
    const quote = m[2];
    const mime = m[3];
    const base64 = m[4];
    const afterSrc = m[5] || "";

    let relPath: string;
    try {
      const hash = (await sha1Hex(base64)).slice(0, 10);
      const ext = mimeToExt(mime);
      // 同一图片在多个笔记 / 多处出现时复用同一个文件名
      const cached = registry.get(hash);
      if (cached) {
        relPath = cached;
      } else {
        relPath = `assets/${hash}.${ext}`;
        registry.set(hash, relPath);
        images.push({ relPath, base64 });
      }
    } catch {
      // 散列失败时跳过，保持原 data URI
      continue;
    }

    const newSrc = `./${relPath}`;
    const rebuilt = `<img${beforeSrc} src=${quote}${newSrc}${quote}${afterSrc}>`;
    replacements.push({ match: fullMatch, replacement: rebuilt });
  }

  // 统一做一次替换。因为不同 <img> 可能有完全相同的 src（data URI 一致），
  // 直接用 String.replace(match, replacement) 也 OK，但走一个索引替换更稳。
  let out = html;
  for (const { match, replacement } of replacements) {
    // 只替换第一次出现：重复 data URI 会产生重复 match 条目，逐个替换能一一对应
    const idx = out.indexOf(match);
    if (idx >= 0) {
      out = out.slice(0, idx) + replacement + out.slice(idx + match.length);
    }
  }

  return { html: out, images };
}

// ============================================================================

// 初始化 Turndown (HTML → Markdown)
function createTurndown(): TurndownService {
  const td = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
  });

  // 自定义 task list 转换
  td.addRule("taskListItem", {
    filter: (node) => {
      return (
        node.nodeName === "LI" &&
        node.getAttribute("data-type") === "taskItem"
      );
    },
    replacement: (content, node) => {
      const checked = (node as Element).getAttribute("data-checked") === "true";
      const cleanContent = content.replace(/^\n+/, "").replace(/\n+$/, "");
      return `${checked ? "- [x]" : "- [ ]"} ${cleanContent}\n`;
    },
  });

  // 高亮文本
  td.addRule("highlight", {
    filter: "mark",
    replacement: (content) => `==${content}==`,
  });

  return td;
}

export type ExportProgress = {
  phase: "fetching" | "converting" | "packing" | "done" | "error";
  current: number;
  total: number;
  message: string;
};

export async function exportAllNotes(
  onProgress?: (p: ExportProgress) => void,
  options?: {
    /**
     * 图片处理策略：
     * - false（默认）：把 <img src="data:..."> 抽成独立文件放到 `<笔记本>/assets/`，
     *                  md 里用相对路径 `./assets/xxx.png`，生成的 zip 在 Typora/Obsidian
     *                  等编辑器里可直接预览，md 文件体积小、可读性好。
     * - true：保留图片 base64 内嵌（单文件自包含，但 md 巨大、长行）。
     */
    inlineImages?: boolean;
  }
): Promise<boolean> {
  const inlineImages = !!options?.inlineImages;
  try {
    // 1. 获取所有笔记
    onProgress?.({ phase: "fetching", current: 0, total: 0, message: i18n.t('export.fetchingData') });
    const notes = await api.getExportNotes() as ExportNote[];

    if (!notes || notes.length === 0) {
      onProgress?.({ phase: "error", current: 0, total: 0, message: i18n.t('export.noNotesToExport') });
      return false;
    }

    const total = notes.length;
    const zip = new JSZip();
    const td = createTurndown();

    // 2. 转换并打包
    const folderCounts = new Map<string, number>();
    // 每个笔记本目录独立的 hash->相对路径 注册表，保证 md 中 ./assets/xxx 一定存在于同级目录
    const perFolderRegistry = new Map<string, Map<string, string>>();
    // 已写入 zip 的图片相对路径，避免重复写
    const writtenImages = new Set<string>();

    for (let i = 0; i < notes.length; i++) {
      const note = notes[i];
      onProgress?.({ phase: "converting", current: i + 1, total, message: i18n.t('export.converting', { title: note.title }) });

      // 解析 content → HTML（Tiptap JSON 会被渲染成真正的 <pre><code>，避免代码块内 # 被误判为标题）
      let html = noteContentToHtml(note.content, note.contentText);

      // 先定下该笔记的所在笔记本目录（图片抽取需要按目录注册）
      const folder = note.notebookName ? sanitizeFilename(note.notebookName) : i18n.t('export.uncategorized');

      // —— 图片抽取：默认把 data:image 拆到 <folder>/assets/ ——
      let extractedImages: ExtractedImage[] = [];
      if (!inlineImages && html) {
        let registry = perFolderRegistry.get(folder);
        if (!registry) {
          registry = new Map();
          perFolderRegistry.set(folder, registry);
        }
        const r = await extractDataImages(html, registry);
        html = r.html;
        extractedImages = r.images;
      }

      // 转换为 Markdown
      const markdown = html ? td.turndown(html) : "";

      // 添加 YAML frontmatter
      const frontmatter = [
        "---",
        `title: "${note.title.replace(/"/g, '\\"')}"`,
        `created: ${note.createdAt}`,
        `updated: ${note.updatedAt}`,
        "---",
        "",
      ].join("\n");

      const fullContent = frontmatter + markdown;

      // 确定文件路径（folder 在抽图前已计算）
      const count = folderCounts.get(folder) || 0;
      folderCounts.set(folder, count + 1);

      let fileName = sanitizeFilename(note.title);
      // 避免同名文件冲突
      const testPath = `${folder}/${fileName}.md`;
      if (zip.file(testPath)) {
        fileName = `${fileName}_${count + 1}`;
      }

      zip.file(`${folder}/${fileName}.md`, fullContent);

      // 把本笔记抽出的图片写入 zip（同一 hash 在同目录只写一次）
      for (const img of extractedImages) {
        const fullPath = `${folder}/${img.relPath}`;
        if (writtenImages.has(fullPath)) continue;
        writtenImages.add(fullPath);
        zip.file(fullPath, img.base64, { base64: true });
      }
    }

    // 3. 添加元数据
    zip.file(
      "metadata.json",
      JSON.stringify({
        version: "1.0",
        app: "nowen-note",
        exportedAt: new Date().toISOString(),
        totalNotes: total,
        notebooks: Array.from(folderCounts.entries()).map(([name, count]) => ({ name, count })),
      }, null, 2)
    );

    // 4. 生成 ZIP
    onProgress?.({ phase: "packing", current: total, total, message: i18n.t('export.generatingZip') });
    const blob = await zip.generateAsync(
      {
        type: "blob",
        compression: "DEFLATE",
        compressionOptions: { level: 6 },
      },
      (meta) => {
        onProgress?.({
          phase: "packing",
          current: Math.round(meta.percent),
          total: 100,
          message: i18n.t('export.compressing', { percent: Math.round(meta.percent) }),
        });
      }
    );

    // 5. 触发下载
    const date = new Date().toISOString().slice(0, 10);
    saveAs(blob, `nowen-note_backup_${date}.zip`);

    onProgress?.({ phase: "done", current: total, total, message: i18n.t('export.exportComplete') });
    return true;
  } catch (error) {
    console.error("导出失败:", error);
    onProgress?.({ phase: "error", current: 0, total: 0, message: i18n.t('export.exportFailed', { error: (error as Error).message }) });
    return false;
  }
}

// 单篇导出：
// - 若笔记含 data:image 内嵌图，默认打成 zip（md + assets/）；
// - 否则仅下载 .md；
// - 通过 options.inlineImages = true 可强制内嵌（始终下载 .md）。
export async function exportSingleNote(
  noteId: string,
  options?: { inlineImages?: boolean }
): Promise<boolean> {
  const inlineImages = !!options?.inlineImages;
  try {
    const note = await api.getNote(noteId);
    const td = createTurndown();

    // 解析 content → HTML（Tiptap JSON 会被渲染成真正的 <pre><code>）
    let html = noteContentToHtml(note.content, note.contentText);

    // 抽图（仅在非 inline 且含 data:image 时）
    const registry = new Map<string, string>();
    let extractedImages: ExtractedImage[] = [];
    if (!inlineImages && html) {
      const r = await extractDataImages(html, registry);
      html = r.html;
      extractedImages = r.images;
    }

    const markdown = html ? td.turndown(html) : "";

    const frontmatter = [
      "---",
      `title: "${note.title.replace(/"/g, '\\"')}"`,
      `created: ${note.createdAt}`,
      `updated: ${note.updatedAt}`,
      "---",
      "",
    ].join("\n");

    const fullContent = frontmatter + markdown;
    const safeTitle = sanitizeFilename(note.title);

    if (extractedImages.length > 0) {
      // 打成 zip：根目录放 md + assets/
      const zip = new JSZip();
      zip.file(`${safeTitle}.md`, fullContent);
      for (const img of extractedImages) {
        zip.file(img.relPath, img.base64, { base64: true });
      }
      const blob = await zip.generateAsync({
        type: "blob",
        compression: "DEFLATE",
        compressionOptions: { level: 6 },
      });
      saveAs(blob, `${safeTitle}.zip`);
    } else {
      const blob = new Blob([fullContent], { type: "text/markdown;charset=utf-8" });
      saveAs(blob, `${safeTitle}.md`);
    }
    return true;
  } catch (error) {
    console.error("导出失败:", error);
    return false;
  }
}
