import { describe, expect, it } from "vitest";
import { htmlToMarkdownForExport } from "@/lib/exportService";

describe("htmlToMarkdownForExport", () => {
  it("保留富文本空段落为空白行", () => {
    const md = htmlToMarkdownForExport("<p>A</p><p></p><p>B</p>");

    expect(md).toBe("A\n\n\nB");
  });

  it("保留 <p><br></p> 形式的空段落", () => {
    const md = htmlToMarkdownForExport("<p>A</p><p><br></p><p>B</p>");

    expect(md).toBe("A\n\n\nB");
  });

  it("不会折叠代码块里的空行", () => {
    const md = htmlToMarkdownForExport("<pre><code>line1\n\nline2</code></pre>");

    expect(md).toContain("line1\n\nline2");
  });
});
