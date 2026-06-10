import { describe, expect, it } from "vitest";
import { markdownToSimpleHtml } from "@/lib/importService";

describe("markdownToSimpleHtml", () => {
  it("将连续空行还原为真正空段落", () => {
    const html = markdownToSimpleHtml("A\n\n\nB");

    expect(html).toContain("<p>A</p>");
    expect(html).toContain("<p></p>");
    expect(html).toContain("<p>B</p>");
  });
});
