import { api } from "./api";
import i18n from "i18next";
import { generateJSON } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import Underline from "@tiptap/extension-underline";
import Highlight from "@tiptap/extension-highlight";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Table, TableRow, TableHeader, TableCell } from "@tiptap/extension-table";
import { common, createLowlight } from "lowlight";

const lowlight = createLowlight(common);

// TipTap 扩展列表（与编辑器保持一致）
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

export interface ImportFileInfo {
  name: string;
  title: string;
  content: string;
  size: number;
  selected: boolean;
  source?: string; // 来源标识: "md" | "txt" | "html" | "xiaomi" | "oppo" | "vivo" | "oneplus"
  notebookName?: string; // （已废弃，仅为向后兼容）从路径/目录推导出的单层笔记本名
  notebookPath?: string[]; // 笔记本层级路径（从根到子），如 ["我是文章2", "test2", "新笔记本"]
  imageMap?: Record<string, string>; // 相对路径 -> base64 data URI（zip 内的图片资源）
}

// 导入选项
export interface ImportOptions {
  /**
   * 是否"为每个文件创建以文件名命名的外层笔记本"
   * - true:  每个文件 → 建/找一个同名笔记本（清洗后的文件名）
   * - false: 保持原逻辑（zip 目录派生；散文件归到"导入的笔记"或用户选的笔记本）
   */
  perFileNotebook?: boolean;
  /**
   * 当 perFileNotebook=true 时，同名笔记本的处理策略
   * - "merge":  同名合并到同一笔记本（默认；依赖后端按名复用）
   * - "unique": 在本批次内自动编号 ("name", "name (2)", "name (3)"...)
   */
  duplicateStrategy?: "merge" | "unique";
  /** perFileNotebook 启用时，清洗后为空的回退名 */
  fallbackNotebookName?: string;
}

export type ImportProgress = {
  phase: "reading" | "uploading" | "done" | "error";
  current: number;
  total: number;
  message: string;
};

// 支持的文件扩展名
const SUPPORTED_EXTENSIONS = [".md", ".txt", ".markdown", ".html", ".htm"];

function isSupportedFile(name: string): boolean {
  return SUPPORTED_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext));
}

// 笔记本名的最大长度（超出会被截断），与后端 notebooks.name 字段兼容
const MAX_NOTEBOOK_NAME_LENGTH = 60;
// 默认笔记本名（清洗后为空时的回退）
const DEFAULT_FALLBACK_NOTEBOOK_NAME = "导入的笔记";

/**
 * 从文件名派生出一个合法的笔记本名
 * 处理：
 * 1. 去掉已知的笔记扩展名（.md/.txt/.markdown/.html/.htm）
 * 2. 路径分隔符仅保留最后一段（兼容 webkitRelativePath）
 * 3. 剥离 Windows/跨平台非法字符（<>:"/\|?*）和控制字符
 * 4. 合并多余空白、裁剪首尾空白和点号
 * 5. 长度超限则按视觉字符截断
 * 6. 为空时返回 null（调用方决定回退）
 */
export function deriveNotebookNameFromFile(fileName: string): string | null {
  if (!fileName || typeof fileName !== "string") return null;

  // 只取最后一段（例如 webkitRelativePath: "folder/a.md" -> "a.md"）
  const base = fileName.split(/[\\/]+/).pop() || fileName;

  // 去掉支持的扩展名
  let name = base;
  for (const ext of SUPPORTED_EXTENSIONS) {
    if (name.toLowerCase().endsWith(ext)) {
      name = name.slice(0, -ext.length);
      break;
    }
  }

  // 剥离控制字符 + 跨平台非法字符
  // eslint-disable-next-line no-control-regex
  name = name.replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, " ");

  // 合并空白 & 去首尾 .、空格（Windows 不允许以点号或空格结尾）
  name = name.replace(/\s+/g, " ").replace(/^[\s.]+|[\s.]+$/g, "");

  if (!name) return null;

  // 长度裁剪（按 code point 计，避免截断到代理对中间）
  if ([...name].length > MAX_NOTEBOOK_NAME_LENGTH) {
    name = [...name].slice(0, MAX_NOTEBOOK_NAME_LENGTH).join("").trim();
  }

  return name || null;
}

/**
 * 在批次内对同名笔记本自动编号：name -> name, name (2), name (3) ...
 * 保持与 `getOrCreateNotebookByName` 幂等性兼容（后端按完整名字找/建）
 */
function uniquifyNotebookName(name: string, used: Map<string, number>): string {
  const count = used.get(name) || 0;
  used.set(name, count + 1);
  if (count === 0) return name;
  return `${name} (${count + 1})`;
}

function isHtmlFile(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith(".html") || lower.endsWith(".htm");
}

// 检测 HTML 内容来源（手机品牌）
function detectHtmlSource(html: string, fileName: string): string {
  const lower = html.toLowerCase();
  if (lower.includes("mi note") || lower.includes("小米笔记") || lower.includes("miui") || lower.includes("xiaomi")) return "xiaomi";
  if (lower.includes("coloros") || lower.includes("oppo") || lower.includes("oplus")) return "oppo";
  if (lower.includes("vivo") || lower.includes("funtouch") || lower.includes("originos")) return "vivo";
  if (lower.includes("oneplus") || lower.includes("一加") || lower.includes("h2os") || lower.includes("oxygenos")) return "oneplus";
  if (isHtmlFile(fileName)) return "html";
  return "md";
}

// 清理 HTML 内容：去除多余标签、样式、脚本，保留核心内容
function cleanHtmlContent(html: string): string {
  let content = html;

  // 移除 script 和 style 标签及其内容
  content = content.replace(/<script[\s\S]*?<\/script>/gi, "");
  content = content.replace(/<style[\s\S]*?<\/style>/gi, "");

  // 移除 HTML 注释
  content = content.replace(/<!--[\s\S]*?-->/g, "");

  // 移除 head 部分
  content = content.replace(/<head[\s\S]*?<\/head>/gi, "");

  // 提取 body 内容（如果有）
  const bodyMatch = content.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) {
    content = bodyMatch[1];
  }

  // 移除所有内联样式属性
  content = content.replace(/\s+style="[^"]*"/gi, "");
  content = content.replace(/\s+class="[^"]*"/gi, "");
  content = content.replace(/\s+id="[^"]*"/gi, "");

  // 移除 data-* 属性（保留 tiptap 需要的）
  content = content.replace(/\s+data-(?!type|checked)[a-z-]+="[^"]*"/gi, "");

  // 移除空的 span/div 标签
  content = content.replace(/<span[^>]*>\s*<\/span>/gi, "");
  content = content.replace(/<div[^>]*>\s*<\/div>/gi, "");

  // 将 div 转为 p（常见于手机笔记）
  content = content.replace(/<div[^>]*>/gi, "<p>");
  content = content.replace(/<\/div>/gi, "</p>");

  // 将 br 转为段落分隔
  content = content.replace(/<br\s*\/?>\s*<br\s*\/?>/gi, "</p><p>");
  content = content.replace(/<br\s*\/?>/gi, "</p><p>");

  // 清理嵌套的空 p 标签
  content = content.replace(/<p>\s*<\/p>/gi, "");

  // 去除前后空白
  content = content.trim();

  // 如果清理后没有任何 HTML 标签，包裹在 p 中
  if (!content.match(/<[a-z]/i)) {
    content = content
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => `<p>${line.trim()}</p>`)
      .join("\n");
  }

  return content;
}

// 从 HTML 中提取标题
function extractTitleFromHtml(html: string, fallbackTitle: string): string {
  // 尝试从 <title> 标签提取
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch && titleMatch[1].trim()) {
    return titleMatch[1].trim();
  }
  // 尝试从第一个 h1/h2 提取
  const headingMatch = html.match(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/i);
  if (headingMatch && headingMatch[1].trim()) {
    return headingMatch[1].replace(/<[^>]+>/g, "").trim();
  }
  return fallbackTitle;
}

// 读取拖入的文件列表
//
// 增强：
// 1. 同批次内的图片文件（png/jpg/gif/webp/svg/bmp/ico）会被读取为 base64 data URI，
//    构建一个 imageMap 并附加到每个 md/txt/html 笔记上。
//    这样用户"同时选中 md + 相对路径下的图片"即可恢复图片引用，不必先打成 zip。
// 2. 若 File 带有 webkitRelativePath（来自 <input webkitdirectory> 或拖拽目录），
//    会同时按相对路径与文件名建立两条索引，提高命中率。
export async function readMarkdownFiles(
  files: FileList | File[]
): Promise<ImportFileInfo[]> {
  const result: ImportFileInfo[] = [];
  const fileArray = Array.from(files);

  // —— 第一轮：扫描所有图片文件，构建 imageMap ——
  const imageMap: Record<string, string> = {};
  for (const file of fileArray) {
    if (!isImageFile(file.name)) continue;
    try {
      // 读成 ArrayBuffer 再转 base64，避免 FileReader 的异步嵌套
      const buf = await file.arrayBuffer();
      const base64 = arrayBufferToBase64(buf);
      const mime = getImageMime(file.name);
      const dataUri = `data:${mime};base64,${base64}`;

      // 键：文件名（不含路径），以及 webkitRelativePath 提供的相对路径
      const relPath = (file as any).webkitRelativePath as string | undefined;
      if (relPath) {
        imageMap[relPath] = dataUri;
        // 去掉顶层目录后的路径（与 md 里 `./images/a.png` 这种更接近）
        const parts = relPath.split("/");
        if (parts.length > 1) {
          imageMap[parts.slice(1).join("/")] = dataUri;
        }
      }
      if (!imageMap[file.name]) {
        imageMap[file.name] = dataUri;
      }
    } catch (err) {
      console.warn("读取本地图片失败:", file.name, err);
    }
  }
  const hasImages = Object.keys(imageMap).length > 0;

  // —— 第二轮：读取笔记文件 ——
  for (const file of fileArray) {
    if (!isSupportedFile(file.name)) continue;

    const text = await file.text();
    const fileNameTitle = file.name.replace(/\.(md|txt|markdown|html|htm)$/i, "");

    if (isHtmlFile(file.name)) {
      const source = detectHtmlSource(text, file.name);
      const title = extractTitleFromHtml(text, fileNameTitle);
      result.push({
        name: file.name,
        title,
        content: text,
        size: file.size,
        selected: true,
        source,
        imageMap: hasImages ? imageMap : undefined,
      });
    } else {
      result.push({
        name: file.name,
        title: fileNameTitle,
        content: text,
        size: file.size,
        selected: true,
        source: file.name.endsWith(".txt") ? "txt" : "md",
        imageMap: hasImages ? imageMap : undefined,
      });
    }
  }

  return result;
}

// 把 ArrayBuffer 编码成 base64（避免使用 FileReader 的链式回调）
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

// 图片扩展名 → MIME 类型
const IMAGE_MIME_MAP: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  ico: "image/x-icon",
};

function isImageFile(name: string): boolean {
  const lower = name.toLowerCase();
  const ext = lower.split(".").pop() || "";
  return ext in IMAGE_MIME_MAP;
}

function getImageMime(name: string): string {
  const ext = (name.toLowerCase().split(".").pop() || "") as string;
  return IMAGE_MIME_MAP[ext] || "application/octet-stream";
}

// 从 zip 内部路径推导笔记本名（取第一级目录名）
function deriveNotebookName(path: string): string | undefined {
  const parts = path.split("/").filter(Boolean);
  if (parts.length < 2) return undefined; // 文件位于根目录
  const first = parts[0];
  // 过滤常见的无意义目录
  if (first.startsWith(".") || first === "__MACOSX" || first.toLowerCase() === "assets" || first.toLowerCase() === "images") {
    return undefined;
  }
  return first;
}

// 清洗单个路径片段（目录名），规则与 deriveNotebookNameFromFile 一致但不去扩展名
function sanitizeSegment(segment: string): string | null {
  if (!segment) return null;
  let s = segment;
  // 剥离控制字符 + 跨平台非法字符
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, " ");
  // 合并空白 & 去首尾 .、空格
  s = s.replace(/\s+/g, " ").replace(/^[\s.]+|[\s.]+$/g, "");
  if (!s) return null;
  // 长度裁剪
  if ([...s].length > MAX_NOTEBOOK_NAME_LENGTH) {
    s = [...s].slice(0, MAX_NOTEBOOK_NAME_LENGTH).join("").trim();
  }
  return s || null;
}

/**
 * 从 zip 内部路径推导完整的笔记本层级路径。
 * 例如 path = "我是文章2/test2/新笔记本/note.md"
 *      -> ["我是文章2", "test2", "新笔记本"]
 * 返回的数组顺序为从根到叶。
 *
 * 过滤规则：
 * - 跳过 "__MACOSX"、以 "." 开头的隐藏目录
 * - 跳过 "assets" / "images" 等纯资源目录（仅当它们出现在中间或末端且不是唯一目录时）
 * - 每段经过 sanitizeSegment 清洗
 */
function deriveNotebookPath(path: string, outerFolderName?: string): string[] {
  const parts = path.split("/").filter(Boolean);
  // 最后一段是文件名，不算笔记本
  const dirParts = parts.slice(0, -1);

  const result: string[] = [];
  for (const raw of dirParts) {
    // 过滤无意义目录
    if (raw.startsWith(".") || raw === "__MACOSX") continue;
    const lower = raw.toLowerCase();
    if (lower === "assets" || lower === "images") continue;
    const cleaned = sanitizeSegment(raw);
    if (cleaned) result.push(cleaned);
  }

  // 如果提供了最外层文件夹名（zip 文件名派生），并且它还没作为第一段出现，则前置
  if (outerFolderName) {
    if (result.length === 0 || result[0] !== outerFolderName) {
      result.unshift(outerFolderName);
    }
  }

  return result;
}

// 从 ZIP 文件中读取笔记
export async function readMarkdownFromZip(file: File): Promise<ImportFileInfo[]> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(file);
  const result: ImportFileInfo[] = [];

  // 用 zip 文件名（去掉 .zip 扩展）作为最外层笔记本名，保证"导出前的顶层目录"在导入后依然存在
  const rawZipBase = (file.name || "archive.zip").replace(/\.zip$/i, "");
  const outerFolderName = sanitizeSegment(rawZipBase) || "导入的笔记";

  // 第一轮：扫描所有图片文件，构建路径 → base64 的映射
  const imageMap: Record<string, string> = {};
  for (const [path, zipEntry] of Object.entries(zip.files)) {
    if (zipEntry.dir) continue;
    if (path.includes("__MACOSX") || path.startsWith(".")) continue;
    if (!isImageFile(path)) continue;
    try {
      const base64 = await zipEntry.async("base64");
      const mime = getImageMime(path);
      const dataUri = `data:${mime};base64,${base64}`;
      // 同时用完整路径和文件名做 key，提升相对路径匹配命中率
      imageMap[path] = dataUri;
      const fileName = path.split("/").pop();
      if (fileName && !imageMap[fileName]) {
        imageMap[fileName] = dataUri;
      }
    } catch (err) {
      console.warn("读取 zip 图片失败:", path, err);
    }
  }

  // 第二轮：扫描笔记文件
  for (const [path, zipEntry] of Object.entries(zip.files)) {
    if (zipEntry.dir) continue;
    if (!isSupportedFile(path)) continue;
    if (path === "metadata.json") continue;
    // 跳过 macOS 资源文件
    if (path.includes("__MACOSX") || path.startsWith(".")) continue;

    const text = await zipEntry.async("text");
    const fileName = path.split("/").pop() || path;
    const fileNameTitle = fileName.replace(/\.(md|txt|markdown|html|htm)$/i, "");
    // 完整层级：zip 文件名（最外层） + zip 内部所有中间目录
    const notebookPath = deriveNotebookPath(path, outerFolderName);
    // notebookName 保留为末级目录名（向后兼容 & 日志用）
    const notebookName = notebookPath.length > 0 ? notebookPath[notebookPath.length - 1] : undefined;

    if (isHtmlFile(fileName)) {
      const source = detectHtmlSource(text, fileName);
      const title = extractTitleFromHtml(text, fileNameTitle);
      result.push({
        name: path,
        title,
        content: text,
        size: text.length,
        selected: true,
        source,
        notebookName,
        notebookPath,
        imageMap,
      });
    } else {
      result.push({
        name: path,
        title: fileNameTitle,
        content: text,
        size: text.length,
        selected: true,
        source: fileName.endsWith(".txt") ? "txt" : "md",
        notebookName,
        notebookPath,
        imageMap,
      });
    }
  }

  return result;
}

// 从 YAML frontmatter 中提取日期信息
function extractFrontmatterDates(md: string): { createdAt?: string; updatedAt?: string } {
  const fmMatch = md.match(/^---\n([\s\S]*?)\n---/m);
  if (!fmMatch) return {};

  const fm = fmMatch[1];
  let createdAt: string | undefined;
  let updatedAt: string | undefined;

  const createdMatch = fm.match(/^created:\s*(.+)$/m);
  if (createdMatch) createdAt = createdMatch[1].trim();

  const updatedMatch = fm.match(/^updated:\s*(.+)$/m);
  if (updatedMatch) updatedAt = updatedMatch[1].trim();

  return { createdAt, updatedAt };
}

// 将 Markdown 转为 HTML（用于存储到 Tiptap 格式）
export function markdownToSimpleHtml(md: string, imageMap?: Record<string, string>): string {
  // 去除 YAML frontmatter
  const content = md.replace(/^---[\s\S]*?---\n*/m, "");
  const lines = content.split("\n");
  const htmlParts: string[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // 空行 → 直接跳过，不产出 <p></p>
    // 之前的做法是每个空行生成一个空段落，但标准 Markdown 里空行是
    // "块级分隔符"（让段落/列表/代码块分块）而不是可见空行。
    // 生成空段落会导致：
    // 1) 列表项之间隔空行时被打断成多个 <ol>/<ul>（视觉上是多组"1."）；
    // 2) 列表与代码块、标题与段落之间出现多余的可见空白行。
    // 块级元素之间的天然间距交给 Tiptap 的 CSS 处理即可。
    if (!trimmed) {
      i++;
      continue;
    }

    // 代码块（``` 或 ~~~）
    const codeBlockMatch = trimmed.match(/^(`{3,}|~{3,})(\w*)/);
    if (codeBlockMatch) {
      const fence = codeBlockMatch[1];
      const lang = codeBlockMatch[2] || "";
      // 围栏行的前导缩进宽度（tab 记为 4 列）。
      // 用于剥除代码行中与围栏等量的前导空白，避免"列表项内嵌代码块"
      // （常见的 3/4 空格缩进）被原样塞进 <code>，产生看起来空格过多的缩进。
      const fenceLeading = line.match(/^[ \t]*/)?.[0] ?? "";
      let fenceIndent = 0;
      for (const ch of fenceLeading) fenceIndent += ch === "\t" ? 4 : 1;
      const codeLines: string[] = [];
      i++;
      while (i < lines.length) {
        if (lines[i].trim().startsWith(fence)) {
          i++;
          break;
        }
        // 安全剥除：最多去掉与围栏同量的前导空白，不误伤代码本身的缩进
        let raw = lines[i];
        if (fenceIndent > 0) {
          let stripped = 0;
          let k = 0;
          while (k < raw.length && stripped < fenceIndent) {
            const ch = raw[k];
            if (ch === " ") { stripped += 1; k += 1; }
            else if (ch === "\t") { stripped += 4; k += 1; }
            else break;
          }
          raw = raw.slice(k);
        }
        codeLines.push(
          raw
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
        );
        i++;
      }
      const langAttr = lang ? ` class="language-${lang}"` : "";
      htmlParts.push(`<pre><code${langAttr}>${codeLines.join("\n")}</code></pre>`);
      continue;
    }

    // 引用块（> ...）
    if (trimmed.startsWith(">")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ""));
        i++;
      }
      const quotedContent = quoteLines
        .join("\n")
        .split("\n")
        .map((l) => (l.trim() ? `<p>${inlineMarkdown(l, imageMap)}</p>` : ""))
        .filter(Boolean)
        .join("");
      htmlParts.push(`<blockquote>${quotedContent}</blockquote>`);
      continue;
    }

    // 水平线
    if (/^(---|\*\*\*|___)$/.test(trimmed)) {
      htmlParts.push("<hr />");
      i++;
      continue;
    }

    // 标题
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      htmlParts.push(`<h${level}>${inlineMarkdown(headingMatch[2], imageMap)}</h${level}>`);
      i++;
      continue;
    }

    // Markdown 表格（| col1 | col2 | ...）
    if (/^\|(.+)\|\s*$/.test(trimmed)) {
      const tableRows: string[][] = [];
      let hasHeader = false;
      while (i < lines.length && /^\|(.+)\|\s*$/.test(lines[i].trim())) {
        const row = lines[i].trim();
        // 检测分隔行 |---|---|---|
        if (/^\|[\s:]*-{2,}[\s:]*\|/.test(row)) {
          hasHeader = true;
          i++;
          continue;
        }
        const cells = row
          .replace(/^\|\s*/, "")
          .replace(/\s*\|$/, "")
          .split(/\s*\|\s*/);
        tableRows.push(cells);
        i++;
      }
      if (tableRows.length > 0) {
        let tableHtml = "<table>";
        tableRows.forEach((cells, idx) => {
          const isHead = hasHeader && idx === 0;
          const tag = isHead ? "th" : "td";
          const wrap = isHead ? "thead" : (idx === 1 && hasHeader ? "tbody" : "");
          if (wrap === "thead") tableHtml += "<thead>";
          if (wrap === "tbody") tableHtml += "<tbody>";
          tableHtml += "<tr>";
          cells.forEach((c) => {
            tableHtml += `<${tag}>${inlineMarkdown(c.trim(), imageMap)}</${tag}>`;
          });
          tableHtml += "</tr>";
          if (wrap === "thead") tableHtml += "</thead>";
        });
        if (hasHeader && tableRows.length > 1) tableHtml += "</tbody>";
        tableHtml += "</table>";
        htmlParts.push(tableHtml);
      }
      continue;
    }

    // 待办列表（- [x] / - [ ]）
    if (/^[-*]\s+\[[ xX]\]\s+/.test(trimmed)) {
      const taskItems: string[] = [];
      while (i < lines.length) {
        const cur = lines[i].trim();
        if (/^[-*]\s+\[[ xX]\]\s+/.test(cur)) {
          const taskMatch = cur.match(/^[-*]\s+\[([xX ])\]\s+(.+)$/);
          if (taskMatch) {
            const checked = taskMatch[1].toLowerCase() === "x";
            taskItems.push(
              `<li data-type="taskItem" data-checked="${checked}"><label><input type="checkbox" ${checked ? "checked" : ""}><span></span></label><div><p>${inlineMarkdown(taskMatch[2], imageMap)}</p></div></li>`
            );
          }
          i++;
          continue;
        }
        if (!cur) {
          let j = i + 1;
          while (j < lines.length && !lines[j].trim()) j++;
          if (j < lines.length && /^[-*]\s+\[[ xX]\]\s+/.test(lines[j].trim())) {
            i = j;
            continue;
          }
        }
        break;
      }
      htmlParts.push(`<ul data-type="taskList">${taskItems.join("")}</ul>`);
      continue;
    }

    // 无序列表（- / * / +）
    if (/^[-*+]\s+/.test(trimmed)) {
      const listItems: string[] = [];
      while (i < lines.length) {
        const cur = lines[i].trim();
        if (/^[-*+]\s+/.test(cur)) {
          const itemText = cur.replace(/^[-*+]\s+/, "");
          listItems.push(`<li><p>${inlineMarkdown(itemText, imageMap)}</p></li>`);
          i++;
          continue;
        }
        // 空行：前瞻，若下一个非空行仍是同类型列表项，则吞掉空行继续采集
        if (!cur) {
          let j = i + 1;
          while (j < lines.length && !lines[j].trim()) j++;
          if (j < lines.length && /^[-*+]\s+/.test(lines[j].trim())) {
            i = j;
            continue;
          }
        }
        break;
      }
      htmlParts.push(`<ul>${listItems.join("")}</ul>`);
      continue;
    }

    // 有序列表（1. / 2. ...）
    // 读取首项的真实数字作为 <ol start="N">，这样当原始 MD 里列表被
    // 代码块/段落打断（→ 进到不同的 <ol>）时，编号仍可延续
    // 例："1. A\n\n```代码```\n\n2. B"  → <ol>1</ol> ... <ol start="2">2</ol>
    if (/^\d+\.\s+/.test(trimmed)) {
      const firstNumMatch = trimmed.match(/^(\d+)\.\s+/);
      const startNum = firstNumMatch ? parseInt(firstNumMatch[1], 10) : 1;
      const listItems: string[] = [];
      while (i < lines.length) {
        const cur = lines[i].trim();
        if (/^\d+\.\s+/.test(cur)) {
          const itemText = cur.replace(/^\d+\.\s+/, "");
          listItems.push(`<li><p>${inlineMarkdown(itemText, imageMap)}</p></li>`);
          i++;
          continue;
        }
        if (!cur) {
          let j = i + 1;
          while (j < lines.length && !lines[j].trim()) j++;
          if (j < lines.length && /^\d+\.\s+/.test(lines[j].trim())) {
            i = j;
            continue;
          }
        }
        break;
      }
      const startAttr = startNum > 1 ? ` start="${startNum}"` : "";
      htmlParts.push(`<ol${startAttr}>${listItems.join("")}</ol>`);
      continue;
    }

    // 普通段落
    htmlParts.push(`<p>${inlineMarkdown(trimmed, imageMap)}</p>`);
    i++;
  }

  return htmlParts.join("\n");
}

// 在 imageMap 中查找图片路径对应的 data URI
function resolveImageSrc(src: string, imageMap?: Record<string, string>): string {
  if (!imageMap) return src;
  // 外链 / 绝对 URL / 已是 data URI，不处理
  if (/^(https?:|data:|\/\/)/i.test(src)) return src;

  // 去除查询参数和 hash
  const clean = src.split(/[?#]/)[0];
  // 直接命中
  if (imageMap[clean]) return imageMap[clean];
  // 规范化开头的 ./ 或 /
  const normalized = clean.replace(/^\.\//, "").replace(/^\//, "");
  if (imageMap[normalized]) return imageMap[normalized];
  // 仅用文件名匹配
  const base = normalized.split("/").pop();
  if (base && imageMap[base]) return imageMap[base];
  // 解码 URI（中文文件名在 md 中可能被 encode）
  try {
    const decoded = decodeURIComponent(normalized);
    if (imageMap[decoded]) return imageMap[decoded];
    const decodedBase = decoded.split("/").pop();
    if (decodedBase && imageMap[decodedBase]) return imageMap[decodedBase];
  } catch {
    /* ignore */
  }
  return src;
}

// 处理行内 Markdown 语法
function inlineMarkdown(text: string, imageMap?: Record<string, string>): string {
  return (
    text
      // 图片（必须在链接之前处理）
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt: string, src: string) => {
        const resolved = resolveImageSrc(src.trim(), imageMap);
        const escapedAlt = alt.replace(/"/g, "&quot;");
        return `<img src="${resolved}" alt="${escapedAlt}" />`;
      })
      // 链接
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
      // 粗斜体
      .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
      // 粗体
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      // 斜体
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      // 删除线
      .replace(/~~(.+?)~~/g, "<s>$1</s>")
      // 高亮
      .replace(/==(.+?)==/g, "<mark>$1</mark>")
      // 行内代码已废弃：剥离反引号，保留为纯文本（统一使用代码块）
      .replace(/`([^`]+)`/g, "$1")
  );
}

// 将纯文本转为 HTML
function textToHtml(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return "";
      // 转义 HTML 特殊字符
      const escaped = trimmed
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      return `<p>${escaped}</p>`;
    })
    .filter(Boolean)
    .join("\n");
}

// 根据来源转换内容为 TipTap JSON 字符串
function convertToTiptapJson(fileInfo: ImportFileInfo): string {
  const { content, source, imageMap } = fileInfo;

  let html: string;
  switch (source) {
    case "html":
    case "xiaomi":
    case "oppo":
    case "vivo":
    case "oneplus":
      html = cleanHtmlContent(content);
      break;
    case "txt":
      html = textToHtml(content);
      break;
    case "md":
    default:
      html = markdownToSimpleHtml(content, imageMap);
      break;
  }

  // 将 HTML 转为 TipTap JSON 格式（与编辑器保存格式一致）
  try {
    const json = generateJSON(html, tiptapExtensions);
    return JSON.stringify(json);
  } catch {
    // 转换失败时回退为 HTML 字符串（Tiptap 编辑器也能解析）
    return html;
  }
}

// 提取纯文本用于搜索索引
function extractPlainText(fileInfo: ImportFileInfo): string {
  const { content, source } = fileInfo;

  if (source === "html" || source === "xiaomi" || source === "oppo" || source === "vivo" || source === "oneplus") {
    return content
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, " ")
      .trim();
  }

  // Markdown / txt
  return content
    .replace(/^---[\s\S]*?---\n*/m, "")
    .replace(/[#*_~`\[\]()>|-]/g, "")
    .trim();
}

// 执行导入
export async function importNotes(
  fileInfos: ImportFileInfo[],
  notebookId?: string,
  onProgress?: (p: ImportProgress) => void,
  options?: ImportOptions
): Promise<{ success: boolean; count: number }> {
  const selected = fileInfos.filter((f) => f.selected);

  if (selected.length === 0) {
    onProgress?.({ phase: "error", current: 0, total: 0, message: i18n.t('dataManager.noFilesSelected') });
    return { success: false, count: 0 };
  }

  // 解析导入选项
  // 当用户明确选了目标笔记本（notebookId）时，perFileNotebook 被忽略（保持 UI 层互斥约定的最终保险）
  const perFileNotebook = !notebookId && !!options?.perFileNotebook;
  const duplicateStrategy = options?.duplicateStrategy ?? "merge";
  const fallbackNotebookName =
    (options?.fallbackNotebookName && options.fallbackNotebookName.trim()) ||
    DEFAULT_FALLBACK_NOTEBOOK_NAME;

  // 批次内"名字 -> 已出现次数"，用于 duplicateStrategy=unique 时自动编号
  const usedNotebookNames = new Map<string, number>();

  try {
    onProgress?.({ phase: "uploading", current: 0, total: selected.length, message: i18n.t('dataManager.uploadingProgress') });

    const notes = selected.map((f) => {
      const note: { title: string; content: string; contentText: string; createdAt?: string; updatedAt?: string; notebookName?: string; notebookPath?: string[] } = {
        title: f.title,
        content: convertToTiptapJson(f),
        contentText: extractPlainText(f),
      };
      // 对 Markdown 文件尝试提取 frontmatter 中的日期
      if (f.source === "md" || !f.source) {
        const dates = extractFrontmatterDates(f.content);
        if (dates.createdAt) note.createdAt = dates.createdAt;
        if (dates.updatedAt) note.updatedAt = dates.updatedAt;
      }

      // —— 决定该笔记的 notebookName / notebookPath ——
      // 优先级：perFileNotebook（覆盖式） > zip 路径派生 f.notebookPath > 扁平 f.notebookName > 无
      if (perFileNotebook) {
        // 从原始文件名派生；失败则回退到标题；仍失败则用 fallback
        const derived =
          deriveNotebookNameFromFile(f.name) ||
          deriveNotebookNameFromFile(f.title) ||
          fallbackNotebookName;
        const finalName =
          duplicateStrategy === "unique"
            ? uniquifyNotebookName(derived, usedNotebookNames)
            : derived;
        note.notebookName = finalName;
        // per-file 模式下视为单层路径
        note.notebookPath = [finalName];
      } else if (f.notebookPath && f.notebookPath.length > 0) {
        // zip 导入：透传完整层级路径，后端按层级逐级查找/创建
        note.notebookPath = f.notebookPath;
        note.notebookName = f.notebookPath[f.notebookPath.length - 1];
      } else if (f.notebookName) {
        // 向后兼容：没有 notebookPath 时仍透传单层名字
        note.notebookName = f.notebookName;
      }
      return note;
    });

    const result = await api.importNotes(notes, notebookId);

    onProgress?.({
      phase: "done",
      current: result.count,
      total: selected.length,
      message: i18n.t('dataManager.importSuccessCount', { count: result.count }),
    });

    return { success: true, count: result.count };
  } catch (error) {
    console.error("导入失败:", error);
    onProgress?.({
      phase: "error",
      current: 0,
      total: selected.length,
      message: i18n.t('dataManager.importFailed', { error: (error as Error).message }),
    });
    return { success: false, count: 0 };
  }
}
