import { describe, expect, it } from "vitest";
import { markdownToSimpleHtml } from "@/lib/importService";
import { NOWEN_BLANK_PARAGRAPH_HTML } from "@/lib/markdownBlankParagraph";

describe("markdownToSimpleHtml", () => {
  it("将导出的空段落标记还原为真正空段落", () => {
    const html = markdownToSimpleHtml(`A\n\n${NOWEN_BLANK_PARAGRAPH_HTML}\n\nB`);

    expect(html).toContain("<p>A</p>");
    expect(html).toContain("<p></p>");
    expect(html).toContain("<p>B</p>");
    expect(html).not.toContain('data-nowen-blank="true"');
  });
});
