import React, { useCallback, useRef, useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  BookOpen,
  Loader2,
  CheckCircle,
  AlertCircle,
  CloudUpload,
  FileText,
  FolderOpen,
  Trash2,
  Image as ImageIcon,
  Paperclip,
  HelpCircle,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  scanYoudaoExport,
  runYoudaoImport,
  formatFileSize,
  YoudaoEntry,
  YoudaoScanResult,
  YoudaoEntryKind,
} from "@/lib/youdaoNoteService";
import { ImportProgress } from "@/lib/importService";
import { useAppActions } from "@/store/AppContext";
import { api } from "@/lib/api";

type Phase = "idle" | "scanning" | "ready" | "importing" | "done" | "error";

const KIND_LABELS: Record<YoudaoEntryKind, string> = {
  "note-md": "Markdown",
  "note-txt": "文本",
  "note-html": "HTML",
  "note-docx": "Word",
  "note-bookmark": "书签",
  "note-failure-notice": "导入说明",
  attachment: "附件",
  image: "图片",
  skipped: "跳过",
};

function KindIcon({ kind }: { kind: YoudaoEntryKind }) {
  if (kind === "image") return <ImageIcon size={12} className="text-emerald-500" />;
  if (kind === "attachment") return <Paperclip size={12} className="text-zinc-500" />;
  if (kind === "skipped")
    return <Trash2 size={12} className="text-zinc-300 dark:text-zinc-600" />;
  return <FileText size={12} className="text-indigo-500" />;
}

export default function YoudaoImport() {
  const { t } = useTranslation();
  const actions = useAppActions();

  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState("");
  const [scan, setScan] = useState<YoudaoScanResult | null>(null);
  const [rootName, setRootName] = useState("");
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [importedNote, setImportedNote] = useState(0);
  const [importedAttach, setImportedAttach] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [showErrors, setShowErrors] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  // 触发选目录
  const triggerPick = useCallback(() => {
    if (inputRef.current) {
      inputRef.current.value = "";
      inputRef.current.click();
    }
  }, []);

  // 用户选了目录
  const handlePick = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;
      setPhase("scanning");
      setMessage(t("youdao.scanning"));
      setErrors([]);
      setProgress(null);

      // 同步执行（scan 是纯计算，不读文件内容）
      try {
        const result = scanYoudaoExport(files);
        setScan(result);
        // rootName 默认用 webkit 顶层（去掉时间戳后缀），用户可改
        if (!rootName) {
          const guessed = guessFriendlyRootName(result.rootFolderName);
          setRootName(guessed);
        }
        setPhase("ready");
        setMessage(
          t("youdao.scanResult", {
            notes: result.stats.notes,
            attachments: result.stats.attachments,
            skipped: result.stats.skipped,
          }),
        );
      } catch (err: any) {
        setPhase("error");
        setMessage(err?.message || t("youdao.scanFailed"));
      }
    },
    [t, rootName],
  );

  // 选择 / 取消选择全部
  const toggleAll = useCallback(
    (kind?: YoudaoEntryKind) => {
      if (!scan) return;
      const target = kind ? scan.entries.filter((e) => e.kind === kind) : scan.entries;
      const allSelected = target.every((e) => e.selected);
      const updated = scan.entries.map((e) => {
        if (kind && e.kind !== kind) return e;
        if (e.kind === "skipped") return e;
        return { ...e, selected: !allSelected };
      });
      setScan({ ...scan, entries: updated });
    },
    [scan],
  );

  const toggleOne = useCallback(
    (relPath: string) => {
      if (!scan) return;
      const updated = scan.entries.map((e) =>
        e.relPath === relPath ? { ...e, selected: !e.selected } : e,
      );
      setScan({ ...scan, entries: updated });
    },
    [scan],
  );

  // 重置
  const handleReset = useCallback(() => {
    setScan(null);
    setPhase("idle");
    setMessage("");
    setProgress(null);
    setErrors([]);
    setImportedNote(0);
    setImportedAttach(0);
  }, []);

  // 开始导入
  const handleImport = useCallback(async () => {
    if (!scan) return;
    const selected = scan.entries.filter((e) => e.selected && e.kind !== "skipped");
    if (selected.length === 0) {
      setMessage(t("youdao.noFilesSelected"));
      return;
    }
    setPhase("importing");
    setMessage(t("youdao.importing", { count: selected.length }));

    try {
      const res = await runYoudaoImport(scan, {
        rootName,
        onProgress: (p) => setProgress(p),
      });
      setImportedNote(res.noteCount);
      setImportedAttach(res.attachmentCount);
      setErrors(res.errors);
      setPhase(res.success && res.errors.length === 0 ? "done" : "error");
      setMessage(
        res.errors.length === 0
          ? t("youdao.importSuccess", {
              notes: res.noteCount,
              attachments: res.attachmentCount,
            })
          : t("youdao.importPartial", {
              notes: res.noteCount,
              attachments: res.attachmentCount,
              errors: res.errors.length,
            }),
      );
      // 刷新笔记本列表
      try {
        const nbs = await api.getNotebooks();
        actions.setNotebooks(nbs);
      } catch (_e) {
        /* ignore */
      }
    } catch (err: any) {
      setPhase("error");
      setMessage(err?.message || t("youdao.importFailed"));
    }
  }, [scan, rootName, t, actions]);

  // 派生数据
  const grouped = useMemo(() => {
    if (!scan) return null;
    const map = new Map<YoudaoEntryKind, YoudaoEntry[]>();
    for (const e of scan.entries) {
      const arr = map.get(e.kind) || [];
      arr.push(e);
      map.set(e.kind, arr);
    }
    return map;
  }, [scan]);

  const selectedCount = scan ? scan.entries.filter((e) => e.selected).length : 0;

  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <BookOpen size={18} className="text-rose-500" />
        <h4 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          {t("youdao.title")}
        </h4>
      </div>

      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30 p-4">
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-3">
          {t("youdao.description")}
        </p>

        {/* 操作说明（折叠） */}
        <div className="mb-3">
          <button
            onClick={() => setShowHelp((v) => !v)}
            className="text-xs text-rose-500 hover:text-rose-600 dark:hover:text-rose-400 inline-flex items-center gap-1"
          >
            <HelpCircle size={12} />
            {t("youdao.howToExport")}
          </button>
          <AnimatePresence>
            {showHelp && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="mt-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/30 text-xs text-zinc-600 dark:text-zinc-400 space-y-1.5">
                  <p className="font-medium text-amber-700 dark:text-amber-400">
                    {t("youdao.helpTitle")}
                  </p>
                  <ol className="list-decimal list-inside space-y-1 ml-1">
                    <li>{t("youdao.helpStep1")}</li>
                    <li>{t("youdao.helpStep2")}</li>
                    <li>{t("youdao.helpStep3")}</li>
                    <li>{t("youdao.helpStep4")}</li>
                  </ol>
                  <p className="text-amber-600 dark:text-amber-400 mt-1">
                    {t("youdao.helpTip")}
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* 选目录 */}
        {phase === "idle" && (
          <div>
            <input
              ref={inputRef}
              type="file"
              multiple
              // @ts-ignore - webkitdirectory 不在 React 类型里
              webkitdirectory=""
              directory=""
              className="hidden"
              onChange={handlePick}
            />
            <button
              onClick={triggerPick}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg font-medium text-sm bg-rose-500 hover:bg-rose-600 text-white shadow-md hover:shadow-lg transition-all"
            >
              <FolderOpen size={16} />
              {t("youdao.pickFolder")}
            </button>
          </div>
        )}

        {/* 扫描中 */}
        {phase === "scanning" && (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-zinc-500 dark:text-zinc-400">
            <Loader2 size={16} className="animate-spin text-rose-500" />
            {message}
          </div>
        )}

        {/* 扫描结果 */}
        {scan && (phase === "ready" || phase === "importing" || phase === "done" || phase === "error") && (
          <div className="space-y-3">
            {/* 根笔记本名 */}
            <div>
              <label className="text-xs text-zinc-500 dark:text-zinc-400 mb-1 block">
                {t("youdao.rootNotebookLabel")}
              </label>
              <input
                type="text"
                value={rootName}
                onChange={(e) => setRootName(e.target.value)}
                disabled={phase === "importing"}
                className="w-full text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 px-3 py-1.5 outline-none focus:ring-2 focus:ring-rose-500/30 focus:border-rose-500 disabled:opacity-60"
                placeholder={t("youdao.rootNotebookPlaceholder")}
              />
              <p className="text-[11px] text-zinc-400 dark:text-zinc-600 mt-1">
                {t("youdao.rootNotebookHint")}
              </p>
            </div>

            {/* 统计概览 */}
            <div className="grid grid-cols-4 gap-2 text-xs">
              <StatCard
                color="rose"
                label={t("youdao.statNotes")}
                value={scan.stats.notes}
              />
              <StatCard
                color="amber"
                label={t("youdao.statAttachments")}
                value={scan.stats.attachments}
              />
              <StatCard
                color="zinc"
                label={t("youdao.statSkipped")}
                value={scan.stats.skipped}
              />
              <StatCard
                color="indigo"
                label={t("youdao.statTotal")}
                value={formatFileSize(scan.stats.totalBytes)}
              />
            </div>

            {/* 文件分组列表 */}
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 max-h-72 overflow-y-auto">
              {grouped &&
                Array.from(grouped.entries())
                  .filter(([k]) => k !== "skipped")
                  .map(([kind, items]) => (
                    <FileGroup
                      key={kind}
                      kind={kind}
                      items={items}
                      onToggleAll={() => toggleAll(kind)}
                      onToggleOne={toggleOne}
                      disabled={phase === "importing"}
                    />
                  ))}
            </div>

            {/* 全选 / 反选 */}
            <div className="flex items-center justify-between text-xs">
              <button
                onClick={() => toggleAll()}
                disabled={phase === "importing"}
                className="text-rose-500 hover:text-rose-600 dark:hover:text-rose-400 font-medium disabled:opacity-40"
              >
                {scan.entries.filter((e) => e.kind !== "skipped").every((e) => e.selected)
                  ? t("dataManager.deselectAll")
                  : t("dataManager.selectAll")}
              </button>
              <span className="text-zinc-400 dark:text-zinc-600">
                {t("dataManager.selectedCount", {
                  selected: selectedCount,
                  total: scan.entries.filter((e) => e.kind !== "skipped").length,
                })}
              </span>
            </div>

            {/* 进度 */}
            {progress && phase === "importing" && (
              <div className="rounded-lg bg-rose-50 dark:bg-rose-900/10 border border-rose-200 dark:border-rose-800/30 p-3">
                <div className="flex items-center justify-between text-xs text-rose-700 dark:text-rose-400 mb-1">
                  <span>{progress.message}</span>
                  <span>
                    {progress.current} / {progress.total}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-rose-100 dark:bg-rose-900/30 overflow-hidden">
                  <div
                    className="h-full bg-rose-500 transition-all"
                    style={{
                      width:
                        progress.total > 0
                          ? `${Math.min(100, (progress.current / progress.total) * 100)}%`
                          : "0%",
                    }}
                  />
                </div>
              </div>
            )}

            {/* 状态 */}
            {message && (phase === "ready" || phase === "importing" || phase === "done" || phase === "error") && (
              <div className="flex items-start gap-2 text-sm">
                {phase === "error" ? (
                  <AlertCircle size={14} className="text-red-500 mt-0.5" />
                ) : phase === "done" ? (
                  <CheckCircle size={14} className="text-green-500 mt-0.5" />
                ) : phase === "importing" ? (
                  <Loader2 size={14} className="text-rose-500 animate-spin mt-0.5" />
                ) : null}
                <span className="text-zinc-600 dark:text-zinc-400">{message}</span>
              </div>
            )}

            {/* 错误明细折叠 */}
            {errors.length > 0 && (
              <div>
                <button
                  onClick={() => setShowErrors((v) => !v)}
                  className="text-xs text-red-500 hover:text-red-600 dark:hover:text-red-400"
                >
                  {showErrors
                    ? t("youdao.hideErrors")
                    : t("youdao.showErrors", { count: errors.length })}
                </button>
                {showErrors && (
                  <ul className="mt-2 max-h-32 overflow-y-auto text-[11px] text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/10 rounded p-2 space-y-0.5">
                    {errors.map((e, i) => (
                      <li key={i} className="break-all">
                        {e}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* 操作按钮 */}
            <div className="flex gap-2">
              <button
                onClick={handleReset}
                disabled={phase === "importing"}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg font-medium text-sm border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40"
              >
                {t("youdao.resetButton")}
              </button>
              <button
                onClick={handleImport}
                disabled={phase === "importing" || phase === "done" || selectedCount === 0}
                className={`flex-[2] flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg font-medium text-sm transition-all ${
                  phase === "importing" || selectedCount === 0
                    ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-600 cursor-not-allowed"
                    : phase === "done"
                    ? "bg-green-500 text-white"
                    : "bg-rose-500 hover:bg-rose-600 text-white shadow-md hover:shadow-lg"
                }`}
              >
                {phase === "importing" ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    {t("youdao.importing", { count: selectedCount })}
                  </>
                ) : phase === "done" ? (
                  <>
                    <CheckCircle size={16} />
                    {t("youdao.importSuccess", {
                      notes: importedNote,
                      attachments: importedAttach,
                    })}
                  </>
                ) : (
                  <>
                    <CloudUpload size={16} />
                    {t("youdao.importButton", { count: selectedCount })}
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

// ========== 子组件 ==========

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number | string;
  color: "rose" | "amber" | "zinc" | "indigo";
}) {
  const colorClasses: Record<string, string> = {
    rose: "bg-rose-50 dark:bg-rose-900/10 text-rose-700 dark:text-rose-400",
    amber: "bg-amber-50 dark:bg-amber-900/10 text-amber-700 dark:text-amber-400",
    zinc: "bg-zinc-100 dark:bg-zinc-800/50 text-zinc-600 dark:text-zinc-400",
    indigo: "bg-indigo-50 dark:bg-indigo-900/10 text-indigo-700 dark:text-indigo-400",
  };
  return (
    <div className={`rounded-lg p-2 ${colorClasses[color]}`}>
      <div className="font-semibold text-sm">{value}</div>
      <div className="text-[10px] opacity-80">{label}</div>
    </div>
  );
}

function FileGroup({
  kind,
  items,
  onToggleAll,
  onToggleOne,
  disabled,
}: {
  kind: YoudaoEntryKind;
  items: YoudaoEntry[];
  onToggleAll: () => void;
  onToggleOne: (relPath: string) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(items.length <= 20);
  const allSelected = items.every((i) => i.selected);
  const someSelected = items.some((i) => i.selected);

  return (
    <div className="border-b border-zinc-100 dark:border-zinc-800 last:border-b-0">
      <div
        className="flex items-center justify-between px-2.5 py-2 bg-zinc-50/50 dark:bg-zinc-800/40 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800/70"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center gap-2">
          <KindIcon kind={kind} />
          <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
            {KIND_LABELS[kind]}
          </span>
          <span className="text-[10px] text-zinc-400 dark:text-zinc-600">
            ({items.filter((i) => i.selected).length}/{items.length})
          </span>
        </div>
        <button
          onClick={(ev) => {
            ev.stopPropagation();
            onToggleAll();
          }}
          disabled={disabled}
          className="text-[11px] text-rose-500 hover:text-rose-600 dark:hover:text-rose-400 disabled:opacity-40"
        >
          {allSelected ? "取消全选" : someSelected ? "全选" : "全选"}
        </button>
      </div>
      {open && (
        <div>
          {items.map((e) => (
            <label
              key={e.relPath}
              className={`flex items-center gap-2 px-2.5 py-1.5 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50 ${
                e.selected ? "bg-rose-50/30 dark:bg-rose-900/5" : ""
              }`}
            >
              <input
                type="checkbox"
                checked={e.selected}
                disabled={disabled}
                onChange={() => onToggleOne(e.relPath)}
                className="w-3.5 h-3.5 rounded border-zinc-300 dark:border-zinc-600 text-rose-500 focus:ring-rose-500/30"
              />
              <KindIcon kind={e.kind} />
              <div className="flex-1 min-w-0">
                <div className="text-xs text-zinc-700 dark:text-zinc-300 truncate">
                  {e.fileName}
                </div>
                {e.notebookPath.length > 0 && (
                  <div className="text-[10px] text-zinc-400 dark:text-zinc-600 truncate">
                    {e.notebookPath.join(" / ")}
                  </div>
                )}
              </div>
              <span className="text-[10px] text-zinc-400 dark:text-zinc-600 flex-shrink-0">
                {formatFileSize(e.size)}
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 把 webkit 顶层目录名（如 qq5C95B86F813AFAF0DF0E2C4DBCFA1A2A_2026-05-06_1778053583947）
 * 简化成对用户友好的默认根名（"有道云笔记"）。
 */
function guessFriendlyRootName(folderName: string): string {
  // 默认强制覆盖为本地化的 "有道云笔记"，用户仍可改
  void folderName;
  return "有道云笔记";
}
