import { describe, expect, it } from "vitest";
import { htmlToMarkdownForExport } from "@/lib/exportService";
import { NOWEN_BLANK_PARAGRAPH_HTML } from "@/lib/markdownBlankParagraph";

describe("htmlToMarkdownForExport", () => {
  it("将富文本空段落导出为可预览的空段落标记", () => {
    const md = htmlToMarkdownForExport("<p>A</p><p></p><p>B</p>");

    expect(md).toBe(`A\n\n${NOWEN_BLANK_PARAGRAPH_HTML}\n\nB`);
  });

  it("保留 <p><br></p> 形式的空段落", () => {
    const md = htmlToMarkdownForExport("<p>A</p><p><br></p><p>B</p>");

    expect(md).toBe(`A\n\n${NOWEN_BLANK_PARAGRAPH_HTML}\n\nB`);
  });

  it("不会折叠代码块里的空行", () => {
    const md = htmlToMarkdownForExport("<pre><code>line1\n\nline2</code></pre>");

    expect(md).toContain("line1\n\nline2");
  });
});
