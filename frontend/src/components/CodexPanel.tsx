import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Workflow, Play, Plus, Trash2, X, Loader2, Check, ChevronDown,
  ChevronRight, GripVertical, Settings2, History, AlertCircle,
  Zap, FileText, Search, CheckSquare, Square, RotateCcw, ChevronUp,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "@/lib/api";
import { useApp } from "@/store/AppContext";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";

interface PipelineStep {
  type: string;
  config?: Record<string, any>;
}

interface Pipeline {
  id: string;
  name: string;
  description: string;
  icon: string;
  steps: PipelineStep[];
  isBuiltin: number;
}

interface StepType {
  type: string;
  name: string;
  icon: string;
  description: string;
}

interface PipelineRunResult {
  runId: string;
  pipelineName: string;
  total: number;
  success: number;
  failed: number;
  results: {
    noteId: string;
    title: string;
    success: boolean;
    steps: { type: string; success: boolean; error?: string }[];
  }[];
}

interface NoteItem {
  id: string;
  title: string;
  notebookId: string;
  contentText: string;
  updatedAt: string;
  isLocked: number;
  isTrashed: number;
}

export default function CodexPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { state } = useApp();

  // ===== 状态 =====
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [stepTypes, setStepTypes] = useState<StepType[]>([]);
  const [selectedPipeline, setSelectedPipeline] = useState<Pipeline | null>(null);
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [runResult, setRunResult] = useState<PipelineRunResult | null>(null);
  const [runHistory, setRunHistory] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<"pipelines" | "run" | "history">("pipelines");
  const [showEditor, setShowEditor] = useState(false);
  const [editingPipeline, setEditingPipeline] = useState<Partial<Pipeline> | null>(null);
  const [loading, setLoading] = useState(true);

  // ===== 加载数据 =====
  useEffect(() => {
    Promise.all([
      api.getPipelines(),
      api.getPipelineStepTypes(),
      api.getNotes(),
    ]).then(([pipes, types, noteList]) => {
      setPipelines(pipes);
      setStepTypes(types);
      setNotes(noteList.filter((n: any) => !n.isTrashed && !n.isLocked) as NoteItem[]);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  // 加载运行历史
  useEffect(() => {
    if (activeTab === "history") {
      api.getPipelineRuns().then(setRunHistory).catch(() => {});
    }
  }, [activeTab]);

  // ===== 筛选笔记 =====
  const filteredNotes = useMemo(() => {
    if (!searchQuery.trim()) return notes;
    const q = searchQuery.toLowerCase();
    return notes.filter(n =>
      n.title.toLowerCase().includes(q) ||
      n.contentText?.toLowerCase().includes(q)
    );
  }, [notes, searchQuery]);

  // ===== 笔记选择 =====
  const toggleNote = useCallback((id: string) => {
    setSelectedNoteIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 50) next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    const ids = filteredNotes.slice(0, 50).map(n => n.id);
    setSelectedNoteIds(new Set(ids));
  }, [filteredNotes]);

  const deselectAll = useCallback(() => {
    setSelectedNoteIds(new Set());
  }, []);

  // ===== 执行管道 =====
  const handleRun = useCallback(async () => {
    if (!selectedPipeline || selectedNoteIds.size === 0) return;
    setIsRunning(true);
    setRunResult(null);
    setActiveTab("run");

    try {
      const result = await api.runPipeline(selectedPipeline.id, Array.from(selectedNoteIds));
      setRunResult(result);
    } catch (err: any) {
      setRunResult({
        runId: "",
        pipelineName: selectedPipeline.name,
        total: selectedNoteIds.size,
        success: 0,
        failed: selectedNoteIds.size,
        results: [{ noteId: "", title: "", success: false, steps: [{ type: "error", success: false, error: err.message }] }],
      });
    } finally {
      setIsRunning(false);
    }
  }, [selectedPipeline, selectedNoteIds]);

  // ===== 管道编辑 =====
  const handleSavePipeline = useCallback(async () => {
    if (!editingPipeline?.name || !editingPipeline?.steps?.length) return;

    try {
      if (editingPipeline.id) {
        const updated = await api.updatePipeline(editingPipeline.id, {
          name: editingPipeline.name,
          description: editingPipeline.description,
          icon: editingPipeline.icon,
          steps: editingPipeline.steps,
        });
        setPipelines(prev => prev.map(p => p.id === updated.id ? updated : p));
      } else {
        const created = await api.createPipeline({
          name: editingPipeline.name,
          description: editingPipeline.description,
          icon: editingPipeline.icon || "⚡",
          steps: editingPipeline.steps,
        });
        setPipelines(prev => [...prev, created]);
      }
      setShowEditor(false);
      setEditingPipeline(null);
    } catch (err: any) {
      alert(err.message);
    }
  }, [editingPipeline]);

  const handleDeletePipeline = useCallback(async (id: string) => {
    if (!confirm(t("codex.confirmDeletePipeline"))) return;
    try {
      await api.deletePipeline(id);
      setPipelines(prev => prev.filter(p => p.id !== id));
      if (selectedPipeline?.id === id) setSelectedPipeline(null);
    } catch (err: any) {
      alert(err.message);
    }
  }, [selectedPipeline, t]);

  // ===== 步骤拖拽排序辅助 =====
  const addStepToEditor = useCallback((stepType: string) => {
    if (!editingPipeline) return;
    const step: PipelineStep = { type: stepType };
    if (stepType === "custom_prompt") {
      step.config = { prompt: "" };
    }
    setEditingPipeline({
      ...editingPipeline,
      steps: [...(editingPipeline.steps || []), step],
    });
  }, [editingPipeline]);

  const removeStepFromEditor = useCallback((index: number) => {
    if (!editingPipeline) return;
    setEditingPipeline({
      ...editingPipeline,
      steps: editingPipeline.steps!.filter((_, i) => i !== index),
    });
  }, [editingPipeline]);

  const moveStep = useCallback((fromIdx: number, direction: "up" | "down") => {
    if (!editingPipeline?.steps) return;
    const steps = [...editingPipeline.steps];
    const toIdx = direction === "up" ? fromIdx - 1 : fromIdx + 1;
    if (toIdx < 0 || toIdx >= steps.length) return;
    [steps[fromIdx], steps[toIdx]] = [steps[toIdx], steps[fromIdx]];
    setEditingPipeline({ ...editingPipeline, steps });
  }, [editingPipeline]);

  const getStepInfo = useCallback((type: string): StepType => {
    return stepTypes.find(s => s.type === type) || { type, name: type, icon: "⚡", description: "" };
  }, [stepTypes]);

  if (loading) {
    return (
      <div className="flex flex-col h-full bg-app-bg items-center justify-center">
        <Loader2 size={24} className="animate-spin text-accent-primary" />
        <p className="mt-2 text-sm text-tx-tertiary">{t("common.loading")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-app-bg">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-app-border bg-app-surface/50">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center">
            <Workflow size={14} className="text-white" />
          </div>
          <span className="text-sm font-semibold text-tx-primary">{t("codex.title")}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-tx-tertiary hover:text-tx-secondary hover:bg-app-hover transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-app-border bg-app-surface/30">
        {(["pipelines", "run", "history"] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
              activeTab === tab
                ? "bg-accent-primary/10 text-accent-primary"
                : "text-tx-tertiary hover:text-tx-secondary hover:bg-app-hover"
            )}
          >
            {tab === "pipelines" && <Workflow size={12} className="inline mr-1" />}
            {tab === "run" && <Play size={12} className="inline mr-1" />}
            {tab === "history" && <History size={12} className="inline mr-1" />}
            {t(`codex.tab_${tab}`)}
          </button>
        ))}
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4">
          {/* ===== 管道列表页 ===== */}
          {activeTab === "pipelines" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-tx-tertiary">{t("codex.pipelinesDesc")}</p>
                <button
                  onClick={() => {
                    setEditingPipeline({ name: "", description: "", icon: "⚡", steps: [] });
                    setShowEditor(true);
                  }}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs bg-accent-primary/10 text-accent-primary hover:bg-accent-primary/20 transition-colors"
                >
                  <Plus size={12} />
                  {t("codex.newPipeline")}
                </button>
              </div>

              {pipelines.map(pipeline => (
                <motion.div
                  key={pipeline.id}
                  layout
                  className={cn(
                    "rounded-xl border p-3 cursor-pointer transition-all",
                    selectedPipeline?.id === pipeline.id
                      ? "border-accent-primary bg-accent-primary/5"
                      : "border-app-border bg-app-surface hover:border-accent-primary/30"
                  )}
                  onClick={() => setSelectedPipeline(pipeline)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{pipeline.icon}</span>
                      <div>
                        <p className="text-sm font-medium text-tx-primary">{pipeline.name}</p>
                        <p className="text-[10px] text-tx-tertiary">{pipeline.description}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {pipeline.isBuiltin === 0 && (
                        <>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingPipeline(pipeline);
                              setShowEditor(true);
                            }}
                            className="p-1 rounded-md text-tx-tertiary hover:text-accent-primary hover:bg-app-hover transition-colors"
                          >
                            <Settings2 size={12} />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeletePipeline(pipeline.id);
                            }}
                            className="p-1 rounded-md text-tx-tertiary hover:text-red-500 hover:bg-app-hover transition-colors"
                          >
                            <Trash2 size={12} />
                          </button>
                        </>
                      )}
                      {selectedPipeline?.id === pipeline.id && (
                        <Check size={14} className="text-accent-primary ml-1" />
                      )}
                    </div>
                  </div>

                  {/* 步骤预览 */}
                  <div className="flex items-center gap-1 mt-2 flex-wrap">
                    {pipeline.steps.map((step, i) => {
                      const info = getStepInfo(step.type);
                      return (
                        <React.Fragment key={i}>
                          {i > 0 && <ChevronRight size={10} className="text-tx-tertiary" />}
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-app-hover text-[10px] text-tx-secondary">
                            <span>{info.icon}</span>
                            {info.name}
                          </span>
                        </React.Fragment>
                      );
                    })}
                  </div>
                </motion.div>
              ))}

              {/* 笔记选择区 */}
              {selectedPipeline && (
                <div className="mt-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-tx-primary flex items-center gap-1">
                      <FileText size={12} />
                      {t("codex.selectNotes")}
                      <span className="text-tx-tertiary">({selectedNoteIds.size}/{notes.length})</span>
                    </p>
                    <div className="flex gap-1">
                      <button onClick={selectAll} className="text-[10px] text-accent-primary hover:underline">
                        {t("codex.selectAll")}
                      </button>
                      <span className="text-tx-tertiary text-[10px]">|</span>
                      <button onClick={deselectAll} className="text-[10px] text-tx-tertiary hover:underline">
                        {t("codex.deselectAll")}
                      </button>
                    </div>
                  </div>

                  {/* 搜索框 */}
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-tx-tertiary" size={12} />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      placeholder={t("codex.searchNotesPlaceholder")}
                      className="w-full pl-7 pr-3 py-1.5 bg-app-bg border border-app-border rounded-lg text-xs text-tx-primary placeholder:text-tx-tertiary focus:ring-1 focus:ring-accent-primary/40 outline-none"
                    />
                  </div>

                  {/* 笔记列表 */}
                  <div className="max-h-[240px] overflow-y-auto space-y-0.5 rounded-lg border border-app-border bg-app-bg p-1">
                    {filteredNotes.length === 0 ? (
                      <p className="text-center text-[10px] text-tx-tertiary py-4">{t("common.noNotes")}</p>
                    ) : (
                      filteredNotes.map(note => (
                        <button
                          key={note.id}
                          onClick={() => toggleNote(note.id)}
                          className={cn(
                            "flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs transition-colors text-left",
                            selectedNoteIds.has(note.id)
                              ? "bg-accent-primary/10 text-tx-primary"
                              : "text-tx-secondary hover:bg-app-hover"
                          )}
                        >
                          {selectedNoteIds.has(note.id)
                            ? <CheckSquare size={12} className="text-accent-primary shrink-0" />
                            : <Square size={12} className="text-tx-tertiary shrink-0" />
                          }
                          <span className="truncate flex-1">{note.title || t("common.untitledNote")}</span>
                        </button>
                      ))
                    )}
                  </div>

                  {/* 执行按钮 */}
                  <button
                    onClick={handleRun}
                    disabled={selectedNoteIds.size === 0 || isRunning}
                    className={cn(
                      "flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-medium transition-all",
                      selectedNoteIds.size > 0 && !isRunning
                        ? "bg-gradient-to-r from-orange-500 to-amber-500 text-white hover:opacity-90 shadow-lg shadow-orange-500/20"
                        : "bg-app-hover text-tx-tertiary cursor-not-allowed"
                    )}
                  >
                    {isRunning ? (
                      <><Loader2 size={14} className="animate-spin" />{t("codex.running")}</>
                    ) : (
                      <><Play size={14} />{t("codex.runPipeline", { count: selectedNoteIds.size })}</>
                    )}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ===== 执行结果页 ===== */}
          {activeTab === "run" && (
            <div className="space-y-3">
              {isRunning && (
                <div className="flex flex-col items-center py-8">
                  <Loader2 size={28} className="animate-spin text-orange-500 mb-3" />
                  <p className="text-sm text-tx-primary font-medium">{t("codex.processingNotes")}</p>
                  <p className="text-[10px] text-tx-tertiary mt-1">{t("codex.processingHint")}</p>
                </div>
              )}

              {!isRunning && !runResult && (
                <div className="flex flex-col items-center py-8 text-center">
                  <Zap size={28} className="text-tx-tertiary/40 mb-3" />
                  <p className="text-sm text-tx-tertiary">{t("codex.noRunYet")}</p>
                  <p className="text-[10px] text-tx-tertiary mt-1">{t("codex.noRunHint")}</p>
                </div>
              )}

              {!isRunning && runResult && (
                <div className="space-y-3">
                  {/* 结果概览 */}
                  <div className="rounded-xl bg-app-surface border border-app-border p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-lg">{selectedPipeline?.icon || "⚡"}</span>
                      <div>
                        <p className="text-sm font-medium text-tx-primary">{runResult.pipelineName}</p>
                        <p className="text-[10px] text-tx-tertiary">
                          {t("codex.runSummary", {
                            total: runResult.total,
                            success: runResult.success,
                            failed: runResult.failed,
                          })}
                        </p>
                      </div>
                    </div>

                    {/* 进度条 */}
                    <div className="w-full h-2 bg-app-hover rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-emerald-500 to-green-500 rounded-full transition-all"
                        style={{ width: `${runResult.total > 0 ? (runResult.success / runResult.total) * 100 : 0}%` }}
                      />
                    </div>
                  </div>

                  {/* 详细结果 */}
                  <div className="space-y-1">
                    {runResult.results.map((r, i) => (
                      <div
                        key={i}
                        className={cn(
                          "flex items-center gap-2 px-3 py-2 rounded-lg text-xs",
                          r.success
                            ? "bg-emerald-50 dark:bg-emerald-500/5 text-emerald-700 dark:text-emerald-400"
                            : "bg-red-50 dark:bg-red-500/5 text-red-700 dark:text-red-400"
                        )}
                      >
                        {r.success
                          ? <Check size={12} className="shrink-0" />
                          : <AlertCircle size={12} className="shrink-0" />
                        }
                        <span className="truncate flex-1">{r.title || t("common.untitledNote")}</span>
                        {!r.success && r.steps.find(s => !s.success) && (
                          <span className="text-[10px] shrink-0">
                            {r.steps.find(s => !s.success)?.error?.slice(0, 30)}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* 重新运行 */}
                  <button
                    onClick={() => { setActiveTab("pipelines"); setRunResult(null); }}
                    className="flex items-center justify-center gap-1.5 w-full py-2 rounded-lg text-xs text-accent-primary bg-accent-primary/10 hover:bg-accent-primary/20 transition-colors"
                  >
                    <RotateCcw size={12} />
                    {t("codex.backToPipelines")}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ===== 运行历史页 ===== */}
          {activeTab === "history" && (
            <div className="space-y-2">
              {runHistory.length === 0 ? (
                <div className="flex flex-col items-center py-8 text-center">
                  <History size={28} className="text-tx-tertiary/40 mb-3" />
                  <p className="text-sm text-tx-tertiary">{t("codex.noHistory")}</p>
                </div>
              ) : (
                runHistory.map(run => (
                  <div
                    key={run.id}
                    className="rounded-lg border border-app-border bg-app-surface p-3"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{run.pipelineIcon || "⚡"}</span>
                        <div>
                          <p className="text-xs font-medium text-tx-primary">{run.pipelineName || t("codex.unknownPipeline")}</p>
                          <p className="text-[10px] text-tx-tertiary">
                            {new Date(run.startedAt).toLocaleString()}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className={cn(
                          "px-1.5 py-0.5 rounded text-[10px] font-medium",
                          run.status === "completed"
                            ? "bg-emerald-100 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                            : "bg-amber-100 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400"
                        )}>
                          {run.status === "completed" ? t("codex.completed") : t("codex.running")}
                        </span>
                        <span className="text-[10px] text-tx-tertiary">
                          {run.successNotes}/{run.totalNotes}
                        </span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* ===== 管道编辑弹窗 ===== */}
      <AnimatePresence>
        {showEditor && editingPipeline && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              onClick={() => { setShowEditor(false); setEditingPipeline(null); }}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="relative bg-app-elevated w-full max-w-lg max-h-[85vh] rounded-xl shadow-2xl border border-app-border flex flex-col overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              {/* 编辑器头部 */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-app-border">
                <h3 className="text-sm font-semibold text-tx-primary">
                  {editingPipeline.id ? t("codex.editPipeline") : t("codex.newPipeline")}
                </h3>
                <button
                  onClick={() => { setShowEditor(false); setEditingPipeline(null); }}
                  className="p-1 rounded-md text-tx-tertiary hover:bg-app-hover"
                >
                  <X size={14} />
                </button>
              </div>

              {/* 编辑器内容 */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {/* 基本信息 */}
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={editingPipeline.icon || "⚡"}
                      onChange={e => setEditingPipeline({ ...editingPipeline, icon: e.target.value })}
                      className="w-12 h-9 text-center text-lg bg-app-bg border border-app-border rounded-lg focus:ring-1 focus:ring-accent-primary/40 outline-none"
                      maxLength={2}
                    />
                    <input
                      type="text"
                      value={editingPipeline.name || ""}
                      onChange={e => setEditingPipeline({ ...editingPipeline, name: e.target.value })}
                      placeholder={t("codex.pipelineName")}
                      className="flex-1 h-9 px-3 bg-app-bg border border-app-border rounded-lg text-sm text-tx-primary placeholder:text-tx-tertiary focus:ring-1 focus:ring-accent-primary/40 outline-none"
                    />
                  </div>
                  <input
                    type="text"
                    value={editingPipeline.description || ""}
                    onChange={e => setEditingPipeline({ ...editingPipeline, description: e.target.value })}
                    placeholder={t("codex.pipelineDescription")}
                    className="w-full h-9 px-3 bg-app-bg border border-app-border rounded-lg text-xs text-tx-secondary placeholder:text-tx-tertiary focus:ring-1 focus:ring-accent-primary/40 outline-none"
                  />
                </div>

                {/* 已添加的步骤 */}
                <div>
                  <p className="text-xs font-medium text-tx-primary mb-2">{t("codex.pipelineSteps")}</p>
                  <div className="space-y-1">
                    {(editingPipeline.steps || []).map((step, i) => {
                      const info = getStepInfo(step.type);
                      return (
                        <div
                          key={i}
                          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-app-bg border border-app-border group"
                        >
                          <GripVertical size={12} className="text-tx-tertiary shrink-0" />
                          <span className="text-sm">{info.icon}</span>
                          <span className="text-xs text-tx-primary flex-1">{info.name}</span>
                          {step.type === "custom_prompt" && (
                            <input
                              type="text"
                              value={step.config?.prompt || ""}
                              onChange={e => {
                                const steps = [...(editingPipeline.steps || [])];
                                steps[i] = { ...step, config: { ...step.config, prompt: e.target.value } };
                                setEditingPipeline({ ...editingPipeline, steps });
                              }}
                              placeholder={t("codex.customPromptPlaceholder")}
                              className="flex-1 text-[10px] bg-transparent border-b border-app-border/50 px-1 py-0.5 outline-none text-tx-secondary"
                            />
                          )}
                          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => moveStep(i, "up")}
                              disabled={i === 0}
                              className="p-0.5 rounded hover:bg-app-hover text-tx-tertiary disabled:opacity-30"
                            >
                              <ChevronUp size={10} />
                            </button>
                            <button
                              onClick={() => moveStep(i, "down")}
                              disabled={i === (editingPipeline.steps?.length || 0) - 1}
                              className="p-0.5 rounded hover:bg-app-hover text-tx-tertiary disabled:opacity-30"
                            >
                              <ChevronDown size={10} />
                            </button>
                            <button
                              onClick={() => removeStepFromEditor(i)}
                              className="p-0.5 rounded hover:bg-red-500/10 text-tx-tertiary hover:text-red-500"
                            >
                              <X size={10} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                    {(editingPipeline.steps || []).length === 0 && (
                      <p className="text-center text-[10px] text-tx-tertiary py-3">{t("codex.noStepsYet")}</p>
                    )}
                  </div>
                </div>

                {/* 可用步骤 */}
                <div>
                  <p className="text-xs font-medium text-tx-primary mb-2">{t("codex.availableSteps")}</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {stepTypes.map(st => (
                      <button
                        key={st.type}
                        onClick={() => addStepToEditor(st.type)}
                        className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[10px] text-tx-secondary bg-app-bg border border-app-border hover:border-accent-primary/30 hover:bg-accent-primary/5 transition-all text-left"
                      >
                        <span className="text-sm">{st.icon}</span>
                        <div className="min-w-0">
                          <p className="font-medium text-tx-primary truncate">{st.name}</p>
                          <p className="text-tx-tertiary truncate">{st.description}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* 编辑器底部 */}
              <div className="flex justify-end gap-2 px-4 py-3 border-t border-app-border">
                <button
                  onClick={() => { setShowEditor(false); setEditingPipeline(null); }}
                  className="px-4 py-2 text-xs text-tx-secondary hover:bg-app-hover rounded-lg transition-colors"
                >
                  {t("common.cancel")}
                </button>
                <button
                  onClick={handleSavePipeline}
                  disabled={!editingPipeline.name || !(editingPipeline.steps?.length)}
                  className={cn(
                    "px-4 py-2 text-xs font-medium rounded-lg transition-colors",
                    editingPipeline.name && editingPipeline.steps?.length
                      ? "bg-accent-primary text-white hover:bg-accent-primary/90"
                      : "bg-app-hover text-tx-tertiary cursor-not-allowed"
                  )}
                >
                  {t("common.save")}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
