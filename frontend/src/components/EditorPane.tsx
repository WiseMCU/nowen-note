import React, { useCallback, useRef, useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Star, Pin, Trash2, Cloud, CloudOff, RefreshCw, Check, Loader2, ChevronLeft, FolderInput, ChevronRight, ChevronDown, X, ListTree, Lock, Unlock, Tag as TagIcon, Type, MoreHorizontal, Share2, History, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import TiptapEditor, { HeadingItem } from "@/components/TiptapEditor";
import { useApp, useAppActions, SyncStatus } from "@/store/AppContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Tag, Notebook } from "@/types";
import { useTranslation } from "react-i18next";
import { haptic } from "@/hooks/useCapacitor";
import ShareModal from "@/components/ShareModal";
import VersionHistoryPanel from "@/components/VersionHistoryPanel";
import CommentPanel from "@/components/CommentPanel";

export default function EditorPane() {
  const { state } = useApp();
  const actions = useAppActions();
  const { activeNote, syncStatus, lastSyncedAt } = state;
  const savedTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [showMoveDropdown, setShowMoveDropdown] = useState(false);
  const moveDropdownRef = useRef<HTMLDivElement | null>(null);
  const [showOutline, setShowOutline] = useState(false);
  const [headings, setHeadings] = useState<HeadingItem[]>([]);
  const scrollToRef = useRef<((pos: number) => void) | null>(null);
  const { t } = useTranslation();
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [showMobileMoveMenu, setShowMobileMoveMenu] = useState(false);
  const [showMobileOutline, setShowMobileOutline] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [showCommentPanel, setShowCommentPanel] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const mobileMenuRef = useRef<HTMLDivElement | null>(null);

  // Delete 键删除笔记快捷键（仅在编辑器未聚焦时生效）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Delete" && activeNote && !activeNote.isLocked) {
        // 检查焦点是否在编辑器内部（如果在编辑器内，Delete 键应该正常删除文字）
        const activeEl = document.activeElement;
        const isInEditor = activeEl?.closest(".ProseMirror") || activeEl?.tagName === "INPUT" || activeEl?.tagName === "TEXTAREA";
        if (!isInEditor) {
          e.preventDefault();
          setShowDeleteConfirm(true);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeNote]);

  // 使用 ref 追踪最新的 activeNote，避免 handleUpdate 闭包引用过期
  const activeNoteRef = useRef(activeNote);
  activeNoteRef.current = activeNote;

  // 点击外部关闭移动端菜单
  useEffect(() => {
    if (!showMobileMenu) return;
    const handler = (e: MouseEvent) => {
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(e.target as Node)) {
        setShowMobileMenu(false);
        setShowMobileMoveMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showMobileMenu]);

  const handleUpdate = useCallback(async (data: { content: string; contentText: string; title: string }) => {
    const currentNote = activeNoteRef.current;
    if (!currentNote || currentNote.isLocked) return;
    actions.setSyncStatus("saving");
    try {
      const updated = await api.updateNote(currentNote.id, {
        title: data.title,
        content: data.content,
        contentText: data.contentText,
        version: currentNote.version,
      } as any);
      // 仅在保存的笔记仍是当前激活笔记时更新状态（防止快速切换时覆盖错误笔记）
      if (activeNoteRef.current?.id === updated.id) {
        // 只合并服务端返回的元数据（version, updatedAt），保留编辑器内的 content
        // 避免用服务端返回的 content 覆盖 activeNote，否则可能因微小 JSON 差异触发编辑器 setContent → onUpdate 死循环
        actions.setActiveNote({
          ...activeNoteRef.current,
          version: updated.version,
          updatedAt: updated.updatedAt,
          title: data.title,
          content: data.content,
          contentText: data.contentText,
        });
        actions.updateNoteInList({ id: updated.id, title: updated.title, contentText: updated.contentText, updatedAt: updated.updatedAt });
        actions.setSyncStatus("saved");
        actions.setLastSynced(new Date().toISOString());
        // 2秒后恢复 idle
        if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
        savedTimerRef.current = setTimeout(() => actions.setSyncStatus("idle"), 2000);
      }
    } catch {
      actions.setSyncStatus("error");
    }
  }, [actions]);

  // 手动触发同步：重新保存当前编辑器内容
  const handleManualSync = useCallback(async () => {
    if (!activeNote || syncStatus === "saving") return;
    actions.setSyncStatus("saving");
    try {
      const updated = await api.updateNote(activeNote.id, {
        title: activeNote.title,
        content: activeNote.content,
        contentText: activeNote.contentText,
        version: activeNote.version,
      } as any);
      actions.setActiveNote(updated);
      actions.updateNoteInList({ id: updated.id, title: updated.title, contentText: updated.contentText, updatedAt: updated.updatedAt });
      actions.setSyncStatus("saved");
      actions.setLastSynced(new Date().toISOString());
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => actions.setSyncStatus("idle"), 2000);
    } catch {
      actions.setSyncStatus("error");
    }
  }, [activeNote, syncStatus, actions]);

  const toggleFavorite = useCallback(async () => {
    if (!activeNote) return;
    haptic.light();
    const updated = await api.updateNote(activeNote.id, { isFavorite: activeNote.isFavorite ? 0 : 1 } as any);
    actions.setActiveNote(updated);
    actions.updateNoteInList({ id: updated.id, isFavorite: updated.isFavorite });
  }, [activeNote, actions]);

  const togglePin = useCallback(async () => {
    if (!activeNote) return;
    haptic.light();
    const updated = await api.updateNote(activeNote.id, { isPinned: activeNote.isPinned ? 0 : 1 } as any);
    actions.setActiveNote(updated);
    actions.updateNoteInList({ id: updated.id, isPinned: updated.isPinned });
  }, [activeNote, actions]);

  const toggleLock = useCallback(async () => {
    if (!activeNote) return;
    haptic.medium();
    const updated = await api.updateNote(activeNote.id, { isLocked: activeNote.isLocked ? 0 : 1 } as any);
    actions.setActiveNote(updated);
    actions.updateNoteInList({ id: updated.id, isLocked: updated.isLocked });
  }, [activeNote, actions]);

  const moveToTrash = useCallback(async () => {
    if (!activeNote || activeNote.isLocked) return;
    haptic.heavy();
    const noteId = activeNote.id;
    actions.setActiveNote(null);
    actions.removeNoteFromList(noteId);
    api.updateNote(noteId, { isTrashed: 1 } as any)
      .then(() => actions.refreshNotebooks())
      .catch(console.error);
  }, [activeNote, actions]);

  const handleTagsChange = useCallback((tags: Tag[]) => {
    if (!activeNote) return;
    actions.setActiveNote({ ...activeNote, tags });
    api.getTags().then(actions.setTags).catch(console.error);
  }, [activeNote, actions]);

  // AI 生成标题
  const [aiTitleLoading, setAiTitleLoading] = useState(false);
  const handleAITitle = useCallback(async () => {
    if (!activeNote || !activeNote.contentText || aiTitleLoading) return;
    setAiTitleLoading(true);
    try {
      const title = await api.aiChat("title", activeNote.contentText.slice(0, 2000));
      const cleaned = title.replace(/^["'"""'']+|["'"""'']+$/g, "").trim();
      if (cleaned) {
        const updated = await api.updateNote(activeNote.id, { title: cleaned, version: activeNote.version } as any);
        actions.setActiveNote(updated);
        actions.updateNoteInList({ id: updated.id, title: updated.title, updatedAt: updated.updatedAt });
      }
    } catch (e) { console.error("AI title error:", e); }
    setAiTitleLoading(false);
  }, [activeNote, actions, aiTitleLoading]);

  // AI 推荐标签
  const [aiTagsLoading, setAiTagsLoading] = useState(false);
  const handleAITags = useCallback(async () => {
    if (!activeNote || !activeNote.contentText || aiTagsLoading) return;
    setAiTagsLoading(true);
    try {
      const result = await api.aiChat("tags", activeNote.contentText.slice(0, 2000));
      const tagNames = result.split(/[,，、\s]+/).map(s => s.replace(/^#/, "").trim()).filter(Boolean);
      const userId = activeNote.userId;
      for (const name of tagNames) {
        // 检查是否已存在
        const existing = state.tags.find(t => t.name === name);
        let tagId: string;
        if (existing) {
          tagId = existing.id;
        } else {
          const newTag = await api.createTag({ name });
          tagId = newTag.id;
        }
        // 检查是否已关联
        const noteTags = activeNote.tags || [];
        if (!noteTags.find(t => t.id === tagId)) {
          await api.addTagToNote(activeNote.id, tagId);
        }
      }
      // 重新获取笔记和标签
      const updatedNote = await api.getNote(activeNote.id);
      actions.setActiveNote(updatedNote);
      api.getTags().then(actions.setTags).catch(console.error);
    } catch (e) { console.error("AI tags error:", e); }
    setAiTagsLoading(false);
  }, [activeNote, actions, state.tags, aiTagsLoading]);

  const handleMoveToNotebook = useCallback(async (notebookId: string) => {
    if (!activeNote || notebookId === activeNote.notebookId) return;
    const updated = await api.updateNote(activeNote.id, { notebookId } as any);
    actions.setActiveNote(updated);
    actions.updateNoteInList({ id: updated.id, notebookId: updated.notebookId });
    setShowMoveDropdown(false);
    actions.refreshNotebooks();
  }, [activeNote, actions]);

  // 构建与左侧侧边栏完全一致的笔记本树
  const notebookTree = useMemo(() => buildTree(state.notebooks), [state.notebooks]);
  // 当前笔记所属笔记本的完整路径（面包屑）
  const currentPath = useMemo(
    () => findPathById(state.notebooks, activeNote?.notebookId),
    [state.notebooks, activeNote?.notebookId]
  );

  if (!activeNote) {
    return (
      <div className="flex-1 flex items-center justify-center bg-app-bg transition-colors">
        <div className="text-center hidden md:flex flex-col items-center">
          <div className="relative mb-6">
            <div className="w-20 h-20 rounded-2xl bg-accent-primary/5 border border-accent-primary/10 flex items-center justify-center">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" className="text-accent-primary/30">
                <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                <polyline points="14,2 14,8 20,8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                <line x1="8" y1="13" x2="16" y2="13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                <line x1="8" y1="17" x2="12" y2="17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </div>
            <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-accent-primary/10 border border-accent-primary/15 flex items-center justify-center">
              <span className="text-accent-primary/50 text-xs">✦</span>
            </div>
          </div>
          <p className="text-tx-secondary text-sm font-medium mb-1">{t('editor.selectNote')}</p>
          <p className="text-tx-tertiary text-xs max-w-[220px] leading-relaxed">{t('editor.orCreateNew')}</p>
          <div className="flex items-center gap-3 mt-5">
            <kbd className="px-2 py-1 rounded-md bg-app-hover border border-app-border text-[10px] text-tx-tertiary font-mono">Alt+N</kbd>
            <span className="text-[10px] text-tx-tertiary">{t('editor.newNoteShortcut') || '快速新建笔记'}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      key={activeNote.id}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
      className="flex-1 flex flex-col bg-app-bg overflow-hidden transition-colors"
    >
      {/* Mobile Editor Header - 返回按钮 */}
      <header className="flex items-center gap-2 px-3 py-2 border-b border-app-border bg-app-surface/50 md:hidden" style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 8px)' }}>
        <button
          onClick={() => actions.setMobileView("list")}
          className="flex items-center text-accent-primary py-1.5 px-1.5 -ml-1.5 rounded-lg active:bg-app-hover"
        >
          <ChevronLeft size={24} />
          <span className="text-sm font-medium">{t('editor.back')}</span>
        </button>
        <div className="ml-auto flex items-center gap-1.5">
          <SyncIndicator syncStatus={syncStatus} lastSyncedAt={lastSyncedAt} onManualSync={handleManualSync} />
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggleLock}
            title={activeNote.isLocked ? t('editor.unlockTooltip') : t('editor.lockTooltip')}>
            {activeNote.isLocked
              ? <Lock size={16} className="text-orange-500" />
              : <Unlock size={16} />}
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={togglePin}>
            <Pin size={16} className={cn(activeNote.isPinned && "text-accent-primary fill-accent-primary")} />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggleFavorite}>
            <Star size={16} className={cn(activeNote.isFavorite && "text-amber-400 fill-amber-400")} />
          </Button>
          {/* 更多操作按钮 */}
          <div className="relative" ref={mobileMenuRef}>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setShowMobileMenu(!showMobileMenu); setShowMobileMoveMenu(false); }}>
              <MoreHorizontal size={16} />
            </Button>
            {/* 更多操作下拉菜单 */}
            <AnimatePresence>
              {showMobileMenu && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: -4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: -4 }}
                  transition={{ duration: 0.12 }}
                  className="absolute top-full right-0 mt-1 w-56 bg-app-elevated border border-app-border rounded-lg shadow-xl z-50 py-1 overflow-hidden"
                >
                  {/* 移动笔记本 */}
                  <button
                    onClick={() => setShowMobileMoveMenu(!showMobileMoveMenu)}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-tx-secondary active:bg-app-hover transition-colors"
                  >
                    <FolderInput size={15} className="text-tx-tertiary" />
                    <span className="flex-1 text-left">{t('editor.moveToNotebook')}</span>
                    <ChevronRight size={14} className="text-tx-tertiary" />
                  </button>
                  {/* 移动笔记本子菜单 */}
                  <AnimatePresence>
                    {showMobileMoveMenu && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        className="overflow-hidden border-t border-b border-app-border bg-app-bg/50"
                      >
                        <div className="max-h-56 overflow-auto py-1 px-1">
                          {notebookTree.map((nb) => (
                            <MoveTreeItem
                              key={nb.id}
                              notebook={nb}
                              depth={0}
                              currentId={activeNote.notebookId}
                              onSelect={(id) => {
                                handleMoveToNotebook(id);
                                setShowMobileMenu(false);
                                setShowMobileMoveMenu(false);
                              }}
                            />
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  {/* 大纲 */}
                  <button
                    onClick={() => {
                      setShowMobileOutline(true);
                      setShowMobileMenu(false);
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-tx-secondary active:bg-app-hover transition-colors"
                  >
                    <ListTree size={15} className="text-tx-tertiary" />
                    <span>{t('editor.showOutline')}</span>
                  </button>
                  <div className="h-px bg-app-border mx-2 my-0.5" />
                  {/* AI 生成标题 */}
                  <button
                    onClick={() => {
                      handleAITitle();
                      setShowMobileMenu(false);
                    }}
                    disabled={aiTitleLoading || !activeNote.contentText || !!activeNote.isLocked}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-tx-secondary active:bg-app-hover transition-colors disabled:opacity-40"
                  >
                    {aiTitleLoading ? <Loader2 size={15} className="animate-spin text-violet-500" /> : <Type size={15} className="text-violet-500" />}
                    <span>{t('editor.aiGenerateTitle')}</span>
                  </button>
                  {/* AI 推荐标签 */}
                  <button
                    onClick={() => {
                      handleAITags();
                      setShowMobileMenu(false);
                    }}
                    disabled={aiTagsLoading || !activeNote.contentText || !!activeNote.isLocked}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-tx-secondary active:bg-app-hover transition-colors disabled:opacity-40"
                  >
                    {aiTagsLoading ? <Loader2 size={15} className="animate-spin text-violet-500" /> : <TagIcon size={15} className="text-violet-500" />}
                    <span>{t('editor.aiSuggestTags')}</span>
                  </button>
                  <div className="h-px bg-app-border mx-2 my-0.5" />
                  {/* 分享 */}
                  <button
                    onClick={() => {
                      setShowShareModal(true);
                      setShowMobileMenu(false);
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-tx-secondary active:bg-app-hover transition-colors"
                  >
                    <Share2 size={15} className="text-emerald-500" />
                    <span>分享</span>
                  </button>
                  {/* 版本历史 */}
                  <button
                    onClick={() => {
                      setShowVersionHistory(true);
                      setShowMobileMenu(false);
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-tx-secondary active:bg-app-hover transition-colors"
                  >
                    <History size={15} className="text-violet-500" />
                    <span>版本历史</span>
                  </button>
                  {/* 评论 */}
                  <button
                    onClick={() => {
                      setShowCommentPanel(true);
                      setShowMobileMenu(false);
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-tx-secondary active:bg-app-hover transition-colors"
                  >
                    <MessageCircle size={15} className="text-blue-500" />
                    <span>评论批注</span>
                  </button>
                  <div className="h-px bg-app-border mx-2 my-0.5" />
                  {/* 删除笔记 */}
                  <button
                    onClick={() => {
                      moveToTrash();
                      setShowMobileMenu(false);
                    }}
                    disabled={!!activeNote.isLocked}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-red-500 active:bg-red-50 dark:active:bg-red-900/20 transition-colors disabled:opacity-40"
                  >
                    <Trash2 size={15} />
                    <span>{t('editor.trashTooltip')}</span>
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </header>

      {/* Mobile Outline Panel (全屏覆盖) */}
      <AnimatePresence>
        {showMobileOutline && (
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed inset-0 z-40 bg-app-surface flex flex-col md:hidden"
            style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 0px)' }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-app-border">
              <div className="flex items-center gap-1.5 text-sm font-semibold text-tx-primary">
                <ListTree size={16} className="text-accent-primary" />
                <span>{t('editor.outline')}</span>
              </div>
              <button
                onClick={() => setShowMobileOutline(false)}
                className="p-1.5 rounded-md hover:bg-app-hover text-tx-secondary transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <ScrollArea className="flex-1">
              <div className="py-2 px-2">
                {headings.length === 0 ? (
                  <div className="px-3 py-12 text-center">
                    <p className="text-sm text-tx-tertiary">{t('editor.noHeadings')}</p>
                    <p className="text-xs text-tx-tertiary mt-1">{t('editor.noHeadingsHint')}</p>
                  </div>
                ) : (
                  headings.map((h) => (
                    <button
                      key={h.id}
                      onClick={() => {
                        scrollToRef.current?.(h.pos);
                        setShowMobileOutline(false);
                      }}
                      className={cn(
                        "w-full text-left px-4 py-2.5 text-sm transition-colors active:bg-app-hover rounded-lg",
                        h.level === 1 && "font-medium text-tx-primary",
                        h.level === 2 && "text-tx-secondary",
                        h.level === 3 && "text-tx-tertiary",
                      )}
                      style={{ paddingLeft: `${(h.level - 1) * 16 + 16}px` }}
                    >
                      <span className={cn(
                        "inline-block w-2 h-2 rounded-full mr-2.5 shrink-0 align-middle",
                        h.level === 1 && "bg-accent-primary",
                        h.level === 2 && "bg-accent-primary/50",
                        h.level === 3 && "bg-tx-tertiary/50",
                      )} />
                      {h.text || t('editor.untitled')}
                    </button>
                  ))
                )}
              </div>
            </ScrollArea>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Desktop Editor Header */}
      <div className="hidden md:flex items-center justify-between px-4 py-2 border-b border-app-border bg-app-surface/30 transition-colors">
        <div className="relative">
          <button
            onClick={() => setShowMoveDropdown(!showMoveDropdown)}
            className="flex items-center gap-1 text-xs text-tx-tertiary hover:text-tx-secondary transition-colors rounded-md px-1.5 py-1 hover:bg-app-hover max-w-[520px]"
            title={t('editor.moveToNotebook')}
          >
            {currentPath.length > 0 ? (
              <span className="flex items-center gap-1 min-w-0">
                {currentPath.map((nb, idx) => (
                  <React.Fragment key={nb.id}>
                    {idx > 0 && <ChevronRight size={11} className="text-tx-tertiary/60 shrink-0" />}
                    <span className={cn(
                      "flex items-center gap-1 shrink-0 truncate",
                      idx === currentPath.length - 1 && "text-tx-secondary font-medium"
                    )}>
                      <span>{nb.icon || "📁"}</span>
                      <span className="truncate max-w-[120px]">{nb.name}</span>
                    </span>
                  </React.Fragment>
                ))}
              </span>
            ) : (
              <span>—</span>
            )}
            <ChevronDown size={12} className="shrink-0 ml-0.5" />
          </button>
          {showMoveDropdown && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowMoveDropdown(false)} />
              <div
                ref={moveDropdownRef}
                className="absolute top-full left-0 mt-1 w-64 bg-app-elevated border border-app-border rounded-lg shadow-xl z-50 py-1 max-h-80 overflow-auto"
                style={{ animation: "contextMenuIn 0.12s ease-out" }}
              >
                <div className="px-3 py-1.5 text-[10px] font-medium text-tx-tertiary border-b border-app-border mb-1">
                  {t('editor.moveToLabel')}
                </div>
                <div className="px-1 pb-1">
                  {notebookTree.map((nb) => (
                    <MoveTreeItem
                      key={nb.id}
                      notebook={nb}
                      depth={0}
                      currentId={activeNote.notebookId}
                      onSelect={handleMoveToNotebook}
                    />
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Sync Indicator + Grouped Actions */}
        <div className="flex items-center gap-2">
          {/* 同步状态 */}
          <SyncIndicator
            syncStatus={syncStatus}
            lastSyncedAt={lastSyncedAt}
            onManualSync={handleManualSync}
          />

          <div className="w-px h-4 bg-app-border" />

          {/* 编辑操作组 */}
          <div className="flex items-center gap-0.5 bg-app-hover/50 rounded-lg px-1 py-0.5">
            <Button
              variant="ghost" size="icon" className="h-7 w-7 rounded-md"
              onClick={toggleLock}
              title={activeNote.isLocked ? t('editor.unlockTooltip') : t('editor.lockTooltip')}
            >
              {activeNote.isLocked
                ? <Lock size={14} className="text-orange-500" />
                : <Unlock size={14} />}
            </Button>
            <Button
              variant="ghost" size="icon" className="h-7 w-7 rounded-md"
              onClick={togglePin}
              title={activeNote.isPinned ? t('editor.unpinTooltip') : t('editor.pinTooltip')}
            >
              <Pin size={14} className={cn(activeNote.isPinned && "text-accent-primary fill-accent-primary")} />
            </Button>
            <Button
              variant="ghost" size="icon" className="h-7 w-7 rounded-md"
              onClick={toggleFavorite}
              title={activeNote.isFavorite ? t('editor.unfavoriteTooltip') : t('editor.favoriteTooltip')}
            >
              <Star size={14} className={cn(activeNote.isFavorite && "text-amber-400 fill-amber-400")} />
            </Button>
            <Button
              variant="ghost" size="icon" className="h-7 w-7 rounded-md"
              onClick={moveToTrash}
              title={t('editor.trashTooltip')}
              disabled={!!activeNote.isLocked}
            >
              <Trash2 size={14} className={cn(activeNote.isLocked && "opacity-30")} />
            </Button>
          </div>

          {/* 大纲 */}
          <Button
            variant="ghost" size="icon" className="h-7 w-7"
            onClick={() => setShowOutline(!showOutline)}
            title={showOutline ? t('editor.hideOutline') : t('editor.showOutline')}
          >
            <ListTree size={14} className={cn(showOutline && "text-accent-primary")} />
          </Button>

          {/* 分享 */}
          <Button
            variant="ghost" size="icon" className="h-7 w-7"
            onClick={() => setShowShareModal(true)}
            title="分享笔记"
          >
            <Share2 size={14} className="text-emerald-500" />
          </Button>

          {/* 版本历史 */}
          <Button
            variant="ghost" size="icon" className="h-7 w-7"
            onClick={() => setShowVersionHistory(true)}
            title="版本历史"
          >
            <History size={14} className="text-violet-500" />
          </Button>

          {/* 评论批注 */}
          <Button
            variant="ghost" size="icon" className="h-7 w-7"
            onClick={() => setShowCommentPanel(true)}
            title="评论批注"
          >
            <MessageCircle size={14} className="text-blue-500" />
          </Button>

          <div className="w-px h-4 bg-app-border" />

          {/* AI 工具组 */}
          <div className="flex items-center gap-0.5 bg-violet-500/5 dark:bg-violet-500/10 rounded-lg px-1 py-0.5">
            <Button
              variant="ghost" size="icon" className="h-7 w-7 rounded-md"
              onClick={handleAITitle}
              disabled={aiTitleLoading || !activeNote.contentText || !!activeNote.isLocked}
              title={t('editor.aiGenerateTitle')}
            >
              {aiTitleLoading ? <Loader2 size={14} className="animate-spin text-violet-500" /> : <Type size={14} className="text-violet-500" />}
            </Button>
            <Button
              variant="ghost" size="icon" className="h-7 w-7 rounded-md"
              onClick={handleAITags}
              disabled={aiTagsLoading || !activeNote.contentText || !!activeNote.isLocked}
              title={t('editor.aiSuggestTags')}
            >
              {aiTagsLoading ? <Loader2 size={14} className="animate-spin text-violet-500" /> : <TagIcon size={14} className="text-violet-500" />}
            </Button>
          </div>
        </div>
      </div>

      {/* Tiptap Editor + Outline */}
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 overflow-hidden">
          <TiptapEditor
            note={activeNote}
            onUpdate={handleUpdate}
            onTagsChange={handleTagsChange}
            onHeadingsChange={setHeadings}
            onEditorReady={(fn) => { scrollToRef.current = fn; }}
            editable={!activeNote.isLocked}
          />
        </div>
      {/* 分享弹窗 */}
      {showShareModal && (
        <ShareModal
          noteId={activeNote.id}
          noteTitle={activeNote.title}
          onClose={() => setShowShareModal(false)}
        />
      )}

      {/* 版本历史 */}
      {showVersionHistory && (
        <VersionHistoryPanel
          noteId={activeNote.id}
          noteTitle={activeNote.title}
          onRestore={(updated) => {
            actions.setActiveNote(updated);
            actions.updateNoteInList({ id: updated.id, title: updated.title, contentText: updated.contentText, updatedAt: updated.updatedAt });
          }}
          onClose={() => setShowVersionHistory(false)}
        />
      )}

      {/* 评论面板 */}
      {showCommentPanel && (
        <CommentPanel
          noteId={activeNote.id}
          noteTitle={activeNote.title}
          onClose={() => setShowCommentPanel(false)}
        />
      )}

      {/* Delete 键删除确认弹窗 */}
      <AnimatePresence>
        {showDeleteConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
            onClick={() => setShowDeleteConfirm(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-app-surface border border-app-border rounded-xl shadow-2xl p-6 max-w-sm mx-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center">
                  <Trash2 size={18} className="text-red-500" />
                </div>
                <h3 className="text-base font-semibold text-tx-primary">{t('sidebar.deleteNoteTitle')}</h3>
              </div>
              <p className="text-sm text-tx-secondary mb-5">{t('sidebar.deleteNoteConfirm')}</p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="px-4 py-2 text-sm rounded-lg bg-app-hover text-tx-secondary hover:bg-app-active transition-colors"
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={() => {
                    setShowDeleteConfirm(false);
                    moveToTrash();
                  }}
                  className="px-4 py-2 text-sm rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors"
                >
                  {t('sidebar.confirmDeleteNote')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {showOutline && (
          <OutlinePanel
            headings={headings}
            onSelect={(pos) => scrollToRef.current?.(pos)}
            onClose={() => setShowOutline(false)}
          />
        )}
      </div>
    </motion.div>
  );
}

/* ===== 大纲面板 ===== */
function OutlinePanel({
  headings,
  onSelect,
  onClose,
}: {
  headings: HeadingItem[];
  onSelect: (pos: number) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="hidden md:flex flex-col w-56 min-w-[200px] border-l border-app-border bg-app-surface/50 transition-colors">
      <div className="flex items-center justify-between px-3 py-2 border-b border-app-border">
        <div className="flex items-center gap-1.5 text-xs font-medium text-tx-secondary">
          <ListTree size={13} className="text-accent-primary" />
          <span>{t('editor.outline')}</span>
        </div>
        <button
          onClick={onClose}
          className="p-0.5 rounded hover:bg-app-hover text-tx-tertiary hover:text-tx-secondary transition-colors"
        >
          <X size={13} />
        </button>
      </div>
      <ScrollArea className="flex-1">
        <div className="py-1">
          {headings.length === 0 ? (
            <div className="px-3 py-6 text-center">
              <p className="text-[11px] text-tx-tertiary">{t('editor.noHeadings')}</p>
              <p className="text-[10px] text-tx-tertiary mt-1">{t('editor.noHeadingsHint')}</p>
            </div>
          ) : (
            headings.map((h) => (
              <button
                key={h.id}
                onClick={() => onSelect(h.pos)}
                className={cn(
                  "w-full text-left px-3 py-1.5 text-xs transition-colors hover:bg-app-hover truncate",
                  h.level === 1 && "font-medium text-tx-primary",
                  h.level === 2 && "text-tx-secondary",
                  h.level === 3 && "text-tx-tertiary",
                )}
                style={{ paddingLeft: `${(h.level - 1) * 12 + 12}px` }}
                title={h.text}
              >
                <span className={cn(
                  "inline-block w-1.5 h-1.5 rounded-full mr-2 shrink-0 align-middle",
                  h.level === 1 && "bg-accent-primary",
                  h.level === 2 && "bg-accent-primary/50",
                  h.level === 3 && "bg-tx-tertiary/50",
                )} />
                {h.text || t('editor.untitled')}
              </button>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

/* ===== 笔记本树构建（与 Sidebar.tsx 的 buildTree 完全一致） ===== */
function buildTree(notebooks: Notebook[]): Notebook[] {
  const map = new Map<string, Notebook>();
  const roots: Notebook[] = [];
  notebooks.forEach((nb) => map.set(nb.id, { ...nb, children: [] }));
  notebooks.forEach((nb) => {
    const node = map.get(nb.id)!;
    if (nb.parentId && map.has(nb.parentId)) {
      map.get(nb.parentId)!.children!.push(node);
    } else {
      roots.push(node);
    }
  });
  // 按 sortOrder 稳定排序，确保拖拽后的新顺序立即反映到 UI
  const byOrder = (a: Notebook, b: Notebook) =>
    (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
  const sortRecursive = (list: Notebook[]) => {
    list.sort(byOrder);
    list.forEach((n) => {
      if (n.children && n.children.length > 0) sortRecursive(n.children);
    });
  };
  sortRecursive(roots);
  return roots;
}

/* 从根到指定 id 的完整路径（含自身），用于面包屑展示 */
function findPathById(notebooks: Notebook[], id: string | null | undefined): Notebook[] {
  if (!id) return [];
  const byId = new Map(notebooks.map((n) => [n.id, n]));
  const path: Notebook[] = [];
  let cursor: string | null | undefined = id;
  const visited = new Set<string>();
  while (cursor) {
    if (visited.has(cursor)) break;
    visited.add(cursor);
    const nb = byId.get(cursor);
    if (!nb) break;
    path.unshift(nb);
    cursor = nb.parentId ?? null;
  }
  return path;
}

/* ===== 编辑器顶部"移动笔记本"树形条目（与侧边栏目录结构保持一致） ===== */
function MoveTreeItem({
  notebook, depth, currentId, onSelect,
}: {
  notebook: Notebook;
  depth: number;
  currentId: string;
  onSelect: (id: string) => void;
}) {
  const hasChildren = !!notebook.children && notebook.children.length > 0;
  // 默认展开：若自身或子孙中包含当前笔记，则展开；否则折叠
  const containsCurrent = useMemo(() => {
    const stack: Notebook[] = [notebook];
    while (stack.length) {
      const n = stack.pop()!;
      if (n.id === currentId) return true;
      if (n.children) stack.push(...n.children);
    }
    return false;
  }, [notebook, currentId]);
  const [expanded, setExpanded] = useState(containsCurrent || depth === 0);
  const isCurrent = notebook.id === currentId;
  const { t } = useTranslation();

  return (
    <div>
      <button
        disabled={isCurrent}
        onClick={() => !isCurrent && onSelect(notebook.id)}
        className={cn(
          "w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-sm transition-colors",
          isCurrent
            ? "opacity-40 cursor-not-allowed text-tx-tertiary"
            : "text-tx-secondary hover:bg-app-hover hover:text-tx-primary"
        )}
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
      >
        {hasChildren ? (
          <span
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
            className="w-4 h-4 flex items-center justify-center shrink-0 cursor-pointer hover:text-tx-primary"
          >
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
        ) : (
          <span className="w-4 h-4 shrink-0" />
        )}
        <span className="text-base shrink-0">{notebook.icon || "📁"}</span>
        <span className="truncate flex-1 text-left">{notebook.name}</span>
        {isCurrent && (
          <span className="ml-auto text-[10px] text-tx-tertiary shrink-0">{t('common.current')}</span>
        )}
      </button>
      {hasChildren && expanded && notebook.children!.map((child) => (
        <MoveTreeItem
          key={child.id}
          notebook={child}
          depth={depth + 1}
          currentId={currentId}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

/* ===== 同步状态指示器 ===== */
function SyncIndicator({
  syncStatus,
  lastSyncedAt,
  onManualSync,
}: {
  syncStatus: SyncStatus;
  lastSyncedAt: string | null;
  onManualSync: () => void;
}) {
  const { t } = useTranslation();
  const getTooltip = () => {
    switch (syncStatus) {
      case "saving": return t('editor.saving');
      case "saved": return t('editor.allSaved');
      case "error": return t('editor.saveFailed');
      default:
        if (lastSyncedAt) {
          const diff = Date.now() - new Date(lastSyncedAt).getTime();
          if (diff < 10_000) return t('editor.justSaved');
          if (diff < 60_000) return t('editor.savedSecondsAgo', { count: Math.floor(diff / 1000) });
          if (diff < 3600_000) return t('editor.savedMinutesAgo', { count: Math.floor(diff / 60_000) });
          return t('editor.savedHoursAgo', { count: Math.floor(diff / 3600_000) });
        }
        return t('editor.clickToSync');
    }
  };

  return (
    <button
      onClick={onManualSync}
      disabled={syncStatus === "saving"}
      title={getTooltip()}
      className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] transition-colors hover:bg-app-hover group"
    >
      <AnimatePresence mode="wait">
        {syncStatus === "saving" && (
          <motion.div
            key="saving"
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1, rotate: 360 }}
            exit={{ opacity: 0, scale: 0.5 }}
            transition={{ rotate: { repeat: Infinity, duration: 1, ease: "linear" }, opacity: { duration: 0.15 } }}
          >
            <RefreshCw size={13} className="text-accent-primary" />
          </motion.div>
        )}
        {syncStatus === "saved" && (
          <motion.div
            key="saved"
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: [1.3, 1] }}
            exit={{ opacity: 0, scale: 0.5 }}
            transition={{ duration: 0.25 }}
          >
            <Check size={13} className="text-green-500" />
          </motion.div>
        )}
        {syncStatus === "error" && (
          <motion.div
            key="error"
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.5 }}
            transition={{ duration: 0.15 }}
          >
            <CloudOff size={13} className="text-red-500" />
          </motion.div>
        )}
        {syncStatus === "idle" && (
          <motion.div
            key="idle"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <Cloud size={13} className="text-tx-tertiary group-hover:text-tx-secondary transition-colors" />
          </motion.div>
        )}
      </AnimatePresence>

      <span className={cn(
        "hidden sm:inline transition-colors",
        syncStatus === "saving" && "text-accent-primary",
        syncStatus === "saved" && "text-green-500",
        syncStatus === "error" && "text-red-500",
        syncStatus === "idle" && "text-tx-tertiary group-hover:text-tx-secondary",
      )}>
        {syncStatus === "saving" && t('editor.savingStatus')}
        {syncStatus === "saved" && t('editor.savedStatus')}
        {syncStatus === "error" && t('editor.saveFailedStatus')}
        {syncStatus === "idle" && (lastSyncedAt ? t('editor.synced') : t('editor.sync'))}
      </span>
    </button>
  );
}
