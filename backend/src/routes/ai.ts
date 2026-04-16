import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { getDb } from "../db/schema";

const ai = new Hono();

// ===== AI 设置管理 =====

export interface AISettings {
  ai_provider: string;       // "openai" | "ollama" | "custom" | "qwen" | "deepseek" | "gemini" | "doubao"
  ai_api_url: string;        // API 端点
  ai_api_key: string;        // API Key（Ollama 可为空）
  ai_model: string;          // 模型名称
}

const AI_DEFAULTS: AISettings = {
  ai_provider: "openai",
  ai_api_url: "https://api.openai.com/v1",
  ai_api_key: "",
  ai_model: "gpt-4o-mini",
};

// 不需要 API Key 的 Provider
const NO_KEY_PROVIDERS = ["ollama"];

// Docker 环境下 Ollama 使用内部 URL
const OLLAMA_DOCKER_URL = process.env.OLLAMA_URL || "";

function getAISettings(): AISettings {
  const db = getDb();
  const rows = db.prepare("SELECT key, value FROM system_settings WHERE key LIKE 'ai_%'").all() as { key: string; value: string }[];
  const result: AISettings = { ...AI_DEFAULTS };
  for (const row of rows) {
    (result as any)[row.key] = row.value;
  }
  // Docker 环境下自动替换 Ollama localhost URL 为内部容器 URL
  if (OLLAMA_DOCKER_URL && result.ai_provider === "ollama" && result.ai_api_url.includes("localhost:11434")) {
    result.ai_api_url = result.ai_api_url.replace(/http:\/\/localhost:11434/, OLLAMA_DOCKER_URL);
  }
  return result;
}

// GET /api/ai/settings
ai.get("/settings", (c) => {
  const settings = getAISettings();
  // 不返回完整 API Key，只返回掩码
  return c.json({
    ...settings,
    ai_api_key: settings.ai_api_key ? "sk-****" + settings.ai_api_key.slice(-4) : "",
    ai_api_key_set: !!settings.ai_api_key,
  });
});

// PUT /api/ai/settings
ai.put("/settings", async (c) => {
  const body = await c.req.json() as Partial<AISettings>;
  const db = getDb();

  const upsert = db.prepare(`
    INSERT INTO system_settings (key, value, updatedAt)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = datetime('now')
  `);

  const tx = db.transaction(() => {
    if (body.ai_provider !== undefined) {
      upsert.run("ai_provider", body.ai_provider);
    }
    if (body.ai_api_url !== undefined) {
      upsert.run("ai_api_url", body.ai_api_url.replace(/\/+$/, ""));
    }
    if (body.ai_api_key !== undefined && !body.ai_api_key.includes("****")) {
      upsert.run("ai_api_key", body.ai_api_key);
    }
    if (body.ai_model !== undefined) {
      upsert.run("ai_model", body.ai_model);
    }
  });
  tx();

  const settings = getAISettings();
  return c.json({
    ...settings,
    ai_api_key: settings.ai_api_key ? "sk-****" + settings.ai_api_key.slice(-4) : "",
    ai_api_key_set: !!settings.ai_api_key,
  });
});

// ===== AI 连接测试 =====
ai.post("/test", async (c) => {
  const settings = getAISettings();
  if (!settings.ai_api_url) {
    return c.json({ success: false, error: "未配置 API 地址" }, 400);
  }
  if (!NO_KEY_PROVIDERS.includes(settings.ai_provider) && !settings.ai_api_key) {
    return c.json({ success: false, error: "未配置 API Key" }, 400);
  }

  // 规范化 URL：去除末尾斜杠，避免拼接出双斜杠
  const baseUrl = settings.ai_api_url.replace(/\/+$/, "");

  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (settings.ai_api_key) {
      headers["Authorization"] = `Bearer ${settings.ai_api_key}`;
    }

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: settings.ai_model,
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 5,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      // 如果是 Ollama 且返回 405，尝试回退到 Ollama 原生 API 进行连接测试
      if (settings.ai_provider === "ollama" && res.status === 405) {
        // 从 URL 中提取 Ollama 基础地址（去掉 /v1 后缀）
        const ollamaBase = baseUrl.replace(/\/v1$/, "");
        try {
          const fallbackRes = await fetch(`${ollamaBase}/api/tags`, {
            method: "GET",
            signal: AbortSignal.timeout(10000),
          });
          if (fallbackRes.ok) {
            return c.json({
              success: true,
              message: "连接成功（Ollama 原生 API）。注意：当前 Ollama 版本可能不支持 OpenAI 兼容接口（/v1/chat/completions），请升级 Ollama 至 v0.1.14 或更高版本以获得完整功能支持。",
            });
          }
        } catch { /* 回退也失败，返回原始错误 */ }
      }

      const err = await res.text();
      return c.json({ success: false, error: `API 返回 ${res.status}: ${err.slice(0, 200)}` }, 400);
    }

    return c.json({ success: true, message: "连接成功" });
  } catch (err: any) {
    return c.json({ success: false, error: err.message || "连接失败" }, 500);
  }
});

// ===== 获取模型列表 =====
ai.get("/models", async (c) => {
  const settings = getAISettings();
  if (!settings.ai_api_url) {
    return c.json({ models: [] });
  }

  try {
    const headers: Record<string, string> = {};
    if (settings.ai_api_key) {
      headers["Authorization"] = `Bearer ${settings.ai_api_key}`;
    }

    const res = await fetch(`${settings.ai_api_url.replace(/\/+$/, "")}/models`, {
      headers,
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      return c.json({ models: [] });
    }

    const data = await res.json();
    const models = (data.data || data.models || []).map((m: any) => ({
      id: m.id || m.name,
      name: m.id || m.name,
    }));
    return c.json({ models });
  } catch {
    return c.json({ models: [] });
  }
});

// ===== AI 写作助手（流式 SSE） =====

type AIAction = "continue" | "rewrite" | "polish" | "shorten" | "expand" | "translate_en" | "translate_zh" | "summarize" | "explain" | "fix_grammar" | "title" | "tags" | "format_markdown" | "format_code" | "custom";

const ACTION_PROMPTS: Record<AIAction, string> = {
  continue: "请根据上下文，自然流畅地续写以下内容。不要重复已有内容，直接输出续写部分：",
  rewrite: "请用不同的表达方式改写以下内容，保持原意不变：",
  polish: "请对以下内容进行润色，使其更加专业流畅，保持原意：",
  shorten: "请将以下内容精简压缩，保留核心要点，去除冗余：",
  expand: "请对以下内容进行扩展，增加更多细节和解释，使其更充实：",
  translate_en: "请将以下内容翻译为英文，保持原意和风格：",
  translate_zh: "请将以下内容翻译为中文，保持原意和风格：",
  summarize: "请为以下内容生成一个简洁的摘要（100字以内）：",
  explain: "请用通俗易懂的语言解释以下内容：",
  fix_grammar: "请修正以下内容中的语法和拼写错误，只返回修正后的文本：",
  format_markdown: "请将以下内容按照规范的 Markdown 格式重新排版，合理使用标题、列表、代码块、表格、加粗、引用等格式元素，保持原意不变，使内容结构更清晰：",
  format_code: "请识别以下内容中的代码部分，用正确的编程语言标记包裹在代码块中（如 ```python），保持代码缩进和格式正确。如果内容本身就是纯代码，直接用代码块包裹并标注语言：",
  custom: "",
  title: "请根据以下笔记内容，生成一个简洁准确的标题（10字以内），只返回标题文本，不要加引号或其他标点：",
  tags: "请根据以下笔记内容，推荐3-5个标签关键词。每个标签用逗号分隔，只返回标签文本，不要加#号：",
};

ai.post("/chat", async (c) => {
  const settings = getAISettings();
  if (!settings.ai_api_url) {
    return c.json({ error: "未配置 AI 服务" }, 400);
  }
  if (!NO_KEY_PROVIDERS.includes(settings.ai_provider) && !settings.ai_api_key) {
    return c.json({ error: "未配置 API Key" }, 400);
  }

  const { action, text, context, customPrompt } = await c.req.json() as {
    action: AIAction;
    text: string;
    context?: string;
    customPrompt?: string;
  };

  if (!action || !text) {
    return c.json({ error: "参数不完整" }, 400);
  }

  // 自定义指令：使用用户传入的 prompt
  let systemPrompt: string;
  if (action === "custom") {
    if (!customPrompt?.trim()) {
      return c.json({ error: "请输入自定义指令" }, 400);
    }
    systemPrompt = customPrompt.trim() + "：";
  } else {
    systemPrompt = ACTION_PROMPTS[action];
    if (!systemPrompt) {
      return c.json({ error: "不支持的操作类型" }, 400);
    }
  }

  const messages: { role: string; content: string }[] = [
    { role: "system", content: "你是一个专业的写作助手，帮助用户优化笔记内容。请直接输出结果，不要添加额外的解释或前缀。" },
  ];

  if (context) {
    messages.push({ role: "system", content: `笔记上下文：\n${context.slice(0, 2000)}` });
  }

  messages.push({ role: "user", content: `${systemPrompt}\n\n${text}` });

  // 规范化 URL：去除末尾斜杠，避免拼接出双斜杠
  const baseUrl = settings.ai_api_url.replace(/\/+$/, "");

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (settings.ai_api_key) {
    headers["Authorization"] = `Bearer ${settings.ai_api_key}`;
  }

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: settings.ai_model,
        messages,
        stream: true,
        temperature: action === "fix_grammar" ? 0.1 : action === "format_code" ? 0.2 : 0.7,
        max_tokens: action === "title" ? 50 : action === "tags" ? 100 : action === "summarize" ? 300 : action === "custom" ? 4000 : 2000,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return c.json({ error: `AI 服务错误: ${res.status} ${err.slice(0, 200)}` }, 502);
    }

    // SSE streaming
    return streamSSE(c, async (stream) => {
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data: ")) continue;
            const data = trimmed.slice(6);
            if (data === "[DONE]") {
              await stream.writeSSE({ data: "[DONE]", event: "done" });
              return;
            }
            try {
              const json = JSON.parse(data);
              const content = json.choices?.[0]?.delta?.content;
              if (content) {
                await stream.writeSSE({ data: content, event: "message" });
              }
            } catch {
              // skip malformed JSON
            }
          }
        }
        await stream.writeSSE({ data: "[DONE]", event: "done" });
      } catch (err) {
        await stream.writeSSE({ data: "流式传输中断", event: "error" });
      }
    });
  } catch (err: any) {
    return c.json({ error: err.message || "AI 请求失败" }, 500);
  }
});

// ===== 知识库问答 RAG =====
ai.post("/ask", async (c) => {
  const settings = getAISettings();
  if (!settings.ai_api_url) {
    return c.json({ error: "未配置 AI 服务" }, 400);
  }
  if (!NO_KEY_PROVIDERS.includes(settings.ai_provider) && !settings.ai_api_key) {
    return c.json({ error: "未配置 API Key" }, 400);
  }

  const { question, history } = await c.req.json() as {
    question: string;
    history?: { role: string; content: string }[];
  };

  if (!question) {
    return c.json({ error: "请输入问题" }, 400);
  }

  // 1. 使用 FTS5 检索相关笔记
  const db = getDb();
  const userId = c.req.header("X-User-Id") || "demo";

  // 将问题分词为搜索关键词（简单拆分）
  const keywords = question
    .replace(/[?？!！。，,.\s]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(k => k.length > 1)
    .slice(0, 5);

  let relatedNotes: { id: string; title: string; snippet: string }[] = [];

  if (keywords.length > 0) {
    // FTS5 OR 查询
    const ftsQuery = keywords.map(k => `"${k.replace(/"/g, "")}"`).join(" OR ");
    try {
      const ftsResults = db.prepare(`
        SELECT rowid FROM notes_fts WHERE notes_fts MATCH ?
      `).all(ftsQuery) as { rowid: number }[];

      if (ftsResults.length > 0) {
        const rowids = ftsResults.map(r => r.rowid).slice(0, 10);
        const placeholders = rowids.map(() => "?").join(",");
        const notes = db.prepare(`
          SELECT id, title, contentText FROM notes
          WHERE rowid IN (${placeholders}) AND userId = ? AND isTrashed = 0
          ORDER BY updatedAt DESC
          LIMIT 5
        `).all(...rowids, userId) as { id: string; title: string; contentText: string }[];

        relatedNotes = notes.map(n => ({
          id: n.id,
          title: n.title,
          snippet: n.contentText.slice(0, 500),
        }));
      }
    } catch {
      // FTS query failed, continue without context
    }
  }

  // 如果 FTS 没结果，尝试 LIKE 模糊匹配
  if (relatedNotes.length === 0 && keywords.length > 0) {
    try {
      const likeClauses = keywords.slice(0, 3).map(() => "contentText LIKE ?").join(" OR ");
      const likeParams = keywords.slice(0, 3).map(k => `%${k}%`);
      const notes = db.prepare(`
        SELECT id, title, contentText FROM notes
        WHERE userId = ? AND isTrashed = 0 AND (${likeClauses})
        ORDER BY updatedAt DESC
        LIMIT 5
      `).all(userId, ...likeParams) as { id: string; title: string; contentText: string }[];

      relatedNotes = notes.map(n => ({
        id: n.id,
        title: n.title,
        snippet: n.contentText.slice(0, 500),
      }));
    } catch {
      // fallback failed
    }
  }

  // 2. 构建 RAG prompt
  let contextBlock = "";
  if (relatedNotes.length > 0) {
    contextBlock = relatedNotes.map((n, i) =>
      `【笔记 ${i + 1}】标题: ${n.title}\n${n.snippet}`
    ).join("\n\n---\n\n");
  }

  const systemPrompt = relatedNotes.length > 0
    ? `你是一个智能知识库助手。请基于用户的知识库笔记内容来回答问题。如果笔记中包含相关信息，请引用并标明来源笔记标题。如果笔记中没有相关信息，可以基于你的知识回答，但请说明这不是来自知识库的内容。\n\n以下是与问题相关的笔记内容：\n\n${contextBlock}`
    : "你是一个智能知识库助手。用户的知识库中暂未找到与问题相关的内容。请基于你的知识回答问题，并告知用户这些信息不是来自其知识库。";

  const messages: { role: string; content: string }[] = [
    { role: "system", content: systemPrompt },
  ];

  // 添加历史消息
  if (history && history.length > 0) {
    messages.push(...history.slice(-6)); // 最多保留最近 6 条历史
  }

  messages.push({ role: "user", content: question });

  // 规范化 URL：去除末尾斜杠，避免拼接出双斜杠
  const baseUrl = settings.ai_api_url.replace(/\/+$/, "");

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (settings.ai_api_key) {
    headers["Authorization"] = `Bearer ${settings.ai_api_key}`;
  }

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: settings.ai_model,
        messages,
        stream: true,
        temperature: 0.7,
        max_tokens: 2000,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return c.json({ error: `AI 服务错误: ${res.status} ${err.slice(0, 200)}` }, 502);
    }

    // SSE streaming with references
    return streamSSE(c, async (stream) => {
      // 先发送参考笔记信息
      if (relatedNotes.length > 0) {
        await stream.writeSSE({
          data: JSON.stringify(relatedNotes.map(n => ({ id: n.id, title: n.title }))),
          event: "references",
        });
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data: ")) continue;
            const data = trimmed.slice(6);
            if (data === "[DONE]") {
              await stream.writeSSE({ data: "[DONE]", event: "done" });
              return;
            }
            try {
              const json = JSON.parse(data);
              const content = json.choices?.[0]?.delta?.content;
              if (content) {
                await stream.writeSSE({ data: content, event: "message" });
              }
            } catch {
              // skip malformed JSON
            }
          }
        }
        await stream.writeSSE({ data: "[DONE]", event: "done" });
      } catch (err) {
        await stream.writeSSE({ data: "流式传输中断", event: "error" });
      }
    });
  } catch (err: any) {
    return c.json({ error: err.message || "AI 请求失败" }, 500);
  }
});

// ===== ③ 文档智能解析 =====
ai.post("/parse-document", async (c) => {
  const settings = getAISettings();
  if (!settings.ai_api_url) {
    return c.json({ error: "未配置 AI 服务" }, 400);
  }
  if (!NO_KEY_PROVIDERS.includes(settings.ai_provider) && !settings.ai_api_key) {
    return c.json({ error: "未配置 API Key" }, 400);
  }

  const userId = c.req.header("X-User-Id") || "demo";

  try {
    const formData = await c.req.formData();
    const file = formData.get("file") as File | null;
    const notebookId = formData.get("notebookId") as string | null;
    const formatMode = (formData.get("formatMode") as string) || "markdown"; // markdown | note

    if (!file) {
      return c.json({ error: "请上传文件" }, 400);
    }

    const fileName = file.name.toLowerCase();
    const buffer = Buffer.from(await file.arrayBuffer());
    let rawText = "";

    // 根据文件类型解析内容
    if (fileName.endsWith(".docx")) {
      const mammoth = await import("mammoth");
      const result = await mammoth.default.convertToHtml({ buffer });
      // 将 HTML 转为纯文本/简易 Markdown
      rawText = result.value
        .replace(/<h([1-6])>(.*?)<\/h[1-6]>/gi, (_: string, level: string, text: string) => '#'.repeat(Number(level)) + ' ' + text + '\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/?p>/gi, '\n')
        .replace(/<strong>(.*?)<\/strong>/gi, '**$1**')
        .replace(/<em>(.*?)<\/em>/gi, '*$1*')
        .replace(/<[^>]+>/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    } else if (fileName.endsWith(".doc")) {
      const WordExtractor = (await import("word-extractor")).default;
      const extractor = new WordExtractor();
      const doc = await extractor.extract(buffer as any);
      rawText = doc.getBody();
    } else if (fileName.endsWith(".csv") || fileName.endsWith(".tsv")) {
      const text = buffer.toString("utf-8");
      const separator = fileName.endsWith(".tsv") ? "\t" : ",";
      const lines = text.split("\n").filter(l => l.trim());
      if (lines.length > 0) {
        const headers = lines[0].split(separator).map(h => h.trim().replace(/^"|"$/g, ""));
        const divider = headers.map(() => "---");
        const rows = lines.slice(1).map(line =>
          line.split(separator).map(cell => cell.trim().replace(/^"|"$/g, ""))
        );
        rawText = `| ${headers.join(" | ")} |\n| ${divider.join(" | ")} |\n`;
        rawText += rows.map(row => `| ${row.join(" | ")} |`).join("\n");
      }
    } else if (fileName.endsWith(".txt") || fileName.endsWith(".md")) {
      rawText = buffer.toString("utf-8");
    } else if (fileName.endsWith(".html") || fileName.endsWith(".htm")) {
      // 简单提取 HTML 文本内容
      const html = buffer.toString("utf-8");
      rawText = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, "\n")
        .replace(/&nbsp;/g, " ")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    } else {
      return c.json({ error: `不支持的文件格式: ${fileName.split(".").pop()}` }, 400);
    }

    if (!rawText.trim()) {
      return c.json({ error: "文件内容为空或无法解析" }, 400);
    }

    // 使用 AI 将内容转换为规范的 Markdown 格式
    const aiPrompt = formatMode === "note"
      ? "请将以下文档内容整理为结构化的笔记格式（Markdown），合理使用标题层级、列表、表格、代码块等元素，保留原始信息不丢失，使内容清晰易读："
      : "请将以下文档内容转换为规范的 Markdown 格式，保持原始结构和内容不变，合理使用标题、列表、表格、代码块、引用等格式元素：";

    const messages = [
      { role: "system", content: "你是一个专业的文档格式化助手。请直接输出格式化后的 Markdown 内容，不要添加额外的解释、前缀或总结。" },
      { role: "user", content: `${aiPrompt}\n\n${rawText.slice(0, 8000)}` },
    ];

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (settings.ai_api_key) {
      headers["Authorization"] = `Bearer ${settings.ai_api_key}`;
    }

    const baseUrl = settings.ai_api_url.replace(/\/+$/, "");
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: settings.ai_model,
        messages,
        stream: false,
        temperature: 0.3,
        max_tokens: 4000,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return c.json({ error: `AI 服务错误: ${res.status} ${err.slice(0, 200)}` }, 502);
    }

    const data = await res.json();
    const markdownContent = data.choices?.[0]?.message?.content || rawText;

    // 如果指定了 notebookId，直接创建笔记
    if (notebookId) {
      const db = getDb();
      const { v4: uuidv4 } = await import("uuid");
      const noteId = uuidv4();
      const title = file.name.replace(/\.[^.]+$/, "");
      const contentText = markdownContent.replace(/[#*`>\-|_\[\]()]/g, "").replace(/\n{2,}/g, "\n").trim();

      db.prepare(`
        INSERT INTO notes (id, title, content, contentText, notebookId, userId, isFavorite, isPinned, isTrashed, isLocked, version, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 1, datetime('now'), datetime('now'))
      `).run(noteId, title, JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: markdownContent }] }] }), contentText, notebookId, userId);

      return c.json({
        success: true,
        noteId,
        title,
        markdown: markdownContent,
        saved: true,
      });
    }

    return c.json({
      success: true,
      markdown: markdownContent,
      fileName: file.name,
      originalLength: rawText.length,
      saved: false,
    });
  } catch (err: any) {
    return c.json({ error: err.message || "文档解析失败" }, 500);
  }
});

// ===== ⑤ 批量 Markdown 格式化 =====
ai.post("/batch-format", async (c) => {
  const settings = getAISettings();
  if (!settings.ai_api_url) {
    return c.json({ error: "未配置 AI 服务" }, 400);
  }
  if (!NO_KEY_PROVIDERS.includes(settings.ai_provider) && !settings.ai_api_key) {
    return c.json({ error: "未配置 API Key" }, 400);
  }

  const userId = c.req.header("X-User-Id") || "demo";
  const { noteIds } = await c.req.json() as { noteIds: string[] };

  if (!noteIds || noteIds.length === 0) {
    return c.json({ error: "请选择要格式化的笔记" }, 400);
  }

  if (noteIds.length > 20) {
    return c.json({ error: "单次最多格式化 20 篇笔记" }, 400);
  }

  const db = getDb();
  const results: { id: string; title: string; success: boolean; error?: string }[] = [];

  const aiHeaders: Record<string, string> = { "Content-Type": "application/json" };
  if (settings.ai_api_key) {
    aiHeaders["Authorization"] = `Bearer ${settings.ai_api_key}`;
  }

  for (const noteId of noteIds) {
    try {
      const note = db.prepare(
        "SELECT id, title, contentText, isLocked FROM notes WHERE id = ? AND userId = ? AND isTrashed = 0"
      ).get(noteId) as { id: string; title: string; contentText: string; isLocked: number } | undefined;

      if (!note) {
        results.push({ id: noteId, title: "未找到", success: false, error: "笔记不存在" });
        continue;
      }

      if (note.isLocked) {
        results.push({ id: noteId, title: note.title, success: false, error: "笔记已锁定" });
        continue;
      }

      if (!note.contentText || note.contentText.trim().length < 10) {
        results.push({ id: noteId, title: note.title, success: false, error: "内容过短" });
        continue;
      }

      const batchBaseUrl = settings.ai_api_url.replace(/\/+$/, "");
      const res = await fetch(`${batchBaseUrl}/chat/completions`, {
        method: "POST",
        headers: aiHeaders,
        body: JSON.stringify({
          model: settings.ai_model,
          messages: [
            { role: "system", content: "你是一个专业的文档格式化助手。请将内容转换为规范的 Markdown 格式，合理使用标题层级、列表、表格、代码块、引用等元素。保持原始图片链接（![...](...)）不变。保持代码块的语言标记正确。保持内嵌表格格式完整。直接输出结果，不要添加额外解释。" },
            { role: "user", content: `请将以下笔记内容格式化为规范的 Markdown：\n\n${note.contentText.slice(0, 6000)}` },
          ],
          stream: false,
          temperature: 0.2,
          max_tokens: 4000,
        }),
      });

      if (!res.ok) {
        results.push({ id: noteId, title: note.title, success: false, error: `AI 返回 ${res.status}` });
        continue;
      }

      const data = await res.json();
      const formatted = data.choices?.[0]?.message?.content;

      if (formatted) {
        const contentText = formatted.replace(/[#*`>\-|_\[\]()]/g, "").replace(/\n{2,}/g, "\n").trim();
        db.prepare(
          "UPDATE notes SET contentText = ?, updatedAt = datetime('now'), version = version + 1 WHERE id = ?"
        ).run(contentText, noteId);
        results.push({ id: noteId, title: note.title, success: true });
      } else {
        results.push({ id: noteId, title: note.title, success: false, error: "AI 返回为空" });
      }
    } catch (err: any) {
      results.push({ id: noteId, title: "未知", success: false, error: err.message });
    }
  }

  const successCount = results.filter(r => r.success).length;
  return c.json({
    total: noteIds.length,
    success: successCount,
    failed: noteIds.length - successCount,
    results,
  });
});

// ===== ⑥ 知识库文档导入 =====
ai.post("/import-to-knowledge", async (c) => {
  const settings = getAISettings();
  const userId = c.req.header("X-User-Id") || "demo";

  try {
    const formData = await c.req.formData();
    const files = formData.getAll("files") as File[];
    const notebookId = formData.get("notebookId") as string | null;

    if (!files || files.length === 0) {
      return c.json({ error: "请上传文件" }, 400);
    }

    if (files.length > 50) {
      return c.json({ error: "单次最多导入 50 个文件" }, 400);
    }

    const db = getDb();
    const { v4: uuidv4 } = (await import("uuid"));

    // 如果没有指定 notebookId，自动创建一个"知识库文档"笔记本
    let targetNotebookId = notebookId;
    if (!targetNotebookId) {
      const existing = db.prepare(
        "SELECT id FROM notebooks WHERE name = '知识库文档' AND userId = ?"
      ).get(userId) as { id: string } | undefined;

      if (existing) {
        targetNotebookId = existing.id;
      } else {
        targetNotebookId = uuidv4();
        db.prepare(
          "INSERT INTO notebooks (id, name, icon, userId, parentId, createdAt, updatedAt) VALUES (?, '知识库文档', '📚', ?, NULL, datetime('now'), datetime('now'))"
        ).run(targetNotebookId, userId);
      }
    }

    const results: { fileName: string; success: boolean; noteId?: string; error?: string }[] = [];
    const aiHeaders: Record<string, string> = { "Content-Type": "application/json" };
    if (settings.ai_api_key) {
      aiHeaders["Authorization"] = `Bearer ${settings.ai_api_key}`;
    }

    for (const file of files) {
      try {
        const fileName = file.name.toLowerCase();
        const buffer = Buffer.from(await file.arrayBuffer());
        let rawText = "";

        // 解析文件内容
        if (fileName.endsWith(".docx")) {
          const mammoth = await import("mammoth");
          const result = await mammoth.default.convertToHtml({ buffer });
          // 将 HTML 转为纯文本/简易 Markdown
          rawText = result.value
            .replace(/<h([1-6])>(.*?)<\/h[1-6]>/gi, (_: string, level: string, text: string) => '#'.repeat(Number(level)) + ' ' + text + '\n')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/?p>/gi, '\n')
            .replace(/<strong>(.*?)<\/strong>/gi, '**$1**')
            .replace(/<em>(.*?)<\/em>/gi, '*$1*')
            .replace(/<[^>]+>/g, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
        } else if (fileName.endsWith(".doc")) {
          const WordExtractor = (await import("word-extractor")).default;
          const extractor = new WordExtractor();
          const doc = await extractor.extract(buffer as any);
          rawText = doc.getBody();
        } else if (fileName.endsWith(".csv") || fileName.endsWith(".tsv")) {
          const text = buffer.toString("utf-8");
          const sep = fileName.endsWith(".tsv") ? "\t" : ",";
          const lines = text.split("\n").filter(l => l.trim());
          if (lines.length > 0) {
            const headers = lines[0].split(sep).map(h => h.trim().replace(/^"|"$/g, ""));
            rawText = `| ${headers.join(" | ")} |\n| ${headers.map(() => "---").join(" | ")} |\n`;
            rawText += lines.slice(1).map(line =>
              `| ${line.split(sep).map(c => c.trim().replace(/^"|"$/g, "")).join(" | ")} |`
            ).join("\n");
          }
        } else if (fileName.endsWith(".txt") || fileName.endsWith(".md")) {
          rawText = buffer.toString("utf-8");
        } else if (fileName.endsWith(".html") || fileName.endsWith(".htm")) {
          const html = buffer.toString("utf-8");
          rawText = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
            .replace(/<[^>]+>/g, "\n")
            .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
            .replace(/\n{3,}/g, "\n\n").trim();
        } else if (fileName.endsWith(".json")) {
          const json = buffer.toString("utf-8");
          rawText = "```json\n" + json + "\n```";
        } else {
          results.push({ fileName: file.name, success: false, error: "不支持的格式" });
          continue;
        }

        if (!rawText.trim()) {
          results.push({ fileName: file.name, success: false, error: "内容为空" });
          continue;
        }

        // 如果配置了 AI，使用 AI 优化格式；否则直接存储原始内容
        let finalContent = rawText;
        if (settings.ai_api_url && (NO_KEY_PROVIDERS.includes(settings.ai_provider) || settings.ai_api_key)) {
          try {
            const importBaseUrl = settings.ai_api_url.replace(/\/+$/, "");
            const res = await fetch(`${importBaseUrl}/chat/completions`, {
              method: "POST",
              headers: aiHeaders,
              body: JSON.stringify({
                model: settings.ai_model,
                messages: [
                  { role: "system", content: "你是一个文档格式化助手。请将文档内容整理为结构清晰的 Markdown 笔记格式，保留原始信息。直接输出结果。" },
                  { role: "user", content: `请格式化以下文档内容：\n\n${rawText.slice(0, 6000)}` },
                ],
                stream: false,
                temperature: 0.2,
                max_tokens: 4000,
              }),
              signal: AbortSignal.timeout(30000),
            });
            if (res.ok) {
              const data = await res.json();
              const aiContent = data.choices?.[0]?.message?.content;
              if (aiContent) finalContent = aiContent;
            }
          } catch {
            // AI 失败则使用原始内容
          }
        }

        const noteId = uuidv4();
        const title = file.name.replace(/\.[^.]+$/, "");
        const contentText = finalContent.replace(/[#*`>\-|_\[\]()]/g, "").replace(/\n{2,}/g, "\n").trim();

        db.prepare(`
          INSERT INTO notes (id, title, content, contentText, notebookId, userId, isFavorite, isPinned, isTrashed, isLocked, version, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 1, datetime('now'), datetime('now'))
        `).run(noteId, title, JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: finalContent }] }] }), contentText, targetNotebookId, userId);

        results.push({ fileName: file.name, success: true, noteId });
      } catch (err: any) {
        results.push({ fileName: file.name, success: false, error: err.message });
      }
    }

    const successCount = results.filter(r => r.success).length;
    return c.json({
      total: files.length,
      success: successCount,
      failed: files.length - successCount,
      notebookId: targetNotebookId,
      results,
    });
  } catch (err: any) {
    return c.json({ error: err.message || "导入失败" }, 500);
  }
});

// ===== 知识库统计 =====
ai.get("/knowledge-stats", (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id") || "demo";

  const noteCount = (db.prepare(
    "SELECT COUNT(*) as count FROM notes WHERE userId = ? AND isTrashed = 0"
  ).get(userId) as { count: number }).count;

  const ftsCount = (db.prepare(
    "SELECT COUNT(*) as count FROM notes_fts"
  ).get() as { count: number }).count;

  const notebookCount = (db.prepare(
    "SELECT COUNT(*) as count FROM notebooks WHERE userId = ?"
  ).get(userId) as { count: number }).count;

  const tagCount = (db.prepare(
    "SELECT COUNT(*) as count FROM tags WHERE userId = ?"
  ).get(userId) as { count: number }).count;

  const recentNotes = db.prepare(
    "SELECT title FROM notes WHERE userId = ? AND isTrashed = 0 ORDER BY updatedAt DESC LIMIT 5"
  ).all(userId) as { title: string }[];

  return c.json({
    noteCount,
    ftsCount,
    notebookCount,
    tagCount,
    recentTopics: recentNotes.map(n => n.title).filter(Boolean),
    indexed: ftsCount > 0,
  });
});

export default ai;
