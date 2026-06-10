import { describe, expect, it } from "vitest";

import {
  looksLikeCode,
  looksLikeCodeHtml,
  shouldUseCodeBlockPaste,
} from "@/lib/pasteHeuristics";

describe("looksLikeCode", () => {
  it("保留明显的 JavaScript 代码片段识别", () => {
    const text = [
      "const total = items.length;",
      "if (total > 0) {",
      "  console.log(total);",
      "}",
    ].join("\n");

    expect(looksLikeCode(text)).toBe(true);
  });

  it("保留多行命令行片段识别", () => {
    const text = ["npm install", "cd /tmp", "mkdir demo"].join("\n");

    expect(looksLikeCode(text)).toBe(true);
  });

  it("保留 JSON 片段识别", () => {
    const text = ['{', '  "name": "nowen-note",', '  "private": true', "}"].join("\n");

    expect(looksLikeCode(text)).toBe(true);
  });

  it("避免把普通中文笔记误判成代码", () => {
    const text = [
      "今天整理了 API 密钥汇总。",
      "第二段是给运维同学的说明，先确认环境变量是否已经更新。",
      "如果需要回滚，再去发布记录里看一下对应版本。",
    ].join("\n");

    expect(looksLikeCode(text)).toBe(false);
  });

  it("避免把普通英文段落误判成代码", () => {
    const text = [
      "This note explains how the release was coordinated.",
      "Please review the follow-up items before sharing the summary.",
      "The rest of the checklist lives in the project tracker.",
    ].join("\n");

    expect(looksLikeCode(text)).toBe(false);
  });
});

describe("looksLikeCodeHtml", () => {
  it("识别 pre/code HTML", () => {
    expect(looksLikeCodeHtml("<pre><code>const x = 1;</code></pre>")).toBe(true);
  });

  it("普通富文本段落不当作代码 HTML", () => {
    expect(looksLikeCodeHtml("<p>第一段</p><p>第二段</p>")).toBe(false);
  });
});

describe("shouldUseCodeBlockPaste", () => {
  it("普通富文本笔记粘贴优先走 HTML", () => {
    const text = ["第一段内容", "第二段内容"].join("\n");
    const html = "<p>第一段内容</p><p>第二段内容</p>";

    expect(shouldUseCodeBlockPaste(text, html)).toBe(false);
  });

  it("VS Code 风格的代码 HTML 仍然允许代码块粘贴", () => {
    const text = ["const answer = 42;", "console.log(answer);"].join("\n");
    const html = [
      '<meta charset="utf-8">',
      '<div><span style="color:#0000ff">const</span> answer = 42;</div>',
      "<div>console.log(answer);</div>",
    ].join("");

    expect(shouldUseCodeBlockPaste(text, html)).toBe(true);
  });
});
