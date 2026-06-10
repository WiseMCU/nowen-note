const CJK_CHAR_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g;
const CJK_CHAR_SINGLE_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const CJK_PROSE_PUNCTUATION_RE = /[，。！？；：、“”‘’（）]/g;
const CODE_KEYWORD_RE =
  /\b(?:const|let|var|function|class|interface|type|enum|import|export|return|if|else|for|while|switch|case|break|continue|try|catch|finally|async|await|public|private|protected|extends|implements|new|def|lambda|func|package|namespace|using)\b/;
const SHELL_COMMAND_RE =
  /^(?:\$ ?)?(?:npm|pnpm|yarn|bun|npx|node|git|docker|docker-compose|kubectl|helm|cd|ls|dir|mkdir|rm|cp|mv|curl|wget|python|pip|uv|go|cargo|java|javac|gradle|adb|fastboot|ssh|scp|rsync|cat|echo)\b/i;
const SQL_RE =
  /\b(?:select|insert|update|delete|create|alter|drop|from|where|join|group\s+by|order\s+by|limit|values|into|set)\b/i;
const CODE_OPERATOR_RE = /(?:=>|==={0,1}|!==|<=|>=|&&|\|\||::|:=|->|<-)/;
const XML_HTML_RE = /<\/?[A-Za-z][\w:-]*(?:\s[^>]*)?>/;
const STACK_TRACE_RE = /^\s*at\s+.+\(.+\)$/;
const JSON_PROPERTY_RE = /^\s*(?:"[^"]+"|'[^']+'|[\w.-]+)\s*:\s*.+,?\s*$/;
const ASSIGNMENT_RE = /^(?:(?:const|let|var)\s+)?[\w$.[\]-]+\s*=\s*.+$/;
const FUNCTION_CALL_RE = /^[\w$./:-]+\s*\([^)]*\)\s*[;{]?\s*$/;
const CODE_HTML_HINT_RE =
  /(?:class|style)=["'][^"']*(?:language-|hljs|highlight|monospace|white-space\s*:\s*pre)/i;
const RICH_TEXT_HTML_RE =
  /<(?:p|blockquote|ul|ol|li|table|thead|tbody|tr|td|th|h[1-6]|figure|figcaption|img|a)\b/i;

function normalizeMultilineText(text: string): string {
  return text.replace(/\r\n?/g, "\n").trim();
}

function countMatches(text: string, pattern: RegExp): number {
  const matches = text.match(pattern);
  return matches ? matches.length : 0;
}

function collectHtmlTags(html: string): string[] {
  return Array.from(
    html.matchAll(/<\/?([a-z0-9-]+)/gi),
    (match) => match[1].toLowerCase()
  );
}

export function looksLikeCode(text: string): boolean {
  const normalized = normalizeMultilineText(text);
  if (!normalized || !normalized.includes("\n")) return false;

  const lines = normalized
    .split("\n")
    .map((line) => line.replace(/\s+$/g, ""))
    .filter((line) => line.trim().length > 0);

  if (lines.length < 2) return false;

  const visible = normalized.replace(/\s/g, "");
  if (!visible.length) return false;

  const cjkRatio = countMatches(visible, CJK_CHAR_RE) / visible.length;
  const cjkPunctuationCount = countMatches(normalized, CJK_PROSE_PUNCTUATION_RE);

  if (cjkRatio > 0.18 && cjkPunctuationCount >= 2) return false;

  const isJsonLike =
    /^[\[{]\s*$/.test(lines[0]) &&
    /^[\]}]\s*,?\s*$/.test(lines[lines.length - 1]) &&
    lines.filter((line) => JSON_PROPERTY_RE.test(line)).length >= 1;

  if (isJsonLike) return true;

  let score = 0;
  let strongSignals = 0;
  let matchingLines = 0;
  let proseLikeLines = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    let lineScore = 0;
    let hasStrongSignal = false;

    const looksLikeSentence = CJK_CHAR_SINGLE_RE.test(trimmed)
      ? (/[，。！？；：]/.test(trimmed) ||
          (trimmed.length >= 10 &&
            !CODE_OPERATOR_RE.test(trimmed) &&
            !/[{}[\];<>]/.test(trimmed)))
      : /[a-z]/i.test(trimmed) && /\s/.test(trimmed) && /[.!?]$/.test(trimmed);

    if (looksLikeSentence) proseLikeLines++;
    if (/^(\t| {2,})\S/.test(line)) lineScore += 1;

    if (SHELL_COMMAND_RE.test(trimmed)) {
      lineScore += 3;
      hasStrongSignal = true;
    }

    if (CODE_KEYWORD_RE.test(trimmed)) {
      lineScore += 3;
      hasStrongSignal = true;
    }

    if (SQL_RE.test(trimmed) && /\b(?:from|into|set|where|values)\b/i.test(trimmed)) {
      lineScore += 3;
      hasStrongSignal = true;
    }

    if (STACK_TRACE_RE.test(trimmed)) {
      lineScore += 3;
      hasStrongSignal = true;
    }

    if (CODE_OPERATOR_RE.test(trimmed)) {
      lineScore += 2;
      hasStrongSignal = true;
    }

    if (XML_HTML_RE.test(trimmed)) {
      lineScore += 2;
      hasStrongSignal = true;
    }

    if (JSON_PROPERTY_RE.test(trimmed) || ASSIGNMENT_RE.test(trimmed)) {
      lineScore += 1;
    }

    if (FUNCTION_CALL_RE.test(trimmed)) {
      lineScore += 1;
    }

    if (/^[{[(]\s*$|^[}\])]\s*[,;]?$/.test(trimmed)) {
      lineScore += 1;
    }

    if ((/[{}[\]]/.test(trimmed) && /[;=]/.test(trimmed)) || /[;{}]\s*$/.test(trimmed)) {
      lineScore += 1;
    }

    if (lineScore > 0) matchingLines++;
    if (hasStrongSignal) strongSignals++;
    score += lineScore;
  }

  if (proseLikeLines >= Math.ceil(lines.length / 2) && strongSignals < 2) return false;
  if (cjkRatio > 0.08 && strongSignals < 2) return false;

  const requiredMatches = Math.max(2, Math.ceil(lines.length * 0.5));
  if (strongSignals >= 2 && matchingLines >= requiredMatches) return true;
  if (score >= Math.max(5, lines.length + 1) && matchingLines >= Math.max(2, Math.ceil(lines.length * 0.6))) {
    return true;
  }

  return false;
}

export function looksLikeCodeHtml(html: string): boolean {
  const trimmed = html.trim();
  if (!trimmed) return false;
  if (/<(?:pre|code)\b/i.test(trimmed)) return true;
  if (CODE_HTML_HINT_RE.test(trimmed)) return true;
  if (RICH_TEXT_HTML_RE.test(trimmed)) return false;

  const tags = collectHtmlTags(trimmed);
  if (tags.length === 0) return false;

  const allowedTags = new Set([
    "div",
    "span",
    "br",
    "meta",
    "font",
    "b",
    "strong",
    "i",
    "em",
    "u",
    "s",
  ]);

  return tags.every((tag) => allowedTags.has(tag));
}

export function shouldUseCodeBlockPaste(text: string, html: string): boolean {
  if (!looksLikeCode(text)) return false;

  const trimmedHtml = html.trim();
  if (!trimmedHtml) return true;

  return looksLikeCodeHtml(trimmedHtml);
}
