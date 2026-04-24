/**
 * CommandPalette —— Cmd-K 全局搜索弹窗
 * ----------------------------------------------------------------------------
 * 为什么不用 Sidebar 搜索框？
 *   - Sidebar 搜索把结果灌回 NoteList 的"search 视图"，是 **持久化浏览** 语义；
 *     用户要继续阅读结果列表，视图会切走，要手动切回来。
 *   - Cmd-K 是 **即用即走** 语义：快速跳转，跳完即关；保持当前 viewMode 不变。
 *   - 二者各司其职。Sidebar 搜索 = 筛选浏览；Cmd-K = 跳转导航。
 *
 * 触发来源：
 *   1) macOS 原生 "搜索" 菜单项（menu:search → useDesktopMenuBridge → onOpenSearch）
 *   2) Dock 右键 "搜索笔记"（dock:search）
 *   3) 键盘 Cmd/Ctrl+K（本组件自己监听 window keydown）
 *
 * 实现选择：
 *   - Portal 到 document.body，不被父级 overflow/transform 牵连；
 *   - 搜索输入 debounce 200ms，避免每键一次 HTTP；
 *   - 空查询不请求接口；
 *   - 键盘：Up/Down 选择、Enter 跳转、Esc 关闭；鼠标 hover 同步高亮；
 *   - 点击结果或 Enter → `api.getNote(id)` 取详情 → `actions.setActiveNote`，
 *     与 Sidebar 搜索命中同一条数据通路，保证打开后编辑器正常渲染；
 *   - 面板尺寸与 SettingsModal 保持一致的"上偏移居中"定位（HIG 命令面板惯例）。
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search as SearchIcon, FileText, Loader2 } from "lucide-react";
import { useAppActions } from "@/store/AppContext";
import { api } from "@/lib/api";
import type { SearchResult } from "@/types";

export interface CommandPaletteProps {
  /** 由外部控制开合；App 层一个 useState 即可 */
  open: boolean;
  onClose: () => void;
}

/** 极简高亮：把命中词用 <mark> 包裹。只做首个不区分大小写的匹配，避免 XSS 做纯字符串分段。 */
function highlight(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const i = text.toLowerCase().indexOf(query.toLowerCase());
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark className="bg-amber-200/60 dark:bg-amber-400/30 text-inherit rounded px-0.5">
        {text.slice(i, i + query.length)}
      </mark>
      {text.slice(i + query.length)}
    </>
  );
}

export default function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const actions = useAppActions();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 打开时：清空旧状态、focus 输入框
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setResults([]);
    setActiveIdx(0);
    // rAF 等一帧让 Portal DOM 就位
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, [open]);

  // 关闭时：清理 pending 请求与 debounce
  useEffect(() => {
    if (open) return;
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    abortRef.current?.abort();
    abortRef.current = null;
  }, [open]);

  // query 变化 → debounce 200ms 请求
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const q = query.trim();
    if (!q) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      debounceRef.current = null;
      // 取消上一次可能还未返回的请求（api.search 目前不吃 signal，我们用"丢弃结果"实现取消语义）
      const my = new AbortController();
      abortRef.current?.abort();
      abortRef.current = my;
      try {
        const r = await api.search(q);
        if (my.signal.aborted) return;
        setResults(r);
        setActiveIdx(0);
      } catch (err) {
        if (my.signal.aborted) return;
        console.warn("[CommandPalette] search failed:", err);
        setResults([]);
      } finally {
        if (!my.signal.aborted) setLoading(false);
      }
    }, 200);
  }, [query, open]);

  // 全局 Cmd/Ctrl+K：在任何地方都能打开；Esc 关闭
  // 注意：Cmd-K 通常会被 Chrome 占用（焦点地址栏），但在 Electron 中不会，Web 端我们
  // preventDefault 后即可覆盖默认行为；已经打开则忽略（避免重复 focus 抖动）。
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (!open) {
          // 由外部控制开合，发个 CustomEvent 让 App 层监听并 setOpen(true)
          window.dispatchEvent(new CustomEvent("nowen:open-command-palette"));
        }
      } else if (open && e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  // 跳转到笔记：拉详情 → setActiveNote（与 Sidebar 搜索命中一致的数据通路）
  const jumpTo = useCallback(
    async (id: string) => {
      try {
        const note = await api.getNote(id);
        if (note) {
          actions.setActiveNote(note);
          actions.setMobileView?.("editor");
        }
      } catch (err) {
        console.error("[CommandPalette] open note failed:", err);
      } finally {
        onClose();
      }
    },
    [actions, onClose],
  );

  // 列表内键盘导航
  const onInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!results.length) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, results.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const hit = results[activeIdx];
        if (hit) void jumpTo(hit.id);
      }
    },
    [results, activeIdx, jumpTo],
  );

  // activeIdx 变化时，把高亮项滚到视口内
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIdx, results]);

  const body = useMemo(() => {
    if (!open) return null;
    return (
      <div
        className="fixed inset-0 z-[200] flex items-start justify-center pt-[15vh] px-4"
        onClick={(e) => {
          // 只有点 backdrop 时关闭；面板内的点击不冒泡到此处
          if (e.target === e.currentTarget) onClose();
        }}
      >
        {/* Backdrop */}
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" aria-hidden />
        {/* Panel */}
        <div
          className="relative w-full max-w-[640px] bg-app-elevated border border-app-border rounded-xl shadow-2xl overflow-hidden"
          role="dialog"
          aria-modal="true"
          aria-label="全局搜索"
          onClick={(e) => e.stopPropagation()}
        >
          {/* 输入框 */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-app-border">
            <SearchIcon size={18} className="text-tx-tertiary shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onInputKeyDown}
              placeholder="搜索笔记标题与内容…"
              className="flex-1 bg-transparent outline-none text-sm text-tx-primary placeholder:text-tx-tertiary"
              autoComplete="off"
              spellCheck={false}
            />
            {loading && <Loader2 size={16} className="animate-spin text-tx-tertiary" />}
            <kbd className="hidden sm:inline-flex items-center px-1.5 h-5 rounded border border-app-border text-[10px] text-tx-tertiary">
              Esc
            </kbd>
          </div>

          {/* 结果列表 */}
          <div ref={listRef} className="max-h-[50vh] overflow-y-auto py-1">
            {results.length === 0 && query.trim() && !loading && (
              <div className="px-4 py-6 text-center text-sm text-tx-tertiary">
                未找到与 &ldquo;{query}&rdquo; 匹配的笔记
              </div>
            )}
            {!query.trim() && (
              <div className="px-4 py-6 text-center text-sm text-tx-tertiary">
                输入关键词开始搜索（↑↓ 选择，Enter 打开，Esc 关闭）
              </div>
            )}
            {results.map((r, idx) => {
              const isActive = idx === activeIdx;
              return (
                <button
                  key={r.id}
                  data-idx={idx}
                  type="button"
                  onMouseEnter={() => setActiveIdx(idx)}
                  onClick={() => void jumpTo(r.id)}
                  className={[
                    "w-full text-left px-4 py-2 flex items-start gap-3 transition-colors",
                    isActive ? "bg-app-hover" : "hover:bg-app-hover/60",
                  ].join(" ")}
                >
                  <FileText size={16} className="mt-0.5 text-tx-tertiary shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-tx-primary truncate">
                      {highlight(r.title || "(无标题)", query)}
                    </div>
                    {r.snippet && (
                      <div className="text-xs text-tx-tertiary truncate mt-0.5">
                        {highlight(r.snippet, query)}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }, [open, query, loading, results, activeIdx, onInputKeyDown, jumpTo, onClose]);

  if (typeof document === "undefined") return null;
  return createPortal(body, document.body);
}
