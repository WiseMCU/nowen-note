import React, { useCallback, useMemo, useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { NodeViewWrapper, NodeViewContent, NodeViewProps } from "@tiptap/react";
import { Copy, Check, ChevronDown, Palette } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  CODE_BLOCK_THEMES,
  CodeBlockThemeId,
  getSavedCodeBlockTheme,
  setCodeBlockTheme,
} from "@/lib/codeBlockTheme";

/**
 * 自定义代码块视图：
 *  - 顶部工具条：语言切换下拉 + 复制按钮
 *  - 行号区（使用 CSS counter 自动生成，无需侵入 ProseMirror 内容模型）
 *  - 深色代码区与浅色页面形成清晰对比，突出代码语义
 */

// 常用语言列表（超集由 lowlight.common 决定）
const POPULAR_LANGUAGES = [
  "auto", "plaintext",
  "javascript", "typescript", "tsx", "jsx",
  "html", "css", "scss", "json", "xml",
  "python", "java", "c", "cpp", "csharp",
  "go", "rust", "php", "ruby", "kotlin", "swift",
  "bash", "shell", "powershell",
  "sql", "yaml", "markdown", "diff", "dockerfile",
];

function formatLanguageLabel(raw: string | null | undefined): string {
  if (!raw) return "auto";
  const v = raw.toLowerCase();
  if (v === "plaintext" || v === "text") return "text";
  return v;
}

export function CodeBlockView(props: NodeViewProps) {
  const { node, updateAttributes, extension } = props;
  const lowlight = (extension.options as any)?.lowlight;

  const currentLang: string = node.attrs.language || "auto";
  const [copied, setCopied] = useState(false);
  const [showLangPicker, setShowLangPicker] = useState(false);
  const [langFilter, setLangFilter] = useState("");
  const [showThemePicker, setShowThemePicker] = useState(false);
  const [activeTheme, setActiveTheme] = useState<CodeBlockThemeId>(getSavedCodeBlockTheme);

  // 下拉面板锚点按钮 ref，用于计算 fixed 弹出位置（避免被代码块容器 overflow-hidden 裁剪）
  const langBtnRef = useRef<HTMLButtonElement | null>(null);
  const themeBtnRef = useRef<HTMLButtonElement | null>(null);
  const [langPopupPos, setLangPopupPos] = useState<{ top: number; left: number; placement: "bottom" | "top" } | null>(null);
  const [themePopupPos, setThemePopupPos] = useState<{ top: number; right: number; placement: "bottom" | "top" } | null>(null);

  // 语言下拉宽度 / 主题下拉宽度（与原样式保持一致：w-48 / w-52）
  const LANG_POPUP_WIDTH = 192; // w-48
  const THEME_POPUP_WIDTH = 208; // w-52
  // 预估面板最大高度（含搜索框/标题与列表）
  const LANG_POPUP_MAX_H = 260;
  const THEME_POPUP_MAX_H = 300;

  const computeLangPopupPos = useCallback(() => {
    const btn = langBtnRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const placement: "bottom" | "top" = spaceBelow < LANG_POPUP_MAX_H && rect.top > spaceBelow ? "top" : "bottom";
    const top = placement === "bottom" ? rect.bottom + 4 : Math.max(8, rect.top - 4 - LANG_POPUP_MAX_H);
    // 左对齐按钮，同时避免超出右边界
    const left = Math.min(
      Math.max(8, rect.left),
      window.innerWidth - LANG_POPUP_WIDTH - 8,
    );
    setLangPopupPos({ top, left, placement });
  }, []);

  const computeThemePopupPos = useCallback(() => {
    const btn = themeBtnRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const placement: "bottom" | "top" = spaceBelow < THEME_POPUP_MAX_H && rect.top > spaceBelow ? "top" : "bottom";
    const top = placement === "bottom" ? rect.bottom + 4 : Math.max(8, rect.top - 4 - THEME_POPUP_MAX_H);
    // 右对齐按钮
    const right = Math.max(8, window.innerWidth - rect.right);
    setThemePopupPos({ top, right, placement });
  }, []);

  // 订阅全局主题变化，使同文档多个代码块同步刷新高亮（UI 内选中态）
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<CodeBlockThemeId>).detail;
      if (detail) setActiveTheme(detail);
    };
    window.addEventListener("nowen:codeblock-theme-change", handler);
    return () => window.removeEventListener("nowen:codeblock-theme-change", handler);
  }, []);

  // 构造可选语言列表：lowlight 已注册 ∪ 常用语言（去重并排序）
  const availableLanguages = useMemo(() => {
    let registered: string[] = [];
    try {
      if (lowlight && typeof lowlight.listLanguages === "function") {
        registered = lowlight.listLanguages();
      }
    } catch {
      /* ignore */
    }
    const set = new Set<string>(["auto", "plaintext", ...registered, ...POPULAR_LANGUAGES]);
    return Array.from(set).sort((a, b) => {
      if (a === "auto") return -1;
      if (b === "auto") return 1;
      if (a === "plaintext") return -1;
      if (b === "plaintext") return 1;
      return a.localeCompare(b);
    });
  }, [lowlight]);

  const filteredLanguages = useMemo(() => {
    const q = langFilter.trim().toLowerCase();
    if (!q) return availableLanguages;
    return availableLanguages.filter((l) => l.toLowerCase().includes(q));
  }, [availableLanguages, langFilter]);

  const handleCopy = useCallback(async () => {
    try {
      const text = node.textContent;
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        // 降级：textarea + execCommand
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand("copy");
        } finally {
          document.body.removeChild(ta);
        }
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error("Copy code block failed:", err);
    }
  }, [node]);

  const handleSelectLanguage = useCallback(
    (lang: string) => {
      updateAttributes({ language: lang === "auto" ? null : lang });
      setShowLangPicker(false);
      setLangFilter("");
    },
    [updateAttributes],
  );

  // 点击外部关闭语言选择器
  useEffect(() => {
    if (!showLangPicker) return;
    const handleDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (!target.closest("[data-codeblock-langpicker]")) {
        setShowLangPicker(false);
        setLangFilter("");
      }
    };
    // 微任务延迟，避免与触发按钮同一 tick 冲突
    const id = setTimeout(() => document.addEventListener("mousedown", handleDocClick), 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener("mousedown", handleDocClick);
    };
  }, [showLangPicker]);

  // 打开语言选择器时计算位置；滚动/resize 时重算或关闭
  useEffect(() => {
    if (!showLangPicker) {
      setLangPopupPos(null);
      return;
    }
    computeLangPopupPos();
    const onScrollOrResize = () => {
      // 滚动时直接关闭，避免位置错乱
      setShowLangPicker(false);
      setLangFilter("");
    };
    window.addEventListener("resize", onScrollOrResize);
    window.addEventListener("scroll", onScrollOrResize, true);
    return () => {
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("scroll", onScrollOrResize, true);
    };
  }, [showLangPicker, computeLangPopupPos]);

  // 点击外部关闭主题选择器
  useEffect(() => {
    if (!showThemePicker) return;
    const handleDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (!target.closest("[data-codeblock-themepicker]")) {
        setShowThemePicker(false);
      }
    };
    const id = setTimeout(() => document.addEventListener("mousedown", handleDocClick), 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener("mousedown", handleDocClick);
    };
  }, [showThemePicker]);

  // 打开主题选择器时计算位置；滚动/resize 时关闭
  useEffect(() => {
    if (!showThemePicker) {
      setThemePopupPos(null);
      return;
    }
    computeThemePopupPos();
    const onScrollOrResize = () => setShowThemePicker(false);
    window.addEventListener("resize", onScrollOrResize);
    window.addEventListener("scroll", onScrollOrResize, true);
    return () => {
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("scroll", onScrollOrResize, true);
    };
  }, [showThemePicker, computeThemePopupPos]);

  const handleSelectTheme = useCallback((theme: CodeBlockThemeId) => {
    setCodeBlockTheme(theme);
    setActiveTheme(theme);
    setShowThemePicker(false);
  }, []);

  return (
    <NodeViewWrapper
      className="code-block-wrapper group relative my-4 rounded-xl overflow-hidden border shadow-sm"
    >
      {/* 顶部工具栏（不可编辑） */}
      <div
        className="code-block-toolbar flex items-center justify-between px-3 py-1.5 border-b select-none"
        contentEditable={false}
      >
        {/* 左侧：mac 风格小圆点 + 语言徽章（可点击切换） */}
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
          </span>

          <div className="relative" data-codeblock-langpicker>
            <button
              ref={langBtnRef}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowLangPicker((v) => !v);
                setShowThemePicker(false);
              }}
              className="code-block-tool-btn flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] font-mono transition-colors"
              title="切换语言"
            >
              <span>{formatLanguageLabel(currentLang)}</span>
              <ChevronDown size={11} />
            </button>

            {showLangPicker && langPopupPos && createPortal(
              <div
                data-codeblock-langpicker
                className="code-block-popup border rounded-md shadow-xl overflow-hidden"
                style={{
                  position: "fixed",
                  top: langPopupPos.top,
                  left: langPopupPos.left,
                  width: LANG_POPUP_WIDTH,
                  zIndex: 1000,
                  animation: "contextMenuIn 0.12s ease-out",
                }}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <input
                  autoFocus
                  value={langFilter}
                  onChange={(e) => setLangFilter(e.target.value)}
                  placeholder="搜索语言..."
                  className="code-block-popup-input w-full px-2 py-1.5 border-b text-[11px] focus:outline-none"
                />
                <div className="max-h-56 overflow-auto py-1">
                  {filteredLanguages.length === 0 ? (
                    <div className="code-block-popup-empty px-2 py-1.5 text-[11px]">无匹配</div>
                  ) : (
                    filteredLanguages.map((lang) => (
                      <button
                        key={lang}
                        type="button"
                        onClick={() => handleSelectLanguage(lang)}
                        className={cn(
                          "code-block-popup-item w-full text-left px-2 py-1 text-[11px] font-mono transition-colors",
                          lang === (currentLang || "auto") && "is-active",
                        )}
                      >
                        {lang}
                      </button>
                    ))
                  )}
                </div>
              </div>,
              document.body,
            )}
          </div>
        </div>

        {/* 右侧：主题切换 + 复制按钮 */}
        <div className="flex items-center gap-1">
          <div className="relative" data-codeblock-themepicker>
            <button
              ref={themeBtnRef}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowThemePicker((v) => !v);
                setShowLangPicker(false);
              }}
              className="code-block-tool-btn flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors"
              title="切换代码块主题"
            >
              <Palette size={12} />
              <span className="hidden sm:inline">主题</span>
            </button>

            {showThemePicker && themePopupPos && createPortal(
              <div
                data-codeblock-themepicker
                className="code-block-popup border rounded-md shadow-xl overflow-hidden"
                style={{
                  position: "fixed",
                  top: themePopupPos.top,
                  right: themePopupPos.right,
                  width: THEME_POPUP_WIDTH,
                  zIndex: 1000,
                  animation: "contextMenuIn 0.12s ease-out",
                }}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <div className="code-block-popup-title px-2 py-1.5 text-[11px] font-medium border-b">
                  代码块主题
                </div>
                <div className="max-h-64 overflow-auto py-1">
                  {CODE_BLOCK_THEMES.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => handleSelectTheme(t.id)}
                      className={cn(
                        "code-block-popup-item w-full text-left px-2 py-1.5 text-[11px] transition-colors flex items-center gap-2",
                        t.id === activeTheme && "is-active",
                      )}
                    >
                      <span
                        className="w-5 h-5 rounded border shrink-0 flex items-center justify-center"
                        style={{
                          background: t.preview.bg,
                          borderColor: "rgba(128,128,128,0.35)",
                        }}
                      >
                        <span
                          className="w-2 h-2 rounded-sm"
                          style={{ background: t.preview.accent }}
                        />
                      </span>
                      <span className="flex-1">{t.label}</span>
                      {t.id === activeTheme && <Check size={12} />}
                    </button>
                  ))}
                </div>
              </div>,
              document.body,
            )}
          </div>

          <button
            type="button"
            onClick={handleCopy}
            className={cn(
              "code-block-tool-btn flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors",
              copied && "is-copied",
            )}
            title={copied ? "已复制" : "复制代码"}
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            <span>{copied ? "已复制" : "复制"}</span>
          </button>
        </div>
      </div>

      {/* 代码内容区 */}
      <pre className="code-block-pre">
        <NodeViewContent
          // NodeViewContent 的类型声明把 as 限制为 "div"，但 Tiptap 运行时实际支持任意 tag；
          // 这里我们就是要 <code> 以便让 highlight.js / 复制按钮的语义正确。断言绕过类型窄化。
          as={"code" as "div"}
          className={cn(
            "code-block-content hljs",
            currentLang && currentLang !== "auto" && `language-${currentLang}`,
          )}
          style={{ whiteSpace: "pre" }}
        />
      </pre>
    </NodeViewWrapper>
  );
}

export default CodeBlockView;
