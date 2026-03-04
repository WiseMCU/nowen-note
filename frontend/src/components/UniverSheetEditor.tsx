import React, { useEffect, useRef, useState, useCallback } from "react";
import { ArrowLeft, Save, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";

import { createUniver, defaultTheme, LocaleType, merge } from "@univerjs/presets";
import { UniverSheetsCorePreset } from "@univerjs/presets/preset-sheets-core";
import UniverPresetSheetsCoreZhCN from "@univerjs/presets/preset-sheets-core/locales/zh-CN";
import "@univerjs/presets/lib/styles/preset-sheets-core.css";

interface UniverSheetEditorProps {
  documentId: string;
  title: string;
  onBack: () => void;
}

export default function UniverSheetEditor({ documentId, title, onBack }: UniverSheetEditorProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const univerRef = useRef<{ univerAPI: any } | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modified, setModified] = useState(false);

  // 初始化 Univer 并加载电子表格
  useEffect(() => {
    if (!containerRef.current) return;

    let disposed = false;

    (async () => {
      try {
        setLoading(true);

        // 从后端获取文档内容 (xlsx ArrayBuffer)
        const arrayBuffer = await api.getDocumentContent(documentId);

        if (disposed) return;

        // 解析 xlsx 为 Univer workbook 数据
        const workbookData = await parseXlsxToUniverData(arrayBuffer);

        // 创建 Univer 实例
        const { univerAPI } = createUniver({
          locale: LocaleType.ZH_CN,
          locales: {
            [LocaleType.ZH_CN]: merge({}, UniverPresetSheetsCoreZhCN),
          },
          theme: defaultTheme,
          presets: [
            UniverSheetsCorePreset({
              container: containerRef.current!,
            }),
          ],
        });

        univerRef.current = { univerAPI };

        // 创建工作簿
        univerAPI.createWorkbook(workbookData);

        // 监听修改
        univerAPI.onCommandExecuted(() => {
          if (!disposed) {
            setModified(true);
          }
        });
      } catch (err: any) {
        if (!disposed) {
          setError(err.message || t("documents.loadFailed"));
        }
      } finally {
        if (!disposed) {
          setLoading(false);
        }
      }
    })();

    return () => {
      disposed = true;
      try {
        univerRef.current?.univerAPI?.dispose?.();
      } catch { /* ignore */ }
      univerRef.current = null;
    };
  }, [documentId]);

  // 保存
  const handleSave = useCallback(async () => {
    const univerAPI = univerRef.current?.univerAPI;
    if (!univerAPI) return;

    setSaving(true);
    try {
      const workbook = univerAPI.getActiveWorkbook();
      if (!workbook) throw new Error("No active workbook");

      const snapshot = workbook.getSnapshot();
      const xlsxBlob = await exportUniverDataToXlsx(snapshot);
      await api.saveDocumentContent(documentId, xlsxBlob);
      setModified(false);
    } catch (err: any) {
      console.error("Save failed:", err);
    } finally {
      setSaving(false);
    }
  }, [documentId]);

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center bg-app-bg">
        <div className="flex flex-col items-center gap-3 text-center px-4">
          <p className="text-sm text-red-500">{error}</p>
          <button onClick={onBack} className="px-4 py-2 text-sm bg-app-hover text-tx-primary rounded-lg">
            {t("documents.backToList")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* 顶栏 */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-app-border bg-app-surface/50 shrink-0">
        <button onClick={onBack} className="p-1.5 rounded-md text-tx-secondary hover:text-tx-primary hover:bg-app-hover transition-colors">
          <ArrowLeft size={18} />
        </button>
        <span className="text-sm font-medium text-tx-primary truncate flex-1">{title}</span>
        {modified && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-accent-primary hover:bg-accent-hover disabled:opacity-50 rounded-md transition-colors"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {saving ? t("common.saving") : t("common.save")}
          </button>
        )}
      </div>

      {/* Univer 编辑器容器 */}
      <div className="flex-1 relative overflow-hidden">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-app-bg/80 z-10">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-accent-primary" />
              <p className="text-sm text-tx-secondary">{t("documents.loadingDocument")}</p>
            </div>
          </div>
        )}
        <div ref={containerRef} className="w-full h-full" />
      </div>
    </div>
  );
}

/**
 * 使用 xlsx 库解析 xlsx 为 Univer workbook 数据格式
 */
async function parseXlsxToUniverData(arrayBuffer: ArrayBuffer): Promise<any> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(arrayBuffer, { type: "array" });

  const sheets: Record<string, any> = {};
  const sheetOrder: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const json = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: "" });

    const sheetId = `sheet-${sheetName.replace(/\s/g, "_")}`;
    sheetOrder.push(sheetId);

    const cellData: Record<number, Record<number, any>> = {};
    const maxCols = Math.max(...json.map((r: any[]) => r.length), 1);

    for (let r = 0; r < json.length; r++) {
      cellData[r] = {};
      for (let c = 0; c < maxCols; c++) {
        const value = json[r]?.[c];
        if (value !== undefined && value !== "") {
          cellData[r][c] = {
            v: value,
            t: typeof value === "number" ? 2 : 1, // CellValueType: 1=string, 2=number
          };
        }
      }
    }

    sheets[sheetId] = {
      id: sheetId,
      name: sheetName,
      cellData,
      rowCount: Math.max(json.length, 100),
      columnCount: Math.max(maxCols, 26),
    };
  }

  return {
    id: `workbook-${Date.now()}`,
    name: "Workbook",
    sheetOrder,
    sheets,
  };
}

/**
 * 将 Univer workbook snapshot 导出为 xlsx Blob
 */
async function exportUniverDataToXlsx(snapshot: any): Promise<Blob> {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();

  const sheetOrder: string[] = snapshot.sheetOrder || Object.keys(snapshot.sheets || {});
  const sheets = snapshot.sheets || {};

  for (const sheetId of sheetOrder) {
    const sheet = sheets[sheetId];
    if (!sheet) continue;

    const cellData = sheet.cellData || {};
    const rows: any[][] = [];

    // 找到最大行列
    const rowKeys = Object.keys(cellData).map(Number).sort((a, b) => a - b);
    const maxRow = rowKeys.length > 0 ? Math.max(...rowKeys) + 1 : 0;

    for (let r = 0; r < maxRow; r++) {
      const row: any[] = [];
      const rowData = cellData[r] || {};
      const colKeys = Object.keys(rowData).map(Number);
      const maxCol = colKeys.length > 0 ? Math.max(...colKeys) + 1 : 0;

      for (let c = 0; c < maxCol; c++) {
        const cell = rowData[c];
        row.push(cell?.v ?? "");
      }
      rows.push(row);
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, sheet.name || sheetId);
  }

  const buffer = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
