import React, { useEffect, useRef, useState, useCallback } from "react";
import { ArrowLeft, Save, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";

import { createUniver, defaultTheme, LocaleType, merge } from "@univerjs/presets";
import { UniverDocsCorePreset } from "@univerjs/presets/preset-docs-core";
import { UniverDocsDrawingPreset } from "@univerjs/presets/preset-docs-drawing";
import UniverPresetDocsCoreZhCN from "@univerjs/presets/preset-docs-core/locales/zh-CN";
import UniverPresetDocsDrawingZhCN from "@univerjs/presets/preset-docs-drawing/locales/zh-CN";
import "@univerjs/presets/lib/styles/preset-docs-core.css";
import "@univerjs/presets/lib/styles/preset-docs-drawing.css";

interface UniverDocEditorProps {
  documentId: string;
  title: string;
  onBack: () => void;
}

export default function UniverDocEditor({ documentId, title, onBack }: UniverDocEditorProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const univerRef = useRef<ReturnType<typeof createUniver> | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modified, setModified] = useState(false);

  // 初始化 Univer 并加载文档
  useEffect(() => {
    if (!containerRef.current) return;

    let disposed = false;

    (async () => {
      try {
        setLoading(true);

        // 从后端获取文档内容 (docx ArrayBuffer)
        const arrayBuffer = await api.getDocumentContent(documentId);

        if (disposed) return;

        // 尝试从 docx 中提取纯文本内容
        const docData = await parseDocxToUniverData(arrayBuffer);

        // 创建 Univer 实例
        const { univerAPI } = createUniver({
          locale: LocaleType.ZH_CN,
          locales: {
            [LocaleType.ZH_CN]: merge({}, UniverPresetDocsCoreZhCN, UniverPresetDocsDrawingZhCN),
          },
          theme: defaultTheme,
          presets: [
            UniverDocsCorePreset({
              container: containerRef.current!,
            }),
            UniverDocsDrawingPreset(),
          ],
        });

        univerRef.current = { univerAPI } as any;

        // 创建文档
        univerAPI.createUniverDoc(docData);

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

  // 保存文档
  const handleSave = useCallback(async () => {
    const univerAPI = univerRef.current?.univerAPI;
    if (!univerAPI) return;

    setSaving(true);
    try {
      // 获取当前文档内容并导出为 docx
      const activeDoc = univerAPI.getActiveDocument();
      if (!activeDoc) throw new Error("No active document");

      const snapshot = activeDoc.getSnapshot();
      const docxBlob = await exportUniverDataToDocx(snapshot);
      await api.saveDocumentContent(documentId, docxBlob);
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
 * 从 docx ArrayBuffer 中提取文本内容，转换为 Univer 文档数据格式
 *
 * Univer dataStream 控制字符：
 *   \r = 段落结束 (PARAGRAPH)
 *   \n = 分节符 (SECTION_BREAK)
 *
 * dataStream 格式: "段落1内容\r段落2内容\r...\n"
 * paragraphs[].startIndex 指向每个 \r 在 dataStream 中的位置
 * sectionBreaks[].startIndex 指向 \n 的位置 (最后一个字符)
 */
async function parseDocxToUniverData(arrayBuffer: ArrayBuffer): Promise<any> {
  try {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(arrayBuffer);
    const docXml = await zip.file("word/document.xml")?.async("string");

    if (!docXml) {
      return createEmptyDocData();
    }

    // 解析 relationship 映射（rId -> 图片路径）
    const relMap = await parseRelationships(zip);
    // 预加载所有图片为 base64 data URL
    const imageCache = await loadImages(zip);

    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(docXml, "text/xml");

    const paragraphEls = xmlDoc.getElementsByTagName("w:p");
    let dataStream = "";
    const textRuns: any[] = [];
    const paragraphs: any[] = [];
    const customBlocks: any[] = [];
    const drawings: Record<string, any> = {};
    const drawingsOrder: string[] = [];
    let offset = 0;
    const docId = `doc-${Date.now()}`;

    for (let i = 0; i < paragraphEls.length; i++) {
      const para = paragraphEls[i];

      // 解析段落属性
      const pPr = para.getElementsByTagName("w:pPr")[0];
      let alignment = 0;
      if (pPr) {
        const jc = pPr.getElementsByTagName("w:jc")[0];
        if (jc) {
          const val = jc.getAttribute("w:val");
          if (val === "center") alignment = 1;
          else if (val === "right") alignment = 2;
          else if (val === "both" || val === "justify") alignment = 3;
        }
      }

      // 收集段落中所有的 run
      const runs = collectDescendants(para, "w:r");
      for (const run of runs) {
        // 检查 run 中是否有图片 (w:drawing 或 w:pict)
        const drawingEl = run.getElementsByTagName("w:drawing")[0] || run.getElementsByTagName("mc:AlternateContent")[0];
        if (drawingEl) {
          const imgInfo = extractImageFromDrawing(drawingEl, relMap, imageCache);
          if (imgInfo) {
            const drawingId = `drawing-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            // \b = customBlock 标记
            dataStream += "\b";
            customBlocks.push({
              startIndex: offset,
              blockType: 0, // BlockType.DRAWING
              blockId: drawingId,
            });

            // 将图片尺寸从 EMU 转为 pt (1 pt = 12700 EMU)
            const widthPt = imgInfo.widthEmu / 12700;
            const heightPt = imgInfo.heightEmu / 12700;

            drawings[drawingId] = {
              unitId: docId,
              subUnitId: docId,
              drawingId: drawingId,
              drawingType: 0, // DrawingTypeEnum.DRAWING_IMAGE
              imageSourceType: "BASE64",
              source: imgInfo.dataUrl,
              transform: {
                left: 0,
                top: 0,
                width: widthPt,
                height: heightPt,
                angle: 0,
              },
              docTransform: {
                size: { width: widthPt, height: heightPt },
                positionH: { relativeFrom: 1, posOffset: 0 },
                positionV: { relativeFrom: 1, posOffset: 0 },
                angle: 0,
              },
              layoutType: 0, // PositionedObjectLayoutType.INLINE
              behindDoc: 0,  // BooleanNumber.FALSE
              title: "",
              description: "",
              wrapText: 0,   // WrapTextType.BOTH_SIDES
              distL: 0,
              distR: 0,
              distT: 0,
              distB: 0,
            };
            drawingsOrder.push(drawingId);
            offset += 1;
            continue;
          }
        }

        const rPr = run.getElementsByTagName("w:rPr")[0];
        const ts: any = {};
        if (rPr) {
          const bold = rPr.getElementsByTagName("w:b")[0];
          if (bold && bold.getAttribute("w:val") !== "0") ts.bl = 1;

          const italic = rPr.getElementsByTagName("w:i")[0];
          if (italic && italic.getAttribute("w:val") !== "0") ts.it = 1;

          const underline = rPr.getElementsByTagName("w:u")[0];
          if (underline) {
            const uVal = underline.getAttribute("w:val");
            if (uVal && uVal !== "none") {
              ts.ul = { s: 1 };
            }
          }

          const strike = rPr.getElementsByTagName("w:strike")[0];
          if (strike && strike.getAttribute("w:val") !== "0") {
            ts.st = { s: 1 };
          }

          const szEl = rPr.getElementsByTagName("w:sz")[0];
          if (szEl) {
            const szVal = szEl.getAttribute("w:val");
            if (szVal) ts.fs = parseInt(szVal) / 2;
          }

          const fontEl = rPr.getElementsByTagName("w:rFonts")[0];
          if (fontEl) {
            const ff = fontEl.getAttribute("w:eastAsia") || fontEl.getAttribute("w:ascii") || fontEl.getAttribute("w:hAnsi");
            if (ff) ts.ff = ff;
          }

          const colorEl = rPr.getElementsByTagName("w:color")[0];
          if (colorEl) {
            const colorVal = colorEl.getAttribute("w:val");
            if (colorVal && colorVal !== "auto") {
              ts.cl = { rgb: `#${colorVal}` };
            }
          }
        }

        const textNodes = run.getElementsByTagName("w:t");
        let runText = "";
        for (let k = 0; k < textNodes.length; k++) {
          runText += textNodes[k].textContent || "";
        }

        if (runText.length > 0) {
          textRuns.push({
            st: offset,
            ed: offset + runText.length,
            ts: Object.keys(ts).length > 0 ? ts : undefined,
          });
          dataStream += runText;
          offset += runText.length;
        }
      }

      // 每个段落末尾添加 \r (PARAGRAPH token)
      dataStream += "\r";
      paragraphs.push({
        startIndex: offset,
        paragraphStyle: alignment !== 0 ? { horizontalAlign: alignment } : undefined,
      });
      offset += 1;
    }

    // 如果没有段落，创建一个空段落
    if (paragraphs.length === 0) {
      dataStream = "\r";
      paragraphs.push({ startIndex: 0 });
      offset = 1;
    }

    // dataStream 末尾添加 \n (SECTION_BREAK)
    dataStream += "\n";
    const sectionBreaks = [{ startIndex: offset }];

    const result: any = {
      id: docId,
      body: {
        dataStream,
        textRuns: textRuns.length > 0 ? textRuns : undefined,
        paragraphs,
        sectionBreaks,
        customBlocks: customBlocks.length > 0 ? customBlocks : undefined,
      },
      documentStyle: {
        pageSize: {
          width: 595.28,
          height: 841.89,
        },
        marginTop: 72,
        marginBottom: 72,
        marginRight: 72,
        marginLeft: 72,
      },
    };

    if (Object.keys(drawings).length > 0) {
      result.drawings = drawings;
      result.drawingsOrder = drawingsOrder;
      // Drawing plugin 通过 resources 系统加载 drawing 数据到 drawing service
      result.resources = [
        {
          name: "DOC_DRAWING_PLUGIN",
          data: JSON.stringify({ data: drawings, order: drawingsOrder }),
        },
      ];
    }

    return result;
  } catch {
    try {
      const decoder = new TextDecoder("utf-8");
      const text = decoder.decode(arrayBuffer);

      let nonPrintable = 0;
      const checkLen = Math.min(text.length, 1000);
      for (let i = 0; i < checkLen; i++) {
        const code = text.charCodeAt(i);
        if (code < 32 && code !== 10 && code !== 13 && code !== 9) nonPrintable++;
      }
      if (checkLen > 0 && nonPrintable / checkLen > 0.3) {
        return createEmptyDocData("文件格式解析失败，请尝试重新打开或重新上传");
      }

      return textToUniverData(text);
    } catch {
      return createEmptyDocData();
    }
  }
}

/** 解析 word/_rels/document.xml.rels，返回 rId -> Target 映射 */
async function parseRelationships(zip: any): Promise<Map<string, string>> {
  const relMap = new Map<string, string>();
  try {
    const relsXml = await zip.file("word/_rels/document.xml.rels")?.async("string");
    if (!relsXml) return relMap;

    const parser = new DOMParser();
    const doc = parser.parseFromString(relsXml, "text/xml");
    const rels = doc.getElementsByTagName("Relationship");
    for (let i = 0; i < rels.length; i++) {
      const id = rels[i].getAttribute("Id");
      const target = rels[i].getAttribute("Target");
      if (id && target) {
        relMap.set(id, target);
      }
    }
  } catch { /* ignore */ }
  return relMap;
}

/** 预加载 docx 中所有 word/media/ 目录下的图片为 base64 data URL */
async function loadImages(zip: any): Promise<Map<string, string>> {
  const cache = new Map<string, string>();
  const mimeMap: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    bmp: "image/bmp",
    svg: "image/svg+xml",
    tiff: "image/tiff",
    tif: "image/tiff",
    webp: "image/webp",
    emf: "image/x-emf",
    wmf: "image/x-wmf",
  };

  const promises: Promise<void>[] = [];
  zip.folder("word/media")?.forEach((relativePath: string, file: any) => {
    promises.push(
      (async () => {
        try {
          const ext = relativePath.split(".").pop()?.toLowerCase() || "";
          const mime = mimeMap[ext] || "application/octet-stream";
          const base64 = await file.async("base64");
          const dataUrl = `data:${mime};base64,${base64}`;
          // 存储两种路径格式以便匹配
          cache.set(`media/${relativePath}`, dataUrl);
          cache.set(`word/media/${relativePath}`, dataUrl);
        } catch { /* ignore */ }
      })()
    );
  });
  await Promise.all(promises);
  return cache;
}

/** 从 w:drawing 元素中提取图片信息 */
function extractImageFromDrawing(
  drawingEl: Element,
  relMap: Map<string, string>,
  imageCache: Map<string, string>
): { dataUrl: string; widthEmu: number; heightEmu: number } | null {
  // 查找 a:blip 元素（包含图片引用）
  const blips = drawingEl.getElementsByTagName("a:blip");
  if (blips.length === 0) return null;

  const blip = blips[0];
  const embedId = blip.getAttribute("r:embed") || blip.getAttribute("r:link");
  if (!embedId) return null;

  // 通过 relationship ID 找到图片路径
  const target = relMap.get(embedId);
  if (!target) return null;

  // 从缓存中获取 base64 data URL
  const dataUrl = imageCache.get(target) || imageCache.get(`word/${target}`);
  if (!dataUrl) return null;

  // 解析图片尺寸 (EMU)
  let widthEmu = 914400; // 默认 1 inch
  let heightEmu = 914400;

  // 尝试从 wp:extent 获取
  const extents = drawingEl.getElementsByTagName("wp:extent");
  if (extents.length > 0) {
    const cx = extents[0].getAttribute("cx");
    const cy = extents[0].getAttribute("cy");
    if (cx) widthEmu = parseInt(cx);
    if (cy) heightEmu = parseInt(cy);
  }

  // 也尝试 a:ext
  if (extents.length === 0) {
    const aExts = drawingEl.getElementsByTagName("a:ext");
    for (let i = 0; i < aExts.length; i++) {
      const cx = aExts[i].getAttribute("cx");
      const cy = aExts[i].getAttribute("cy");
      if (cx && cy) {
        widthEmu = parseInt(cx);
        heightEmu = parseInt(cy);
        break;
      }
    }
  }

  return { dataUrl, widthEmu, heightEmu };
}

function textToUniverData(text: string): any {
  // 统一换行符，按行分段
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  let dataStream = "";
  const paragraphs: any[] = [];
  let offset = 0;

  for (const line of lines) {
    dataStream += line;
    offset += line.length;
    // 段落结束符 \r
    dataStream += "\r";
    paragraphs.push({ startIndex: offset });
    offset += 1;
  }

  // 末尾分节符 \n
  dataStream += "\n";
  const sectionBreaks = [{ startIndex: offset }];

  return {
    id: `doc-${Date.now()}`,
    body: {
      dataStream,
      paragraphs,
      sectionBreaks,
    },
    documentStyle: {
      pageSize: {
        width: 595.28,
        height: 841.89,
      },
      marginTop: 72,
      marginBottom: 72,
      marginRight: 72,
      marginLeft: 72,
    },
  };
}

function createEmptyDocData(placeholder?: string): any {
  const text = placeholder || "";
  // 格式: "文本\r\n" — \r 是段落结束, \n 是分节符
  const dataStream = text + "\r\n";
  return {
    id: `doc-${Date.now()}`,
    body: {
      dataStream,
      paragraphs: [
        { startIndex: text.length },
      ],
      sectionBreaks: [
        { startIndex: text.length + 1 },
      ],
    },
    documentStyle: {
      pageSize: {
        width: 595.28,
        height: 841.89,
      },
      marginTop: 72,
      marginBottom: 72,
      marginRight: 72,
      marginLeft: 72,
    },
  };
}

function collectDescendants(element: Element, localName: string): Element[] {
  const results: Element[] = [];
  function walk(node: Element) {
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      if (child.localName === localName.split(":")[1] || child.tagName === localName) {
        results.push(child);
      } else {
        walk(child);
      }
    }
  }
  walk(element);
  return results;
}

/**
 * 将 Univer 文档 snapshot 导出为 docx Blob
 *
 * Univer dataStream 中 \r = 段落结束, \n = 分节符
 */
async function exportUniverDataToDocx(snapshot: any): Promise<Blob> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();

  const body = snapshot.body;
  const dataStream: string = body?.dataStream || "";
  const paragraphMeta: any[] = body?.paragraphs || [];
  const textRuns: any[] = body?.textRuns || [];
  const customBlocks: any[] = body?.customBlocks || [];
  const snapshotDrawings: Record<string, any> = snapshot.drawings || {};

  // 收集图片：drawingId -> { rId, ext, base64data }
  const imageEntries: { rId: string; ext: string; base64data: string; drawingId: string }[] = [];
  let rIdCounter = 10;

  // 为 customBlocks 中的图片创建 rId 映射
  const drawingRIdMap = new Map<string, string>();
  for (const cb of customBlocks) {
    const drawingId = cb.blockId;
    const drawing = snapshotDrawings[drawingId];
    if (!drawing || drawing.drawingType !== 0) continue;
    const source: string = drawing.source || "";
    if (!source) continue;

    const rId = `rId${rIdCounter++}`;
    drawingRIdMap.set(drawingId, rId);

    // 从 base64 data URL 中提取扩展名和数据
    let ext = "png";
    let base64data = source;
    const m = source.match(/^data:image\/([\w+-]+);base64,(.+)$/);
    if (m) {
      ext = m[1] === "jpeg" ? "jpg" : m[1];
      base64data = m[2];
    }
    imageEntries.push({ rId, ext, base64data, drawingId });
  }

  // 构建 customBlock offset -> drawingId 的查找表
  const customBlockMap = new Map<number, string>();
  for (const cb of customBlocks) {
    customBlockMap.set(cb.startIndex, cb.blockId);
  }

  // 按 \r 分段 (PARAGRAPH token)
  const paraTexts: string[] = [];
  let lastIdx = 0;
  for (let i = 0; i < dataStream.length; i++) {
    if (dataStream[i] === "\r") {
      paraTexts.push(dataStream.slice(lastIdx, i));
      lastIdx = i + 1;
    } else if (dataStream[i] === "\n") {
      lastIdx = i + 1;
    }
  }

  let docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
  xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"
  xmlns:v="urn:schemas-microsoft-com:vml"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:w10="urn:schemas-microsoft-com:office:word"
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"
  xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"
  xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk"
  xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml"
  xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  mc:Ignorable="w14 wp14">
  <w:body>`;

  let globalOffset = 0;
  for (const paraText of paraTexts) {
    const paraEnd = globalOffset + paraText.length;

    let align = "";
    for (const pm of paragraphMeta) {
      if (pm.startIndex === paraEnd) {
        const ha = pm.paragraphStyle?.horizontalAlign;
        if (ha === 1) align = "center";
        else if (ha === 2) align = "right";
        else if (ha === 3) align = "both";
        break;
      }
    }

    docXml += "\n    <w:p>";
    if (align) {
      docXml += `<w:pPr><w:jc w:val="${align}"/></w:pPr>`;
    }

    // 逐字符处理段落内容，处理 \b (customBlock) 和普通文本
    let pos = globalOffset;
    while (pos < globalOffset + paraText.length) {
      const ch = dataStream[pos];
      if (ch === "\b") {
        // 这是一个 customBlock（图片）
        const drawingId = customBlockMap.get(pos);
        if (drawingId) {
          const drawing = snapshotDrawings[drawingId];
          const rId = drawingRIdMap.get(drawingId);
          if (drawing && rId) {
            const widthEmu = Math.round((drawing.transform?.width || 100) * 12700);
            const heightEmu = Math.round((drawing.transform?.height || 100) * 12700);
            docXml += `<w:r><w:rPr/><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">`;
            docXml += `<wp:extent cx="${widthEmu}" cy="${heightEmu}"/>`;
            docXml += `<wp:docPr id="${rIdCounter++}" name="${drawingId}"/>`;
            docXml += `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">`;
            docXml += `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">`;
            docXml += `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">`;
            docXml += `<pic:nvPicPr><pic:cNvPr id="0" name="${drawingId}"/><pic:cNvPicPr/></pic:nvPicPr>`;
            docXml += `<pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`;
            docXml += `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${widthEmu}" cy="${heightEmu}"/></a:xfrm>`;
            docXml += `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>`;
            docXml += `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
          }
        }
        pos++;
        continue;
      }

      // 查找当前位置的 textRun 样式
      const matchingRun = textRuns.find(
        (tr: any) => tr.st <= pos && tr.ed > pos
      );

      // 收集连续的普通文本字符（在同一个 textRun 范围内）
      let textEnd = pos + 1;
      while (textEnd < globalOffset + paraText.length) {
        if (dataStream[textEnd] === "\b") break;
        // 检查是否还在同一个 textRun 内
        if (matchingRun && textEnd >= matchingRun.ed) break;
        if (!matchingRun) {
          const nextRun = textRuns.find((tr: any) => tr.st === textEnd);
          if (nextRun) break;
        }
        textEnd++;
      }

      const runText = dataStream.slice(pos, textEnd);
      if (runText.length > 0) {
        docXml += "<w:r>";
        const ts = matchingRun?.ts;
        if (ts) {
          docXml += "<w:rPr>";
          if (ts.bl === 1) docXml += '<w:b/>';
          if (ts.it === 1) docXml += '<w:i/>';
          if (ts.ul?.s === 1) docXml += '<w:u w:val="single"/>';
          if (ts.st?.s === 1) docXml += '<w:strike/>';
          if (ts.fs) docXml += `<w:sz w:val="${Math.round(ts.fs * 2)}"/>`;
          if (ts.ff) docXml += `<w:rFonts w:ascii="${escapeXml(ts.ff)}" w:hAnsi="${escapeXml(ts.ff)}" w:eastAsia="${escapeXml(ts.ff)}"/>`;
          if (ts.cl?.rgb) {
            const color = ts.cl.rgb.replace("#", "");
            docXml += `<w:color w:val="${color}"/>`;
          }
          docXml += "</w:rPr>";
        }
        docXml += `<w:t xml:space="preserve">${escapeXml(runText)}</w:t></w:r>`;
      }
      pos = textEnd;
    }

    docXml += "</w:p>";
    globalOffset = paraEnd + 1; // +1 for \r
  }

  docXml += `
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;

  zip.file("word/document.xml", docXml);

  // 写入图片文件
  const contentTypeDefaults = new Set<string>();
  contentTypeDefaults.add("rels");
  contentTypeDefaults.add("xml");
  for (const entry of imageEntries) {
    zip.file(`word/media/image_${entry.drawingId}.${entry.ext}`, entry.base64data, { base64: true });
    contentTypeDefaults.add(entry.ext);
  }

  // Content Types
  let ctXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>`;
  const extMimeMap: Record<string, string> = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
    gif: "image/gif", bmp: "image/bmp", webp: "image/webp",
    svg: "image/svg+xml", emf: "image/x-emf", wmf: "image/x-wmf",
  };
  for (const ext of contentTypeDefaults) {
    if (ext !== "rels" && ext !== "xml" && extMimeMap[ext]) {
      ctXml += `\n  <Default Extension="${ext}" ContentType="${extMimeMap[ext]}"/>`;
    }
  }
  ctXml += `\n  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
  zip.file("[Content_Types].xml", ctXml);

  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);

  // document.xml.rels with image relationships
  let docRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`;
  for (const entry of imageEntries) {
    docRelsXml += `\n  <Relationship Id="${entry.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image_${entry.drawingId}.${entry.ext}"/>`;
  }
  docRelsXml += `\n</Relationships>`;
  zip.file("word/_rels/document.xml.rels", docRelsXml);

  const blob = await zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  return blob;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
