import React, { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Send, Trash2, Edit2, Clock, Check, X, MessageCircle, Loader2, ChevronDown } from "lucide-react";
import { api } from "@/lib/api";
import { DiaryEntry } from "@/types";
import { cn } from "@/lib/utils";

/* ── 相对时间格式化 ── */
function formatRelativeTime(dateStr: string, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const date = new Date(dateStr.replace(" ", "T") + (dateStr.includes("Z") ? "" : "Z"));
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHour = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return t("diary.justNow");
  if (diffMin < 60) return t("diary.minutesAgo", { count: diffMin });
  if (diffHour < 24) return t("diary.hoursAgo", { count: diffHour });
  if (diffDay < 30) return t("diary.daysAgo", { count: diffDay });

  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/* ── textarea 自适应高度 ── */
function autoResize(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = el.scrollHeight + "px";
}

/* ── 发布框子组件 ── */
function ComposeBox({
  onPost,
  isSubmitting,
}: {
  onPost: (content: string) => Promise<void>;
  isSubmitting: boolean;
}) {
  const { t } = useTranslation();
  const [content, setContent] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handlePost = async () => {
    const text = content.trim();
    if (!text || isSubmitting) return;
    await onPost(text);
    setContent("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      handlePost();
    }
  };

  return (
    <div className="bg-app-surface rounded-2xl border border-app-border p-4 mb-6 md:mb-8 transition-shadow focus-within:shadow-md focus-within:border-accent-primary/50">
      <textarea
        ref={textareaRef}
        className="w-full bg-transparent resize-none outline-none text-tx-primary placeholder-tx-tertiary text-sm md:text-base leading-relaxed"
        style={{ minHeight: "80px" }}
        placeholder={t("diary.placeholder")}
        value={content}
        onChange={(e) => {
          setContent(e.target.value);
          autoResize(e.target);
        }}
        onKeyDown={handleKeyDown}
      />
      <div className="flex justify-between items-center mt-3 pt-3 border-t border-app-border">
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-tx-tertiary tabular-nums">
            {t("diary.charCount", { count: content.length })}
          </span>
          <span className="text-[11px] text-tx-tertiary hidden sm:inline">
            {t("diary.ctrlEnter")}
          </span>
        </div>
        <button
          onClick={handlePost}
          disabled={!content.trim() || isSubmitting}
          className={cn(
            "flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium transition-all",
            content.trim() && !isSubmitting
              ? "bg-gradient-to-r from-violet-500 to-indigo-500 text-white hover:from-violet-600 hover:to-indigo-600 shadow-sm hover:shadow"
              : "bg-app-hover text-tx-tertiary cursor-not-allowed"
          )}
        >
          {isSubmitting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          {isSubmitting ? t("diary.publishing") : t("diary.publish")}
        </button>
      </div>
    </div>
  );
}

/* ── 日记卡片子组件 ── */
function DiaryCard({
  entry,
  onDelete,
  onUpdate,
  isNew,
}: {
  entry: DiaryEntry;
  onDelete: (id: string) => void;
  onUpdate: (id: string, content: string) => Promise<void>;
  isNew?: boolean;
}) {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const editRef = useRef<HTMLTextAreaElement>(null);

  const handleStartEdit = () => {
    setIsEditing(true);
    setEditContent(entry.content);
    setTimeout(() => editRef.current?.focus(), 50);
  };

  const handleSaveEdit = async () => {
    const text = editContent.trim();
    if (!text) return;
    await onUpdate(entry.id, text);
    setIsEditing(false);
    setEditContent("");
  };

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      handleSaveEdit();
    }
    if (e.key === "Escape") setIsEditing(false);
  };

  return (
    <div
      className={cn(
        "relative flex gap-4 group",
        isNew && "animate-in fade-in slide-in-from-top-2 duration-300"
      )}
    >
      {/* 时间轴圆点 */}
      <div className="relative z-10 mt-3 shrink-0">
        <div className="w-[10px] h-[10px] rounded-full border-[2.5px] border-violet-400 dark:border-violet-500 bg-app-bg ring-4 ring-app-bg" />
      </div>

      {/* 卡片内容 */}
      <div className="flex-1 min-w-0">
        <div className="bg-app-surface rounded-xl border border-app-border p-4 hover:shadow-sm transition-all">
          {/* 时间 + 操作 */}
          <div className="flex items-center justify-between mb-2">
            <span className="flex items-center gap-1.5 text-[11px] text-tx-tertiary">
              <Clock size={12} />
              {formatRelativeTime(entry.createdAt, t)}
            </span>
            {!isEditing && (
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={handleStartEdit}
                  className="p-1 rounded hover:bg-app-hover text-tx-tertiary hover:text-tx-secondary transition-colors"
                  title={t("diary.edit")}
                >
                  <Edit2 size={13} />
                </button>
                <button
                  onClick={() => onDelete(entry.id)}
                  className="p-1 rounded hover:bg-red-500/10 text-tx-tertiary hover:text-red-500 transition-colors"
                  title={t("common.delete")}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            )}
          </div>

          {/* 内容区 */}
          {isEditing ? (
            <div>
              <textarea
                ref={editRef}
                className="w-full bg-app-bg rounded-lg p-3 resize-none outline-none text-tx-primary text-sm leading-relaxed border border-app-border focus:border-accent-primary/50 transition-colors"
                style={{ minHeight: "80px" }}
                value={editContent}
                onChange={(e) => {
                  setEditContent(e.target.value);
                  autoResize(e.target);
                }}
                onKeyDown={handleEditKeyDown}
              />
              <div className="flex items-center justify-end gap-2 mt-2">
                <button
                  onClick={() => setIsEditing(false)}
                  className="flex items-center gap-1 px-3 py-1 rounded-full text-xs text-tx-secondary hover:bg-app-hover transition-colors"
                >
                  <X size={12} />
                  {t("diary.cancelEdit")}
                </button>
                <button
                  onClick={handleSaveEdit}
                  disabled={!editContent.trim()}
                  className="flex items-center gap-1 px-3 py-1 rounded-full text-xs bg-violet-500 text-white hover:bg-violet-600 disabled:opacity-50 transition-colors"
                >
                  <Check size={12} />
                  {t("diary.saveEdit")}
                </button>
              </div>
            </div>
          ) : (
            <div className="text-sm text-tx-primary whitespace-pre-wrap leading-relaxed break-words">
              {entry.content}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── 主组件 ── */
export default function DiaryCenter() {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<DiaryEntry[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const sentinelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 加载数据（首次 / 加载更多）
  const loadEntries = useCallback(async (loadCursor?: string | null) => {
    try {
      const page = await api.getDiaryEntries(loadCursor ?? undefined);
      if (loadCursor) {
        setEntries((prev) => [...prev, ...page.items]);
      } else {
        setEntries(page.items);
      }
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch (err) {
      console.error("Failed to fetch diary entries:", err);
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, []);

  // 首次加载
  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  // 无限滚动：IntersectionObserver
  useEffect(() => {
    if (!hasMore || isLoadingMore) return;
    const el = sentinelRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasMore && !isLoadingMore) {
          setIsLoadingMore(true);
          loadEntries(cursor);
        }
      },
      { rootMargin: "200px" }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, isLoadingMore, cursor, loadEntries]);

  // 清除 new 动画标记
  useEffect(() => {
    if (newIds.size === 0) return;
    const timer = setTimeout(() => setNewIds(new Set()), 600);
    return () => clearTimeout(timer);
  }, [newIds]);

  // 发布（乐观插入）
  const handlePost = useCallback(async (content: string) => {
    setIsSubmitting(true);
    try {
      const created = await api.createDiaryEntry(content);
      setEntries((prev) => [created, ...prev]);
      setNewIds(new Set([created.id]));
      // 滚动到顶部
      scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      console.error("Failed to create diary entry:", err);
    } finally {
      setIsSubmitting(false);
    }
  }, []);

  // 删除（乐观移除）
  const handleDelete = useCallback((id: string) => {
    if (!window.confirm(t("diary.confirmDelete"))) return;
    const prev = entries;
    setEntries((e) => e.filter((item) => item.id !== id));
    api.deleteDiaryEntry(id).catch((err) => {
      console.error("Failed to delete diary entry:", err);
      setEntries(prev); // 回滚
    });
  }, [entries, t]);

  // 更新
  const handleUpdate = useCallback(async (id: string, content: string) => {
    try {
      const updated = await api.updateDiaryEntry(id, content);
      setEntries((prev) => prev.map((e) => (e.id === id ? updated : e)));
    } catch (err) {
      console.error("Failed to update diary entry:", err);
    }
  }, []);

  return (
    <div ref={scrollRef} className="flex-1 h-full overflow-y-auto bg-app-bg">
      <div className="max-w-3xl mx-auto py-6 md:py-10 px-4 sm:px-6">
        {/* 标题区 */}
        <div className="mb-6 md:mb-8">
          <h1 className="text-xl md:text-2xl font-bold text-tx-primary flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center">
              <MessageCircle size={16} className="text-white" />
            </div>
            {t("diary.title")}
          </h1>
          <p className="text-xs md:text-sm text-tx-tertiary mt-1.5 ml-[42px]">{t("diary.subtitle")}</p>
        </div>

        {/* 发布框 */}
        <ComposeBox onPost={handlePost} isSubmitting={isSubmitting} />

        {/* 时间线 */}
        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 size={24} className="text-accent-primary animate-spin" />
          </div>
        ) : entries.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-16 h-16 rounded-full bg-app-hover flex items-center justify-center mx-auto mb-4">
              <MessageCircle size={28} className="text-tx-tertiary" />
            </div>
            <p className="text-sm text-tx-tertiary">{t("diary.empty")}</p>
          </div>
        ) : (
          <div className="relative">
            {/* 时间轴竖线 */}
            <div className="absolute left-[19px] top-2 bottom-2 w-[2px] bg-gradient-to-b from-violet-300/60 via-app-border to-transparent dark:from-violet-600/40" />

            <div className="space-y-4">
              {entries.map((entry) => (
                <DiaryCard
                  key={entry.id}
                  entry={entry}
                  onDelete={handleDelete}
                  onUpdate={handleUpdate}
                  isNew={newIds.has(entry.id)}
                />
              ))}
            </div>

            {/* 无限滚动哨兵 / 加载更多 */}
            <div ref={sentinelRef} className="flex justify-center py-6">
              {isLoadingMore ? (
                <div className="flex items-center gap-2 text-xs text-tx-tertiary">
                  <Loader2 size={14} className="animate-spin" />
                  {t("diary.loading")}
                </div>
              ) : hasMore ? (
                <button
                  onClick={() => {
                    setIsLoadingMore(true);
                    loadEntries(cursor);
                  }}
                  className="flex items-center gap-1 text-xs text-tx-tertiary hover:text-tx-secondary transition-colors"
                >
                  <ChevronDown size={14} />
                  {t("diary.loadMore")}
                </button>
              ) : entries.length > 0 ? (
                <span className="text-[11px] text-tx-tertiary">{t("diary.noMore")}</span>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
