/**
 * 文件管理中心（ViewMode=files）
 * ---------------------------------------------------------------------------
 * 定位：
 *   跨笔记的"相册 + 文件柜"。本页面**不新增存储**——直接消费后端
 *   /api/files 聚合视图，复用已有的 attachments 表 + ATTACHMENTS_DIR。
 *
 * 布局（与 DiaryCenter / TaskCenter 同构，沿用 flex 高度 + ScrollArea）：
 *   ┌── 顶栏：标题 / 统计徽标 / 上传按钮 / 视图切换 ──────────┐
 *   ├── 工具条：分类 Tabs / 搜索 / 排序 ─────────────────────┤
 *   ├── 主区：
 *   │    - 图片优先走 Grid（响应式 auto-fill minmax）
 *   │    - 文件 / 混合视图走紧凑列表（含 MIME 图标、大小、来源笔记）
 *   │   均支持：点击打开详情抽屉
 *   ├── 详情抽屉（右侧）：
 *   │    - 预览（图片直接 <img>、其他给下载链接）
 *   │    - 元信息（filename、mime、size、createdAt）
 *   │    - 引用列表（references[]，点"跳转"切回对应笔记）
 *   │    - 删除按钮（二次确认）
 *   └── 空态：区分"零文件"与"筛选无结果"，文案不同
 *
 * 反向跳转：
 *   点 "跳转到笔记" → api.getNote(id) → setActiveNote + setViewMode("all")；
 *   复用 AppContext，与 Sidebar / NoteList 的跳转路径一致。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Upload,
  X,
  Trash2,
  Search,
  LayoutGrid,
  List,
  Image as ImageIcon,
  FileText,
  FileArchive,
  FileCode,
  FileAudio,
  FileVideo,
  FileSpreadsheet,
  ExternalLink,
  Download,
  Loader2,
  Filter,
  ArrowUpDown,
  Inbox,
  Copy,
  Check,
} from "lucide-react";
import { api, resolveAttachmentUrl } from "@/lib/api";
import { FileItem, FileDetail, FileStats, FileSortKey, FileCategory } from "@/types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useApp, useAppActions } from "@/store/AppContext";
import { toast } from "@/lib/toast";

// ---------------------------------------------------------------------------
// 工具：文件大小可读化 / MIME → 图标 / 时间格式化
// ---------------------------------------------------------------------------

/** 把字节数转成 "1.23 MB" / "456 KB" 等可读字符串，与 DataManager 风格一致。 */
function humanSize(bytes: number): string {
  if (!bytes || bytes < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let idx = 0;
  let v = bytes;
  while (v >= 1024 && idx < units.length - 1) {
    v /= 1024;
    idx++;
  }
  return `${v.toFixed(v >= 10 || idx === 0 ? 0 : 2)} ${units[idx]}`;
}

/** 根据 MIME 返回一个合适的 lucide 图标（非图片场景）。 */
function mimeIcon(mime: string): React.ReactNode {
  const m = (mime || "").toLowerCase();
  if (m.startsWith("image/")) return <ImageIcon size={20} />;
  if (m.startsWith("audio/")) return <FileAudio size={20} />;
  if (m.startsWith("video/")) return <FileVideo size={20} />;
  if (m === "application/zip" || m === "application/x-rar-compressed" || m === "application/x-7z-compressed" || m === "application/gzip")
    return <FileArchive size={20} />;
  if (
    m === "application/vnd.ms-excel" ||
    m === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    m === "text/csv"
  )
    return <FileSpreadsheet size={20} />;
  if (
    m === "application/json" ||
    m === "text/javascript" ||
    m === "application/javascript" ||
    m === "text/x-python" ||
    m === "text/typescript" ||
    m === "text/html" ||
    m === "text/css"
  )
    return <FileCode size={20} />;
  return <FileText size={20} />;
}

/** 按本地时区格式化 "YYYY-MM-DD HH:mm"。createdAt 是 sqlite datetime('now')——UTC naive。 */
function formatLocalTime(s: string): string {
  if (!s) return "";
  // SQLite 的 datetime('now') 返回 "YYYY-MM-DD HH:mm:ss"（UTC，不带 Z），
  // 直接 new Date() 会当本地时间解析 → 本地显示就会晚 8h。显式拼 Z 再格式化。
  const iso = s.includes("T") ? s : s.replace(" ", "T") + "Z";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return s;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

type CategoryFilter = "all" | FileCategory;

const SORT_OPTIONS: Array<{ value: FileSortKey; label: string }> = [
  { value: "created_desc", label: "最新上传" },
  { value: "created_asc", label: "最早上传" },
  { value: "size_desc", label: "大小 ↓" },
  { value: "size_asc", label: "大小 ↑" },
  { value: "name_asc", label: "名称 A→Z" },
  { value: "name_desc", label: "名称 Z→A" },
];

const PAGE_SIZE = 60;

export default function FileManager() {
  const { state } = useApp();
  const actions = useAppActions();

  // 列表状态
  const [items, setItems] = useState<FileItem[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<FileStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  // 筛选 / 搜索
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [sort, setSort] = useState<FileSortKey>("created_desc");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState(""); // debounced

  // 视图模式：图片分类默认 grid；文件分类默认 list；"all" 跟随上次选择
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  // 详情抽屉
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<FileDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // 上传
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  // ---- 搜索防抖（300ms，避免每个字都打接口）----
  useEffect(() => {
    const h = setTimeout(() => {
      setSearchQuery(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(h);
  }, [searchInput]);

  // ---- 拉统计（只在挂载 + 上传/删除后刷新，成本较小）----
  const loadStats = useCallback(async () => {
    try {
      const s = await api.files.stats();
      setStats(s);
    } catch (err) {
      console.error("[FileManager] stats failed:", err);
    }
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  // ---- 拉列表（受 category / sort / searchQuery / page 驱动）----
  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.files.list({
        category: category === "all" ? undefined : category,
        q: searchQuery || undefined,
        sort,
        page,
        pageSize: PAGE_SIZE,
      });
      setItems(res.items);
      setTotal(res.total);
    } catch (err: any) {
      console.error("[FileManager] list failed:", err);
      toast.error(err?.message || "加载文件列表失败");
    } finally {
      setLoading(false);
    }
  }, [category, sort, searchQuery, page]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  // ---- 分类切换时重置到第 1 页 + 调整默认视图 ----
  const handleCategoryChange = useCallback((c: CategoryFilter) => {
    setCategory(c);
    setPage(1);
    // 切到"文件"分类时默认列表视图；"图片" / "全部"默认网格视图。
    // 用户在同一分类里手动切换了视图就不再被覆盖（放在 effect 依赖外）。
    if (c === "file") setViewMode("list");
    else setViewMode("grid");
  }, []);

  // ---- 详情加载 ----
  const openDetail = useCallback(async (id: string) => {
    setDetailId(id);
    setDetail(null);
    setDetailLoading(true);
    try {
      const d = await api.files.get(id);
      setDetail(d);
    } catch (err: any) {
      console.error("[FileManager] detail failed:", err);
      toast.error(err?.message || "加载文件详情失败");
      setDetailId(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const closeDetail = useCallback(() => {
    setDetailId(null);
    setDetail(null);
  }, []);

  // ---- 删除 ----
  const handleDelete = useCallback(
    async (id: string) => {
      if (!window.confirm("确定要删除此文件吗？\n\n删除后，引用该文件的笔记里将显示为破图 / 失效链接。该操作不可撤销。")) {
        return;
      }
      try {
        await api.files.remove(id);
        toast.success("已删除");
        closeDetail();
        // 本地列表即时剔除 + 刷统计
        setItems((prev) => prev.filter((it) => it.id !== id));
        setTotal((t) => Math.max(0, t - 1));
        loadStats();
      } catch (err: any) {
        console.error("[FileManager] delete failed:", err);
        toast.error(err?.message || "删除失败");
      }
    },
    [closeDetail, loadStats],
  );

  // ---- 上传 ----
  const handleUpload = useCallback(
    async (files: FileList | File[]) => {
      const arr = Array.from(files);
      if (arr.length === 0) return;
      setUploading(true);
      let ok = 0;
      let fail = 0;
      for (const f of arr) {
        try {
          await api.files.upload(f);
          ok++;
        } catch (err: any) {
          console.error("[FileManager] upload failed:", err);
          fail++;
          toast.error(`${f.name}: ${err?.message || "上传失败"}`);
        }
      }
      setUploading(false);
      if (ok > 0) {
        toast.success(`已上传 ${ok} 个文件${fail > 0 ? `，失败 ${fail}` : ""}`);
        // 重新拉首屏 + 刷统计
        setPage(1);
        loadList();
        loadStats();
      }
    },
    [loadList, loadStats],
  );

  const onPickFiles = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const onFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        handleUpload(e.target.files);
      }
      // 清空 input value，允许再次选相同文件
      e.target.value = "";
    },
    [handleUpload],
  );

  // ---- 拖拽上传整区 ----
  const [dragOver, setDragOver] = useState(false);
  const dragCounter = useRef(0);

  const onDragEnter = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    dragCounter.current++;
    setDragOver(true);
  }, []);
  const onDragLeave = useCallback(() => {
    dragCounter.current--;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setDragOver(false);
    }
  }, []);
  const onDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("Files")) e.preventDefault();
  }, []);
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      dragCounter.current = 0;
      setDragOver(false);
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleUpload(e.dataTransfer.files);
      }
    },
    [handleUpload],
  );

  // ---- 跳转到引用笔记 ----
  const jumpToNote = useCallback(
    async (noteId: string) => {
      try {
        const note = await api.getNote(noteId);
        if (!note) {
          toast.error("笔记不存在或已被删除");
          return;
        }
        actions.setActiveNote(note);
        actions.setSelectedNotebook(note.notebookId);
        actions.setViewMode("all");
        actions.setMobileView("editor");
      } catch (err: any) {
        console.error("[FileManager] jumpToNote failed:", err);
        toast.error(err?.message || "跳转失败");
      }
    },
    [actions],
  );

  // ---- 复制 URL ----
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copyUrl = useCallback((item: FileItem) => {
    const full = resolveAttachmentUrl(item.url);
    try {
      void navigator.clipboard.writeText(full);
      setCopiedId(item.id);
      toast.success("已复制链接");
      setTimeout(() => setCopiedId((id) => (id === item.id ? null : id)), 1200);
    } catch {
      toast.error("复制失败");
    }
  }, []);

  // ---- 下载 ----
  //
  // 为什么不用 window.open / <a href> 直接打开 /api/attachments/<id>：
  //   1. 图片、PDF 这类 MIME 浏览器会直接在当前 tab 里预览而不是下载；
  //   2. 直接点 <a href download="x.png"> 在跨 origin 场景（App 客户端/独立前端域）
  //      下 download 属性会被忽略，还是变成预览。
  // 所以这里走 fetch → blob → createObjectURL → 临时 <a download> 触发，
  // 兼容所有 MIME 且能保留用户上传时的原始 filename。
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const downloadItem = useCallback(async (item: { id: string; filename: string; url: string }) => {
    if (downloadingId === item.id) return;
    setDownloadingId(item.id);
    try {
      const res = await fetch(resolveAttachmentUrl(item.url));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = item.filename || `file-${item.id}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // 下一帧再 revoke，避免部分浏览器还没启动下载就被回收
      setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
    } catch (err: any) {
      console.error("[FileManager] download failed:", err);
      toast.error(`下载失败: ${err?.message || "未知错误"}`);
    } finally {
      setDownloadingId((id) => (id === item.id ? null : id));
    }
  }, [downloadingId]);



  // 分页控件相关
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // 空态文案：区分"一张没有" vs "当前筛选无结果"
  const isFirstPageNoResults = !loading && items.length === 0 && page === 1;
  const hasAnyFilter = searchQuery || category !== "all";

  // 方便状态栏展示
  const statsLine = useMemo(() => {
    if (!stats) return "";
    return `共 ${stats.total} 个文件 · ${humanSize(stats.totalBytes)}（图片 ${stats.images.count} · 其他 ${stats.files.count}）`;
  }, [stats]);

  return (
    <div
      className="flex-1 flex flex-col h-full bg-app-bg overflow-hidden relative"
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {/* 顶栏 */}
      <div
        className="flex flex-wrap items-center gap-3 px-4 md:px-6 py-3 border-b border-app-border bg-app-surface/40"
        style={{ paddingTop: "calc(var(--safe-area-top) + 12px)" }}
      >
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-8 h-8 rounded-lg bg-accent-primary/10 text-accent-primary flex items-center justify-center">
            <Inbox size={18} />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-tx-primary">文件管理</h2>
            <p className="text-[11px] text-tx-tertiary leading-none mt-0.5">{statsLine || "\u00A0"}</p>
          </div>
        </div>

        <div className="flex-1" />

        {/* 视图切换 */}
        <div className="hidden md:flex items-center rounded-lg border border-app-border bg-app-bg p-0.5">
          <button
            className={cn(
              "px-2 py-1 rounded-md text-xs flex items-center gap-1 transition-colors",
              viewMode === "grid" ? "bg-accent-primary/15 text-accent-primary" : "text-tx-secondary hover:bg-app-hover",
            )}
            onClick={() => setViewMode("grid")}
            title="网格视图"
          >
            <LayoutGrid size={14} />
          </button>
          <button
            className={cn(
              "px-2 py-1 rounded-md text-xs flex items-center gap-1 transition-colors",
              viewMode === "list" ? "bg-accent-primary/15 text-accent-primary" : "text-tx-secondary hover:bg-app-hover",
            )}
            onClick={() => setViewMode("list")}
            title="列表视图"
          >
            <List size={14} />
          </button>
        </div>

        <Button size="sm" onClick={onPickFiles} disabled={uploading} className="shrink-0">
          {uploading ? <Loader2 size={14} className="animate-spin mr-1" /> : <Upload size={14} className="mr-1" />}
          {uploading ? "上传中" : "上传文件"}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={onFileInputChange}
        />
      </div>

      {/* 工具条：分类 / 搜索 / 排序 */}
      <div className="flex flex-wrap items-center gap-2 px-4 md:px-6 py-2 border-b border-app-border bg-app-surface/20">
        {/* 分类 Tabs */}
        <div className="flex items-center gap-1 text-xs">
          {([
            { key: "all", label: "全部", count: stats?.total ?? 0, icon: <Filter size={12} /> },
            { key: "image", label: "图片", count: stats?.images.count ?? 0, icon: <ImageIcon size={12} /> },
            { key: "file", label: "文件", count: stats?.files.count ?? 0, icon: <FileText size={12} /> },
          ] as const).map((tab) => (
            <button
              key={tab.key}
              onClick={() => handleCategoryChange(tab.key as CategoryFilter)}
              className={cn(
                "px-2.5 py-1 rounded-md flex items-center gap-1.5 transition-colors",
                category === tab.key
                  ? "bg-accent-primary/15 text-accent-primary"
                  : "text-tx-secondary hover:bg-app-hover",
              )}
            >
              {tab.icon}
              <span>{tab.label}</span>
              <span className="text-[10px] text-tx-tertiary">{tab.count}</span>
            </button>
          ))}
        </div>

        <div className="flex-1" />

        {/* 搜索 */}
        <div className="relative w-full sm:w-56">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-tx-tertiary" />
          <Input
            placeholder="按文件名搜索…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="pl-7 h-8 text-xs bg-app-bg"
          />
          {searchInput && (
            <button
              className="absolute right-2 top-1/2 -translate-y-1/2 text-tx-tertiary hover:text-tx-primary"
              onClick={() => setSearchInput("")}
            >
              <X size={12} />
            </button>
          )}
        </div>

        {/* 排序 */}
        <div className="flex items-center gap-1 text-xs">
          <ArrowUpDown size={12} className="text-tx-tertiary" />
          <select
            className="h-8 px-2 rounded-md border border-app-border bg-app-bg text-tx-primary text-xs outline-none"
            value={sort}
            onChange={(e) => {
              setSort(e.target.value as FileSortKey);
              setPage(1);
            }}
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 主区 */}
      <div className="flex-1 min-h-0 relative">
        <ScrollArea className="h-full">
          <div className="px-4 md:px-6 py-4">
            {loading && items.length === 0 ? (
              <div className="flex items-center justify-center py-20 text-tx-tertiary">
                <Loader2 size={18} className="animate-spin mr-2" />
                加载中…
              </div>
            ) : isFirstPageNoResults ? (
              <EmptyState hasFilter={!!hasAnyFilter} onUpload={onPickFiles} />
            ) : viewMode === "grid" ? (
              <GridView
                items={items}
                onOpen={openDetail}
                onCopyUrl={copyUrl}
                onDownload={downloadItem}
                copiedId={copiedId}
                downloadingId={downloadingId}
              />
            ) : (
              <ListView
                items={items}
                onOpen={openDetail}
                onCopyUrl={copyUrl}
                onJumpToNote={jumpToNote}
                onDownload={downloadItem}
                copiedId={copiedId}
                downloadingId={downloadingId}
              />
            )}

            {/* 分页 */}
            {pageCount > 1 && (
              <div className="flex items-center justify-center gap-2 mt-6 text-xs text-tx-secondary">
                <Button size="sm" variant="outline" disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                  上一页
                </Button>
                <span>
                  第 {page} / {pageCount} 页（共 {total} 个）
                </span>
                <Button size="sm" variant="outline" disabled={page >= pageCount || loading} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>
                  下一页
                </Button>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* 拖拽蒙层 */}
        <AnimatePresence>
          {dragOver && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-30 bg-accent-primary/10 border-2 border-dashed border-accent-primary flex items-center justify-center pointer-events-none"
            >
              <div className="text-accent-primary text-sm font-medium flex items-center gap-2">
                <Upload size={20} />
                松开鼠标以上传
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* 详情抽屉 */}
      <AnimatePresence>
        {detailId && (
          <DetailDrawer
            detail={detail}
            loading={detailLoading}
            onClose={closeDetail}
            onDelete={handleDelete}
            onJumpToNote={jumpToNote}
            onDownload={downloadItem}
            downloadingId={downloadingId}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 子组件：空态
// ---------------------------------------------------------------------------
function EmptyState({ hasFilter, onUpload }: { hasFilter: boolean; onUpload: () => void }) {
  if (hasFilter) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-tx-tertiary text-sm">
        <Search size={32} className="mb-3 opacity-40" />
        当前筛选条件下没有文件
        <span className="text-xs mt-1">试试切换分类或清空搜索关键字</span>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center justify-center py-16 text-tx-tertiary">
      <Inbox size={40} className="mb-3 opacity-40" />
      <p className="text-sm">还没有任何文件</p>
      <p className="text-xs mt-1 mb-4">上传一张图片或任意文件开始使用</p>
      <Button size="sm" onClick={onUpload}>
        <Upload size={14} className="mr-1" />
        上传文件
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 子组件：网格视图（图片优先）
// ---------------------------------------------------------------------------
function GridView({
  items,
  onOpen,
  onCopyUrl,
  onDownload,
  copiedId,
  downloadingId,
}: {
  items: FileItem[];
  onOpen: (id: string) => void;
  onCopyUrl: (item: FileItem) => void;
  onDownload: (item: FileItem) => void;
  copiedId: string | null;
  downloadingId: string | null;
}) {
  return (
    <div
      className="grid gap-3"
      style={{ gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))" }}
    >
      {items.map((it) => (
        <GridCard
          key={it.id}
          item={it}
          onOpen={onOpen}
          onCopyUrl={onCopyUrl}
          onDownload={onDownload}
          copiedId={copiedId}
          downloadingId={downloadingId}
        />
      ))}
    </div>
  );
}

function GridCard({
  item,
  onOpen,
  onCopyUrl,
  onDownload,
  copiedId,
  downloadingId,
}: {
  item: FileItem;
  onOpen: (id: string) => void;
  onCopyUrl: (item: FileItem) => void;
  onDownload: (item: FileItem) => void;
  copiedId: string | null;
  downloadingId: string | null;
}) {
  const isImage = item.category === "image";
  return (
    <div
      className="group relative rounded-lg border border-app-border bg-app-surface overflow-hidden hover:border-accent-primary/50 hover:shadow-sm transition-all cursor-pointer"
      onClick={() => onOpen(item.id)}
      title={item.filename}
    >
      <div className="aspect-square w-full bg-app-bg flex items-center justify-center overflow-hidden">
        {isImage ? (
          <img
            src={resolveAttachmentUrl(item.url)}
            alt={item.filename}
            loading="lazy"
            className="w-full h-full object-cover"
            onError={(e) => {
              // 破图兜底：换成占位图标
              const el = e.currentTarget;
              el.style.display = "none";
              const fallback = el.nextElementSibling as HTMLElement | null;
              if (fallback) fallback.style.display = "flex";
            }}
          />
        ) : null}
        {!isImage && (
          <div className="w-full h-full flex flex-col items-center justify-center text-tx-tertiary">
            <div className="text-accent-primary/70 mb-1">{mimeIcon(item.mimeType)}</div>
            <span className="text-[10px] uppercase tracking-wide">{(item.mimeType || "").split("/")[1] || "file"}</span>
          </div>
        )}
        {isImage && (
          <div className="w-full h-full hidden flex-col items-center justify-center text-tx-tertiary bg-app-bg">
            {mimeIcon(item.mimeType)}
            <span className="text-[10px] mt-1">无法加载</span>
          </div>
        )}
      </div>
      <div className="px-2 py-1.5">
        <div className="text-[11px] text-tx-primary truncate">{item.filename}</div>
        <div className="text-[10px] text-tx-tertiary">{humanSize(item.size)}</div>
      </div>

      {/* hover 工具条 */}
      <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          className="w-6 h-6 rounded-md bg-black/50 hover:bg-black/70 text-white flex items-center justify-center disabled:opacity-50"
          onClick={(e) => {
            e.stopPropagation();
            onDownload(item);
          }}
          disabled={downloadingId === item.id}
          title="下载"
        >
          {downloadingId === item.id ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
        </button>
        <button
          className="w-6 h-6 rounded-md bg-black/50 hover:bg-black/70 text-white flex items-center justify-center"
          onClick={(e) => {
            e.stopPropagation();
            onCopyUrl(item);
          }}
          title="复制链接"
        >
          {copiedId === item.id ? <Check size={12} /> : <Copy size={12} />}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 子组件：列表视图（文件为主）
// ---------------------------------------------------------------------------
function ListView({
  items,
  onOpen,
  onCopyUrl,
  onJumpToNote,
  onDownload,
  copiedId,
  downloadingId,
}: {
  items: FileItem[];
  onOpen: (id: string) => void;
  onCopyUrl: (item: FileItem) => void;
  onJumpToNote: (noteId: string) => void;
  onDownload: (item: FileItem) => void;
  copiedId: string | null;
  downloadingId: string | null;
}) {
  return (
    <div className="rounded-lg border border-app-border bg-app-surface overflow-hidden">
      <table className="w-full text-xs">
        <thead className="bg-app-bg/60 text-tx-tertiary">
          <tr>
            <th className="text-left font-normal px-3 py-2 w-10"></th>
            <th className="text-left font-normal px-3 py-2">文件名</th>
            <th className="text-left font-normal px-3 py-2 hidden md:table-cell w-32">类型</th>
            <th className="text-right font-normal px-3 py-2 w-20">大小</th>
            <th className="text-left font-normal px-3 py-2 hidden lg:table-cell w-40">来源笔记</th>
            <th className="text-left font-normal px-3 py-2 hidden sm:table-cell w-36">上传时间</th>
            <th className="text-right font-normal px-3 py-2 w-24"></th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr
              key={it.id}
              className="border-t border-app-border hover:bg-app-hover/50 cursor-pointer transition-colors"
              onClick={() => onOpen(it.id)}
            >
              <td className="px-3 py-2 w-10">
                <div className="w-8 h-8 rounded-md bg-app-bg flex items-center justify-center overflow-hidden">
                  {it.category === "image" ? (
                    <img src={resolveAttachmentUrl(it.url)} alt="" loading="lazy" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-accent-primary/70">{mimeIcon(it.mimeType)}</span>
                  )}
                </div>
              </td>
              <td className="px-3 py-2 text-tx-primary max-w-[240px]">
                <div className="truncate" title={it.filename}>{it.filename}</div>
              </td>
              <td className="px-3 py-2 text-tx-tertiary hidden md:table-cell">
                <code className="text-[11px]">{it.mimeType || "-"}</code>
              </td>
              <td className="px-3 py-2 text-right text-tx-secondary tabular-nums">{humanSize(it.size)}</td>
              <td className="px-3 py-2 hidden lg:table-cell text-tx-secondary">
                {it.primaryNote ? (
                  <button
                    className="inline-flex items-center gap-1 hover:text-accent-primary transition-colors max-w-full"
                    onClick={(e) => {
                      e.stopPropagation();
                      onJumpToNote(it.primaryNote!.id);
                    }}
                    title={it.primaryNote.title}
                  >
                    {it.primaryNote.notebookIcon && <span>{it.primaryNote.notebookIcon}</span>}
                    <span className="truncate max-w-[150px]">{it.primaryNote.title || "(无标题)"}</span>
                    <ExternalLink size={10} className="shrink-0" />
                  </button>
                ) : (
                  <span className="text-tx-tertiary">-</span>
                )}
              </td>
              <td className="px-3 py-2 text-tx-tertiary hidden sm:table-cell">{formatLocalTime(it.createdAt)}</td>
              <td className="px-3 py-2 text-right">
                <div className="inline-flex items-center gap-0.5">
                  <button
                    className="p-1 rounded hover:bg-app-hover text-tx-tertiary hover:text-tx-primary disabled:opacity-50"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDownload(it);
                    }}
                    disabled={downloadingId === it.id}
                    title="下载"
                  >
                    {downloadingId === it.id ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                  </button>
                  <button
                    className="p-1 rounded hover:bg-app-hover text-tx-tertiary hover:text-tx-primary"
                    onClick={(e) => {
                      e.stopPropagation();
                      onCopyUrl(it);
                    }}
                    title="复制链接"
                  >
                    {copiedId === it.id ? <Check size={12} /> : <Copy size={12} />}
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 子组件：详情抽屉（预览 + 元信息 + 反向引用 + 删除）
// ---------------------------------------------------------------------------
function DetailDrawer({
  detail,
  loading,
  onClose,
  onDelete,
  onJumpToNote,
  onDownload,
  downloadingId,
}: {
  detail: FileDetail | null;
  loading: boolean;
  onClose: () => void;
  onDelete: (id: string) => void;
  onJumpToNote: (noteId: string) => void;
  onDownload: (item: { id: string; filename: string; url: string }) => void;
  downloadingId: string | null;
}) {
  return (
    <>
      {/* 遮罩（移动端全屏；桌面端半透明覆盖） */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-40 bg-zinc-900/40 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* 抽屉 */}
      <motion.div
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", bounce: 0, duration: 0.3 }}
        className="fixed right-0 top-0 bottom-0 z-50 w-full sm:w-[480px] md:w-[520px] bg-app-surface border-l border-app-border shadow-2xl flex flex-col"
      >
        {/* Drawer header */}
        <div
          className="flex items-center justify-between px-4 py-3 border-b border-app-border shrink-0"
          style={{ paddingTop: "calc(var(--safe-area-top) + 12px)" }}
        >
          <h3 className="text-sm font-semibold text-tx-primary">文件详情</h3>
          <button
            className="p-1.5 rounded-md text-tx-tertiary hover:text-tx-primary hover:bg-app-hover"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>

        {/* Drawer body */}
        <ScrollArea className="flex-1 min-h-0">
          {loading || !detail ? (
            <div className="flex items-center justify-center py-20 text-tx-tertiary">
              <Loader2 size={16} className="animate-spin mr-2" />
              加载中…
            </div>
          ) : (
            <div className="p-4 space-y-5">
              {/* 预览 */}
              <div className="rounded-lg border border-app-border bg-app-bg overflow-hidden">
                {detail.category === "image" ? (
                  <img
                    src={resolveAttachmentUrl(detail.url)}
                    alt={detail.filename}
                    className="w-full max-h-[360px] object-contain bg-zinc-950/5"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center py-10 text-tx-tertiary">
                    <div className="text-accent-primary mb-2">{mimeIcon(detail.mimeType)}</div>
                    <span className="text-xs">{detail.mimeType || "未知类型"}</span>
                  </div>
                )}
              </div>

              {/* 元信息 */}
              <div className="space-y-2 text-xs">
                <MetaRow label="文件名" value={detail.filename} />
                <MetaRow label="类型" value={<code className="text-[11px]">{detail.mimeType || "-"}</code>} />
                <MetaRow label="大小" value={humanSize(detail.size)} />
                <MetaRow label="上传时间" value={formatLocalTime(detail.createdAt)} />
                <MetaRow
                  label="下载链接"
                  value={
                    <a
                      href={resolveAttachmentUrl(detail.url)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-accent-primary hover:underline inline-flex items-center gap-1 truncate"
                    >
                      <Download size={11} />
                      <span className="truncate">{detail.url}</span>
                    </a>
                  }
                />
              </div>

              {/* 反向引用 */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-semibold text-tx-primary">引用此文件的笔记</h4>
                  <span className="text-[10px] text-tx-tertiary">{detail.references.length} 条</span>
                </div>
                {detail.references.length === 0 ? (
                  <div className="text-xs text-tx-tertiary py-4 text-center border border-dashed border-app-border rounded-md">
                    没有笔记引用该文件
                  </div>
                ) : (
                  <ul className="space-y-1">
                    {detail.references.map((ref) => (
                      <li key={ref.id}>
                        <button
                          className="w-full text-left px-2.5 py-2 rounded-md hover:bg-app-hover flex items-center gap-2 group"
                          onClick={() => {
                            onJumpToNote(ref.id);
                            onClose();
                          }}
                        >
                          <span className="text-sm">{ref.notebookIcon || "📄"}</span>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs text-tx-primary truncate flex items-center gap-1.5">
                              <span className="truncate">{ref.title || "(无标题)"}</span>
                              {ref.isPrimary && (
                                <span className="shrink-0 text-[9px] px-1 py-px rounded bg-accent-primary/15 text-accent-primary">主</span>
                              )}
                              {ref.isTrashed === 1 && (
                                <span className="shrink-0 text-[9px] px-1 py-px rounded bg-orange-500/15 text-orange-500">回收站</span>
                              )}
                            </div>
                            <div className="text-[10px] text-tx-tertiary truncate">
                              {ref.notebookName || "-"} · {formatLocalTime(ref.updatedAt)}
                            </div>
                          </div>
                          <ExternalLink size={11} className="text-tx-tertiary group-hover:text-accent-primary shrink-0" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* 操作按钮区：下载 + 删除 */}
              <div className="pt-3 border-t border-app-border space-y-2">
                <Button
                  variant="default"
                  size="sm"
                  className="w-full"
                  onClick={() => onDownload({ id: detail.id, filename: detail.filename, url: detail.url })}
                  disabled={downloadingId === detail.id}
                >
                  {downloadingId === detail.id ? (
                    <Loader2 size={14} className="mr-1 animate-spin" />
                  ) : (
                    <Download size={14} className="mr-1" />
                  )}
                  下载文件
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-red-500 border-red-500/30 hover:bg-red-500/10 hover:text-red-500 hover:border-red-500/50"
                  onClick={() => onDelete(detail.id)}
                >
                  <Trash2 size={14} className="mr-1" />
                  删除文件
                </Button>
              </div>
            </div>
          )}
        </ScrollArea>
      </motion.div>
    </>
  );
}

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="shrink-0 w-20 text-tx-tertiary">{label}</span>
      <div className="flex-1 min-w-0 text-tx-primary break-words">{value}</div>
    </div>
  );
}
