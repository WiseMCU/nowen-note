import { Hono } from "hono";
import { getDb } from "../db/schema";
import { v4 as uuidv4 } from "uuid";

const pipelines = new Hono();

// ===== 内置处理步骤类型 =====
export type PipelineStepType =
  | "format_markdown"   // Markdown 格式化
  | "ai_polish"         // AI 润色
  | "ai_summarize"      // AI 摘要
  | "ai_translate_en"   // 翻译为英文
  | "ai_translate_zh"   // 翻译为中文
  | "ai_fix_grammar"    // 纠正语法
  | "ai_expand"         // 扩写
  | "ai_shorten"        // 精简
  | "extract_tags"      // 提取标签
  | "generate_title"    // 生成标题
  | "custom_prompt";    // 自定义 AI 指令

export interface PipelineStep {
  type: PipelineStepType;
  config?: Record<string, any>;
}

export interface Pipeline {
  id: string;
  userId: string;
  name: string;
  description: string;
  icon: string;
  steps: PipelineStep[];
  isBuiltin: number;
  createdAt: string;
  updatedAt: string;
}

// ===== 数据库迁移 =====
function ensurePipelinesTable() {
  const db = getDb();
  try {
    db.prepare("SELECT id FROM pipelines LIMIT 1").get();
  } catch {
    db.exec(`
      CREATE TABLE IF NOT EXISTS pipelines (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        icon TEXT DEFAULT '⚡',
        steps TEXT DEFAULT '[]',
        isBuiltin INTEGER DEFAULT 0,
        createdAt TEXT NOT NULL DEFAULT (datetime('now')),
        updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_pipelines_user ON pipelines(userId);

      CREATE TABLE IF NOT EXISTS pipeline_runs (
        id TEXT PRIMARY KEY,
        pipelineId TEXT NOT NULL,
        userId TEXT NOT NULL,
        status TEXT DEFAULT 'running',
        totalNotes INTEGER DEFAULT 0,
        processedNotes INTEGER DEFAULT 0,
        successNotes INTEGER DEFAULT 0,
        failedNotes INTEGER DEFAULT 0,
        results TEXT DEFAULT '[]',
        startedAt TEXT NOT NULL DEFAULT (datetime('now')),
        completedAt TEXT,
        FOREIGN KEY (pipelineId) REFERENCES pipelines(id) ON DELETE CASCADE,
        FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_pipeline_runs_user ON pipeline_runs(userId);
    `);
  }
}

// ===== 内置管道模板（首次使用时自动创建） =====
function ensureBuiltinPipelines(userId: string) {
  const db = getDb();
  const existing = db.prepare(
    "SELECT COUNT(*) as count FROM pipelines WHERE userId = ? AND isBuiltin = 1"
  ).get(userId) as { count: number };

  if (existing.count > 0) return;

  const builtins: Omit<Pipeline, "id" | "createdAt" | "updatedAt">[] = [
    {
      userId,
      name: "Markdown 规范化",
      description: "将笔记内容统一为规范的 Markdown 格式，合理使用标题、列表、表格等",
      icon: "📝",
      steps: [{ type: "format_markdown" }],
      isBuiltin: 1,
    },
    {
      userId,
      name: "AI 润色 + 格式化",
      description: "先用 AI 润色文本，再统一 Markdown 格式",
      icon: "✨",
      steps: [
        { type: "ai_polish" },
        { type: "format_markdown" },
      ],
      isBuiltin: 1,
    },
    {
      userId,
      name: "笔记摘要生成",
      description: "为每篇笔记自动生成简洁的摘要",
      icon: "📋",
      steps: [{ type: "ai_summarize" }],
      isBuiltin: 1,
    },
    {
      userId,
      name: "翻译为英文",
      description: "将笔记内容翻译为英文",
      icon: "🌐",
      steps: [{ type: "ai_translate_en" }],
      isBuiltin: 1,
    },
    {
      userId,
      name: "智能整理",
      description: "纠正语法 → 润色 → 格式化 → 生成标题 → 提取标签",
      icon: "🧠",
      steps: [
        { type: "ai_fix_grammar" },
        { type: "ai_polish" },
        { type: "format_markdown" },
        { type: "generate_title" },
        { type: "extract_tags" },
      ],
      isBuiltin: 1,
    },
  ];

  const insert = db.prepare(`
    INSERT INTO pipelines (id, userId, name, description, icon, steps, isBuiltin, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `);

  const tx = db.transaction(() => {
    for (const p of builtins) {
      insert.run(uuidv4(), p.userId, p.name, p.description, p.icon, JSON.stringify(p.steps), p.isBuiltin);
    }
  });
  tx();
}

// ===== GET /api/pipelines — 获取管道列表 =====
pipelines.get("/", (c) => {
  ensurePipelinesTable();
  const userId = c.req.header("X-User-Id") || "demo";
  ensureBuiltinPipelines(userId);

  const db = getDb();
  const rows = db.prepare(
    "SELECT * FROM pipelines WHERE userId = ? ORDER BY isBuiltin DESC, createdAt DESC"
  ).all(userId) as any[];

  const result = rows.map(r => ({
    ...r,
    steps: JSON.parse(r.steps || "[]"),
  }));

  return c.json(result);
});

// ===== POST /api/pipelines — 创建管道 =====
pipelines.post("/", async (c) => {
  ensurePipelinesTable();
  const userId = c.req.header("X-User-Id") || "demo";
  const { name, description, icon, steps } = await c.req.json();

  if (!name || !steps || !Array.isArray(steps) || steps.length === 0) {
    return c.json({ error: "管道名称和步骤不能为空" }, 400);
  }

  const db = getDb();
  const id = uuidv4();

  db.prepare(`
    INSERT INTO pipelines (id, userId, name, description, icon, steps, isBuiltin, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, 0, datetime('now'), datetime('now'))
  `).run(id, userId, name, description || "", icon || "⚡", JSON.stringify(steps));

  const pipeline = db.prepare("SELECT * FROM pipelines WHERE id = ?").get(id) as any;
  return c.json({ ...pipeline, steps: JSON.parse(pipeline.steps) }, 201);
});

// ===== PUT /api/pipelines/:id — 更新管道 =====
pipelines.put("/:id", async (c) => {
  ensurePipelinesTable();
  const userId = c.req.header("X-User-Id") || "demo";
  const id = c.req.param("id");
  const { name, description, icon, steps } = await c.req.json();

  const db = getDb();
  const existing = db.prepare(
    "SELECT id, isBuiltin FROM pipelines WHERE id = ? AND userId = ?"
  ).get(id, userId) as any;

  if (!existing) {
    return c.json({ error: "管道不存在" }, 404);
  }

  const updates: string[] = [];
  const values: any[] = [];

  if (name !== undefined) { updates.push("name = ?"); values.push(name); }
  if (description !== undefined) { updates.push("description = ?"); values.push(description); }
  if (icon !== undefined) { updates.push("icon = ?"); values.push(icon); }
  if (steps !== undefined) { updates.push("steps = ?"); values.push(JSON.stringify(steps)); }
  updates.push("updatedAt = datetime('now')");

  if (updates.length > 1) {
    db.prepare(`UPDATE pipelines SET ${updates.join(", ")} WHERE id = ?`).run(...values, id);
  }

  const pipeline = db.prepare("SELECT * FROM pipelines WHERE id = ?").get(id) as any;
  return c.json({ ...pipeline, steps: JSON.parse(pipeline.steps) });
});

// ===== DELETE /api/pipelines/:id — 删除管道 =====
pipelines.delete("/:id", (c) => {
  ensurePipelinesTable();
  const userId = c.req.header("X-User-Id") || "demo";
  const id = c.req.param("id");

  const db = getDb();
  const existing = db.prepare(
    "SELECT id FROM pipelines WHERE id = ? AND userId = ?"
  ).get(id, userId);

  if (!existing) {
    return c.json({ error: "管道不存在" }, 404);
  }

  db.prepare("DELETE FROM pipelines WHERE id = ?").run(id);
  return c.json({ success: true });
});

// ===== POST /api/pipelines/:id/run — 执行管道 =====
pipelines.post("/:id/run", async (c) => {
  ensurePipelinesTable();
  const userId = c.req.header("X-User-Id") || "demo";
  const pipelineId = c.req.param("id");
  const { noteIds } = await c.req.json();

  if (!noteIds || !Array.isArray(noteIds) || noteIds.length === 0) {
    return c.json({ error: "请选择要处理的笔记" }, 400);
  }

  if (noteIds.length > 50) {
    return c.json({ error: "单次最多处理 50 篇笔记" }, 400);
  }

  const db = getDb();

  // 获取管道配置
  const pipeline = db.prepare(
    "SELECT * FROM pipelines WHERE id = ? AND userId = ?"
  ).get(pipelineId, userId) as any;

  if (!pipeline) {
    return c.json({ error: "管道不存在" }, 404);
  }

  const steps: PipelineStep[] = JSON.parse(pipeline.steps || "[]");
  if (steps.length === 0) {
    return c.json({ error: "管道没有配置处理步骤" }, 400);
  }

  // 获取 AI 设置
  const aiSettings = getAISettings(db);

  // 创建运行记录
  const runId = uuidv4();
  db.prepare(`
    INSERT INTO pipeline_runs (id, pipelineId, userId, status, totalNotes, startedAt)
    VALUES (?, ?, ?, 'running', ?, datetime('now'))
  `).run(runId, pipelineId, userId, noteIds.length);

  // 逐笔记执行管道
  const results: { noteId: string; title: string; success: boolean; steps: { type: string; success: boolean; error?: string }[] }[] = [];
  let successCount = 0;
  let failedCount = 0;

  for (const noteId of noteIds) {
    const note = db.prepare(
      "SELECT id, title, content, contentText, isLocked FROM notes WHERE id = ? AND userId = ? AND isTrashed = 0"
    ).get(noteId, userId) as { id: string; title: string; content: string; contentText: string; isLocked: number } | undefined;

    if (!note) {
      results.push({ noteId, title: "未找到", success: false, steps: [{ type: "load", success: false, error: "笔记不存在" }] });
      failedCount++;
      continue;
    }

    if (note.isLocked) {
      results.push({ noteId, title: note.title, success: false, steps: [{ type: "load", success: false, error: "笔记已锁定" }] });
      failedCount++;
      continue;
    }

    let currentText = note.contentText;
    let currentTitle = note.title;
    const stepResults: { type: string; success: boolean; error?: string }[] = [];
    let noteSuccess = true;

    for (const step of steps) {
      try {
        const processed = await executeStep(step, currentText, currentTitle, aiSettings, db, userId, noteId);
        if (processed.text !== undefined) currentText = processed.text;
        if (processed.title !== undefined) currentTitle = processed.title;
        stepResults.push({ type: step.type, success: true });
      } catch (err: any) {
        stepResults.push({ type: step.type, success: false, error: err.message });
        noteSuccess = false;
        break; // 步骤失败则中止后续步骤
      }
    }

    // 保存处理结果
    if (noteSuccess && currentText !== note.contentText) {
      const contentText = currentText;
      const updateFields: string[] = ["contentText = ?", "updatedAt = datetime('now')", "version = version + 1"];
      const updateValues: any[] = [contentText];

      if (currentTitle !== note.title) {
        updateFields.push("title = ?");
        updateValues.push(currentTitle);
      }

      db.prepare(
        `UPDATE notes SET ${updateFields.join(", ")} WHERE id = ?`
      ).run(...updateValues, noteId);
    }

    if (noteSuccess) {
      successCount++;
    } else {
      failedCount++;
    }

    results.push({ noteId, title: currentTitle, success: noteSuccess, steps: stepResults });

    // 更新运行进度
    db.prepare(
      "UPDATE pipeline_runs SET processedNotes = processedNotes + 1, successNotes = ?, failedNotes = ? WHERE id = ?"
    ).run(successCount, failedCount, runId);
  }

  // 标记运行完成
  db.prepare(
    "UPDATE pipeline_runs SET status = 'completed', results = ?, completedAt = datetime('now'), successNotes = ?, failedNotes = ? WHERE id = ?"
  ).run(JSON.stringify(results), successCount, failedCount, runId);

  return c.json({
    runId,
    pipelineId,
    pipelineName: pipeline.name,
    total: noteIds.length,
    success: successCount,
    failed: failedCount,
    results,
  });
});

// ===== GET /api/pipelines/runs — 获取运行历史 =====
pipelines.get("/runs", (c) => {
  ensurePipelinesTable();
  const userId = c.req.header("X-User-Id") || "demo";

  const db = getDb();
  const rows = db.prepare(`
    SELECT r.*, p.name as pipelineName, p.icon as pipelineIcon
    FROM pipeline_runs r
    LEFT JOIN pipelines p ON r.pipelineId = p.id
    WHERE r.userId = ?
    ORDER BY r.startedAt DESC
    LIMIT 20
  `).all(userId) as any[];

  const result = rows.map(r => ({
    ...r,
    results: JSON.parse(r.results || "[]"),
  }));

  return c.json(result);
});

// ===== 步骤执行引擎 =====

interface AISettings {
  ai_api_url: string;
  ai_api_key: string;
  ai_model: string;
  ai_provider: string;
}

const NO_KEY_PROVIDERS = ["ollama"];

function getAISettings(db: any): AISettings {
  const rows = db.prepare("SELECT key, value FROM system_settings WHERE key LIKE 'ai_%'").all() as { key: string; value: string }[];
  const result: AISettings = { ai_api_url: "", ai_api_key: "", ai_model: "gpt-4o-mini", ai_provider: "openai" };
  for (const row of rows) {
    (result as any)[row.key] = row.value;
  }
  return result;
}

async function callAI(settings: AISettings, systemPrompt: string, userContent: string, maxTokens = 4000): Promise<string> {
  if (!settings.ai_api_url) throw new Error("未配置 AI 服务");
  if (!NO_KEY_PROVIDERS.includes(settings.ai_provider) && !settings.ai_api_key) {
    throw new Error("未配置 API Key");
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (settings.ai_api_key) {
    headers["Authorization"] = `Bearer ${settings.ai_api_key}`;
  }

  const res = await fetch(`${settings.ai_api_url}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: settings.ai_model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      stream: false,
      temperature: 0.3,
      max_tokens: maxTokens,
    }),
    signal: AbortSignal.timeout(60000),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`AI 服务错误 (${res.status}): ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI 返回为空");
  return content;
}

const STEP_PROMPTS: Record<string, { system: string; userPrefix: string; maxTokens?: number }> = {
  format_markdown: {
    system: "你是一个专业的文档格式化助手。请将内容转换为规范的 Markdown 格式，合理使用标题层级、列表、表格、代码块、引用等元素。保持原始内容不变。直接输出结果。",
    userPrefix: "请将以下笔记内容格式化为规范的 Markdown：\n\n",
  },
  ai_polish: {
    system: "你是一个专业的写作助手。请对内容进行润色，使其更加专业流畅，保持原意。直接输出润色后的文本。",
    userPrefix: "请润色以下内容：\n\n",
  },
  ai_summarize: {
    system: "你是一个专业的摘要助手。请为内容生成简洁的摘要（100-200字），保留核心要点。直接输出摘要。",
    userPrefix: "请为以下内容生成摘要：\n\n",
    maxTokens: 500,
  },
  ai_translate_en: {
    system: "你是一个专业的翻译助手。请将内容翻译为英文，保持原意和风格。直接输出翻译结果。",
    userPrefix: "请将以下内容翻译为英文：\n\n",
  },
  ai_translate_zh: {
    system: "你是一个专业的翻译助手。请将内容翻译为中文，保持原意和风格。直接输出翻译结果。",
    userPrefix: "请将以下内容翻译为中文：\n\n",
  },
  ai_fix_grammar: {
    system: "你是一个专业的语法校对助手。请修正内容中的语法和拼写错误，只返回修正后的文本。",
    userPrefix: "请修正以下内容中的语法和拼写错误：\n\n",
  },
  ai_expand: {
    system: "你是一个专业的写作助手。请对内容进行扩展，增加更多细节和解释，使其更充实。直接输出扩展后的文本。",
    userPrefix: "请扩展以下内容：\n\n",
  },
  ai_shorten: {
    system: "你是一个专业的写作助手。请将内容精简压缩，保留核心要点，去除冗余。直接输出精简后的文本。",
    userPrefix: "请精简以下内容：\n\n",
  },
  generate_title: {
    system: "请根据笔记内容生成一个简洁准确的标题（10字以内），只返回标题文本，不要加引号或其他标点。",
    userPrefix: "请为以下笔记内容生成标题：\n\n",
    maxTokens: 50,
  },
  extract_tags: {
    system: "请根据笔记内容推荐3-5个标签关键词。每个标签用逗号分隔，只返回标签文本，不要加#号。",
    userPrefix: "请为以下笔记内容推荐标签：\n\n",
    maxTokens: 100,
  },
};

async function executeStep(
  step: PipelineStep,
  text: string,
  title: string,
  aiSettings: AISettings,
  db: any,
  userId: string,
  noteId: string,
): Promise<{ text?: string; title?: string }> {
  if (!text || text.trim().length < 5) {
    throw new Error("内容过短，跳过处理");
  }

  const promptConfig = STEP_PROMPTS[step.type];

  if (step.type === "custom_prompt") {
    const customPrompt = step.config?.prompt;
    if (!customPrompt) throw new Error("自定义指令为空");
    const result = await callAI(aiSettings, customPrompt, text, step.config?.maxTokens || 4000);
    return { text: result };
  }

  if (step.type === "generate_title") {
    if (!promptConfig) throw new Error(`不支持的步骤类型: ${step.type}`);
    const newTitle = await callAI(
      aiSettings,
      promptConfig.system,
      promptConfig.userPrefix + text.slice(0, 2000),
      promptConfig.maxTokens || 50,
    );
    return { title: newTitle.trim() };
  }

  if (step.type === "extract_tags") {
    if (!promptConfig) throw new Error(`不支持的步骤类型: ${step.type}`);
    const tagsStr = await callAI(
      aiSettings,
      promptConfig.system,
      promptConfig.userPrefix + text.slice(0, 2000),
      promptConfig.maxTokens || 100,
    );

    // 解析标签并自动创建 + 关联
    const tagNames = tagsStr.split(/[,，]/).map(t => t.trim()).filter(Boolean).slice(0, 5);
    for (const tagName of tagNames) {
      // 查找或创建标签
      let tag = db.prepare(
        "SELECT id FROM tags WHERE userId = ? AND name = ?"
      ).get(userId, tagName) as { id: string } | undefined;

      if (!tag) {
        const tagId = uuidv4();
        db.prepare(
          "INSERT INTO tags (id, userId, name, color, createdAt) VALUES (?, ?, ?, '#58a6ff', datetime('now'))"
        ).run(tagId, userId, tagName);
        tag = { id: tagId };
      }

      // 关联到笔记（忽略重复）
      try {
        db.prepare(
          "INSERT OR IGNORE INTO note_tags (noteId, tagId) VALUES (?, ?)"
        ).run(noteId, tag.id);
      } catch { /* 已存在 */ }
    }

    return {}; // extract_tags 不修改文本
  }

  if (!promptConfig) throw new Error(`不支持的步骤类型: ${step.type}`);

  const result = await callAI(
    aiSettings,
    promptConfig.system,
    promptConfig.userPrefix + text.slice(0, 6000),
    promptConfig.maxTokens || 4000,
  );

  return { text: result };
}

// ===== 获取可用的步骤类型列表 =====
pipelines.get("/step-types", (c) => {
  const stepTypes = [
    { type: "format_markdown", name: "Markdown 格式化", icon: "📝", description: "将内容转换为规范的 Markdown 格式" },
    { type: "ai_polish", name: "AI 润色", icon: "✨", description: "使文本更加专业流畅" },
    { type: "ai_summarize", name: "生成摘要", icon: "📋", description: "生成简洁的内容摘要" },
    { type: "ai_translate_en", name: "翻译为英文", icon: "🇺🇸", description: "将内容翻译为英文" },
    { type: "ai_translate_zh", name: "翻译为中文", icon: "🇨🇳", description: "将内容翻译为中文" },
    { type: "ai_fix_grammar", name: "纠正语法", icon: "🔤", description: "修正语法和拼写错误" },
    { type: "ai_expand", name: "扩写", icon: "📖", description: "增加更多细节和解释" },
    { type: "ai_shorten", name: "精简", icon: "✂️", description: "精简压缩，保留核心要点" },
    { type: "generate_title", name: "生成标题", icon: "📌", description: "AI 自动生成笔记标题" },
    { type: "extract_tags", name: "提取标签", icon: "🏷️", description: "AI 自动提取关键词标签" },
    { type: "custom_prompt", name: "自定义指令", icon: "⚙️", description: "使用自定义 AI 指令处理" },
  ];
  return c.json(stepTypes);
});

export default pipelines;
