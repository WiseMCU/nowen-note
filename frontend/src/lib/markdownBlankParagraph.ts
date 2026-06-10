export const NOWEN_BLANK_PARAGRAPH_HTML = '<p data-nowen-blank="true"><br></p>';

const NOWEN_BLANK_PARAGRAPH_BLOCK_SOURCE = String.raw`<(?:p|div)\b[^>]*\bdata-nowen-blank\s*=\s*(?:"true"|'true')[^>]*>\s*(?:&nbsp;|&#160;|\u00a0|\s|<br\s*\/?>)*<\/(?:p|div)>`;

const NOWEN_BLANK_PARAGRAPH_RUN_RE = new RegExp(
  `${NOWEN_BLANK_PARAGRAPH_BLOCK_SOURCE}(?:\\s*${NOWEN_BLANK_PARAGRAPH_BLOCK_SOURCE})*`,
  "gi",
);

function countBlankParagraphBlocks(input: string): number {
  return input.match(new RegExp(NOWEN_BLANK_PARAGRAPH_BLOCK_SOURCE, "gi"))?.length || 0;
}

export function repeatNowenBlankParagraphHtml(count: number): string {
  return Array.from(
    { length: Math.max(0, count) },
    () => NOWEN_BLANK_PARAGRAPH_HTML,
  ).join("\n\n");
}

export function replaceNowenBlankParagraphRuns(
  input: string,
  replacer: (count: number, match: string) => string,
): string {
  if (!input) return input;
  return input.replace(NOWEN_BLANK_PARAGRAPH_RUN_RE, (match) => {
    const count = countBlankParagraphBlocks(match) || 1;
    return replacer(count, match);
  });
}

export function normalizeNowenBlankParagraphHtmlForImport(html: string): string {
  return replaceNowenBlankParagraphRuns(html, (count) =>
    Array.from({ length: count }, () => "<p></p>").join(""),
  );
}

export function replaceNowenBlankParagraphMarkdownWithPlaceholder(
  md: string,
  placeholder: string,
): string {
  return replaceNowenBlankParagraphRuns(
    md,
    (count) => `\n\n${Array.from({ length: count }, () => placeholder).join("")}\n\n`,
  );
}
