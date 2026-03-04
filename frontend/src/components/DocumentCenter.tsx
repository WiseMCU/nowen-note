import React, { useState, useEffect, useCallback, useRef, Suspense } from "react";
import {
  FileText, Table, Plus, Trash2, Edit2,
  Loader2, Upload, Download, Search, X,
  CheckSquare, Square, Menu,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { DocumentListItem, DocType } from "@/types";
import { cn } from "@/lib/utils";
import { useAppActions } from "@/store/AppContext";

// 动态导入编辑器组件，避免 Sheets 和 Docs preset 的 facade 扩展互相干扰
// （静态导入会导致两个 preset 的 FUniver.extend() 同时执行，
//   使 Doc 编辑器初始化时触发 Sheet 专属依赖的 QuantityCheckError）
const UniverDocEditor = React.lazy(() => import("./UniverDocEditor"));
const UniverSheetEditor = React.lazy(() => import("./UniverSheetEditor"));

// 文档类型图标和颜色映射（移除 slide）
const DOC_TYPE_CONFIG: Record<string, { icon: typeof FileText; color: string; label: string }> = {
  word: { icon: FileText, color: "text-blue-500", label: "Word" },
  cell: { icon: Table, color: "text-green-500", label: "Excel" },
};

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + " " + units[i];
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr + "Z");
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return date.toLocaleDateString();
}

// ========== 文档中心主组件 ==========
export default function DocumentCenter() {
  const { t } = useTranslation();
  const actions = useAppActions();
  const [documents, setDocuments] = useState<DocumentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [batchMode, setBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [showCreateMenu, setShowCreateMenu] = useState(false);
  const [openDoc, setOpenDoc] = useState<{ id: string; title: string; docType: DocType } | null>(null);
  const createMenuRef = useRef<HTMLDivElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadDocuments = useCallback(async () => {
    setLoading(true);
    try {
      const docs = await api.getDocuments(filter);
      setDocuments(docs);
    } catch (err) {
      console.error("Failed to load documents:", err);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { loadDocuments(); }, [loadDocuments]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (createMenuRef.current && !createMenuRef.current.contains(e.target as Node)) {
        setShowCreateMenu(false);
      }
    }
    if (showCreateMenu) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showCreateMenu]);

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  const filteredDocs = searchQuery.trim()
    ? documents.filter((d) => d.title.toLowerCase().includes(searchQuery.toLowerCase()))
    : documents;

  const handleCreate = async (docType: DocType) => {
    setShowCreateMenu(false);
    try {
      const doc = await api.createDocument({ docType });
      setDocuments((prev) => [doc as any, ...prev]);
      setOpenDoc({ id: doc.id, title: doc.title, docType: doc.docType });
    } catch (err: any) {
      console.error("Create failed:", err);
    }
  };

  const handleUpload = async (files: FileList) => {
    for (const file of Array.from(files)) {
      try {
        const doc = await api.uploadDocument(file);
        setDocuments((prev) => [doc as any, ...prev]);
      } catch (err: any) {
        console.error("Upload failed:", err);
      }
    }
  };

  const handleRename = async () => {
    if (!editingId || !editTitle.trim()) {
      setEditingId(null);
      return;
    }
    try {
      await api.updateDocument(editingId, { title: editTitle.trim() });
      setDocuments((prev) =>
        prev.map((d) => (d.id === editingId ? { ...d, title: editTitle.trim() } : d))
      );
      if (openDoc && openDoc.id === editingId) {
        setOpenDoc({ ...openDoc, title: editTitle.trim() });
      }
    } catch (err) {
      console.error("Rename failed:", err);
    }
    setEditingId(null);
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteDocument(id);
      setDocuments((prev) => prev.filter((d) => d.id !== id));
      if (openDoc?.id === id) setOpenDoc(null);
    } catch (err) {
      console.error("Delete failed:", err);
    }
  };

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    try {
      await api.batchDeleteDocuments(Array.from(selectedIds));
      setDocuments((prev) => prev.filter((d) => !selectedIds.has(d.id)));
      setSelectedIds(new Set());
      setBatchMode(false);
    } catch (err) {
      console.error("Batch delete failed:", err);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === filteredDocs.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredDocs.map((d) => d.id)));
    }
  };

  // 打开文档编辑器
  if (openDoc) {
    const editorFallback = (
      <div className="flex-1 flex items-center justify-center bg-app-bg">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-accent-primary" />
        </div>
      </div>
    );

    if (openDoc.docType === "cell") {
      return (
        <Suspense fallback={editorFallback}>
          <UniverSheetEditor
            documentId={openDoc.id}
            title={openDoc.title}
            onBack={() => { setOpenDoc(null); loadDocuments(); }}
          />
        </Suspense>
      );
    }
    return (
      <Suspense fallback={editorFallback}>
        <UniverDocEditor
          documentId={openDoc.id}
          title={openDoc.title}
          onBack={() => { setOpenDoc(null); loadDocuments(); }}
        />
      </Suspense>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-app-bg">
      {/* 顶栏 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-app-border bg-app-surface/50 shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => actions.setMobileSidebar(true)}
            className="p-1.5 -ml-1.5 rounded-md text-tx-secondary hover:bg-app-hover md:hidden"
          >
            <Menu size={22} />
          </button>
          <h2 className="text-base font-semibold text-tx-primary">{t("documents.title")}</h2>
          <span className="text-xs text-tx-tertiary">
            {t("documents.totalCount", { count: documents.length })}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {batchMode ? (
            <>
              <button
                onClick={selectAll}
                className="px-3 py-1.5 text-xs text-tx-secondary hover:text-tx-primary hover:bg-app-hover rounded-md transition-colors"
              >
                {selectedIds.size === filteredDocs.length ? t("documents.deselectAll") : t("documents.selectAll")}
              </button>
              <button
                onClick={handleBatchDelete}
                disabled={selectedIds.size === 0}
                className="px-3 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-40 rounded-md transition-colors"
              >
                {t("documents.deleteSelected", { count: selectedIds.size })}
              </button>
              <button
                onClick={() => { setBatchMode(false); setSelectedIds(new Set()); }}
                className="px-3 py-1.5 text-xs text-tx-secondary hover:text-tx-primary hover:bg-app-hover rounded-md transition-colors"
              >
                {t("common.cancel")}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="p-2 rounded-md text-tx-secondary hover:text-tx-primary hover:bg-app-hover transition-colors"
                title={t("documents.upload")}
              >
                <Upload size={16} />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".docx,.doc,.xlsx,.xls,.csv,.odt,.rtf,.txt"
                className="hidden"
                multiple
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    handleUpload(e.target.files);
                    e.target.value = "";
                  }
                }}
              />
              <div className="relative" ref={createMenuRef}>
                <button
                  onClick={() => setShowCreateMenu(!showCreateMenu)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-accent-primary hover:bg-accent-hover rounded-md transition-colors"
                >
                  <Plus size={14} />
                  {t("documents.create")}
                </button>
                {showCreateMenu && (
                  <div className="absolute right-0 top-full mt-1 w-48 py-1 bg-white dark:bg-zinc-900 rounded-lg shadow-xl border border-app-border z-50">
                    {(["word", "cell"] as DocType[]).map((type) => {
                      const config = DOC_TYPE_CONFIG[type];
                      if (!config) return null;
                      const Icon = config.icon;
                      return (
                        <button
                          key={type}
                          onClick={() => handleCreate(type)}
                          className="w-full flex items-center gap-3 px-3 py-2 text-sm text-tx-secondary hover:text-tx-primary hover:bg-app-hover transition-colors"
                        >
                          <Icon size={16} className={config.color} />
                          {t(`documents.type_${type}`)}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* 工具栏 */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-app-border shrink-0">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-tx-tertiary" size={14} />
          <input
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-app-bg border border-app-border rounded-md outline-none focus:border-accent-primary text-tx-primary placeholder:text-tx-tertiary"
            placeholder={t("documents.searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-tx-tertiary hover:text-tx-secondary">
              <X size={12} />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1">
          {["all", "word", "cell"].map((type) => (
            <button
              key={type}
              onClick={() => setFilter(type)}
              className={cn(
                "px-2.5 py-1 text-xs rounded-md transition-colors",
                filter === type
                  ? "bg-accent-primary/10 text-accent-primary font-medium"
                  : "text-tx-secondary hover:text-tx-primary hover:bg-app-hover"
              )}
            >
              {type === "all" ? t("documents.filterAll") : t(`documents.type_${type}`)}
            </button>
          ))}
        </div>
        {!batchMode && documents.length > 0 && (
          <button
            onClick={() => setBatchMode(true)}
            className="px-2.5 py-1 text-xs text-tx-tertiary hover:text-tx-secondary hover:bg-app-hover rounded-md transition-colors"
          >
            {t("documents.batchManage")}
          </button>
        )}
      </div>

      {/* 文档列表 */}
      <div className="flex-1 overflow-auto px-4 py-3">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-tx-tertiary" />
          </div>
        ) : filteredDocs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-tx-tertiary">
            <FileText size={48} className="mb-3 opacity-30" />
            <p className="text-sm">{t("documents.empty")}</p>
            <p className="text-xs mt-1">{t("documents.createFirst")}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {filteredDocs.map((doc) => {
              const config = DOC_TYPE_CONFIG[doc.docType] || DOC_TYPE_CONFIG.word;
              const Icon = config.icon;
              const isSelected = selectedIds.has(doc.id);
              const isEditing = editingId === doc.id;

              return (
                <div
                  key={doc.id}
                  className={cn(
                    "group relative flex flex-col p-4 rounded-xl border transition-all cursor-pointer",
                    isSelected
                      ? "border-accent-primary bg-accent-primary/5"
                      : "border-app-border bg-app-surface hover:border-accent-primary/50 hover:shadow-sm"
                  )}
                  onClick={() => {
                    if (batchMode) {
                      toggleSelect(doc.id);
                    } else {
                      setOpenDoc({ id: doc.id, title: doc.title, docType: doc.docType });
                    }
                  }}
                >
                  {batchMode && (
                    <div className="absolute top-2 left-2 z-10">
                      {isSelected ? (
                        <CheckSquare size={18} className="text-accent-primary" />
                      ) : (
                        <Square size={18} className="text-tx-tertiary" />
                      )}
                    </div>
                  )}

                  {!batchMode && (
                    <div className="absolute top-2 right-2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingId(doc.id);
                          setEditTitle(doc.title);
                        }}
                        className="p-1 rounded text-tx-tertiary hover:text-tx-primary hover:bg-app-hover transition-colors"
                        title={t("common.rename")}
                      >
                        <Edit2 size={13} />
                      </button>
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          try {
                            const buf = await api.getDocumentContent(doc.id);
                            const blob = new Blob([buf]);
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement("a");
                            a.href = url;
                            a.download = doc.title;
                            a.click();
                            URL.revokeObjectURL(url);
                          } catch (err) {
                            console.error("Download failed:", err);
                          }
                        }}
                        className="p-1 rounded text-tx-tertiary hover:text-tx-primary hover:bg-app-hover transition-colors"
                        title={t("documents.download")}
                      >
                        <Download size={13} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(doc.id);
                        }}
                        className="p-1 rounded text-tx-tertiary hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                        title={t("common.delete")}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}

                  <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center mb-3",
                    doc.docType === "word" ? "bg-blue-50 dark:bg-blue-900/20" : "bg-green-50 dark:bg-green-900/20"
                  )}>
                    <Icon size={22} className={config.color} />
                  </div>

                  {isEditing ? (
                    <input
                      ref={editInputRef}
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleRename();
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      onBlur={handleRename}
                      onClick={(e) => e.stopPropagation()}
                      className="text-sm font-medium text-tx-primary bg-transparent border border-accent-primary/50 rounded px-1 py-0.5 outline-none mb-1"
                    />
                  ) : (
                    <h3 className="text-sm font-medium text-tx-primary truncate mb-1" title={doc.title}>
                      {doc.title}
                    </h3>
                  )}

                  <div className="flex items-center gap-2 text-[10px] text-tx-tertiary mt-auto">
                    <span>{t(`documents.type_${doc.docType}`)}</span>
                    <span>·</span>
                    <span>{formatFileSize(doc.fileSize)}</span>
                    <span>·</span>
                    <span>{formatTime(doc.updatedAt)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
