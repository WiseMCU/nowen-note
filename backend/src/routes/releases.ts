/**
 * GET /api/releases/latest —— 代理 GitHub Releases 最新发布
 * ---------------------------------------------------------------------------
 *
 * 为什么由后端代理而不是前端直连 GitHub：
 *   1. **CORS 与配额**：GitHub API 对未认证请求有 60 次/小时/IP 的上限；
 *      让所有前端共享一个后端缓存，整个实例每 N 分钟最多 1 次外呼，
 *      天然避免用户打开多个 tab、或国内多用户共享出口 IP 时把额度打光。
 *   2. **私网可用**：一些企业内网部署能访问本实例的 80/443，但出站到
 *      github.com 要走代理；通过后端代理能让"是否启用更新检查"成为
 *      运维配置，而不是前端硬编码。
 *   3. **故障降级**：外呼失败时返回 `{ available: false, reason }` 而非
 *      5xx，让前端关于页平稳显示"无法检查更新"，不影响核心功能。
 *
 * 缓存策略（针对国内大并发 + IP 共享 quota 场景重新设计）：
 *   - 成功结果缓存 15 分钟（CACHE_TTL_MS，可经环境变量覆盖）：
 *     一个实例每小时最多外呼 4 次，远低于 60/h 的未认证额度。
 *   - 失败结果缓存 5 分钟（FAIL_CACHE_TTL_MS）：避免 GitHub 403 时
 *     每个请求都触发外呼形成"403 风暴 → IP 永远恢复不了"的死循环。
 *   - ETag 条件请求：保存上次成功响应的 ETag，下次外呼带 If-None-Match；
 *     GitHub 返回 304 时不计入 rate limit（官方文档保证），等于免费续期。
 *   - stale-while-error：缓存过期后 GitHub 又失败时，**优先继续返回上次
 *     成功数据**而不是错误——对用户体验上"版本号偶尔停止更新" >> "面板
 *     直接挂掉"。
 *
 * 鉴权扩展：
 *   - 可选环境变量 GITHUB_TOKEN（也兼容 NOWEN_GITHUB_TOKEN）：填了后
 *     authenticated quota 升到 5000/h，并支持私有仓库（虽然本项目是公开的）。
 *
 * 无需鉴权：与 /api/version 同级，贴着 health 挂在 JWT 之前。
 */

import { Hono } from "hono";

const router = new Hono();

// 仓库地址硬编码；如果未来仓库重命名，这里改一次即可。
const GITHUB_OWNER = process.env.NOWEN_RELEASE_OWNER || "cropflre";
const GITHUB_REPO = process.env.NOWEN_RELEASE_REPO || "nowen-note";
const GITHUB_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;

// 可选 token：优先 GITHUB_TOKEN（与生态一致），其次 NOWEN_GITHUB_TOKEN
// （避免与同主机其他服务的 GITHUB_TOKEN 冲突时，运维有显式覆盖入口）。
const GITHUB_TOKEN = (process.env.NOWEN_GITHUB_TOKEN || process.env.GITHUB_TOKEN || "").trim();

// 缓存 TTL：成功 15min，失败 5min。允许通过环境变量按部署调优。
// 选 15min 的依据：1h / 15min = 4 次/小时外呼，留 56 次余量给"用户手动刷新"。
const CACHE_TTL_MS = parseTtl(process.env.NOWEN_RELEASE_CACHE_MS, 15 * 60_000);
const FAIL_CACHE_TTL_MS = parseTtl(process.env.NOWEN_RELEASE_FAIL_CACHE_MS, 5 * 60_000);
const FETCH_TIMEOUT_MS = 5_000;

function parseTtl(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1000) return fallback; // 不允许 < 1s，避免误配
  return n;
}

interface ReleaseAsset {
  name: string;            // 文件名，如 "Nowen Note Setup 1.1.7.exe"
  size: number;            // 字节
  contentType: string;     // application/octet-stream 等
  browserDownloadUrl: string; // GitHub 直链
}

interface LatestRelease {
  available: true;
  tag: string;           // e.g. "v1.0.31"
  version: string;       // 去掉前导 v："1.0.31"
  name: string;          // release 标题（可能为空）
  htmlUrl: string;       // release 页面 URL
  publishedAt: string;   // ISO
  prerelease: boolean;
  draft: boolean;
  body?: string;         // release notes（markdown）
  assets: ReleaseAsset[];
}

interface Unavailable {
  available: false;
  reason: string;
}

type Payload = LatestRelease | Unavailable;

/**
 * 缓存槽：
 *   - lastSuccess：最近一次成功的数据 + ETag。即使过期了，外呼又失败时
 *     还会作为 stale 兜底返回。永不主动清除（除非进程重启）。
 *   - current：当前 TTL 内有效的 payload（成功或失败）；过期则触发外呼。
 */
let lastSuccess: { payload: LatestRelease; etag: string | null } | null = null;
let current: { at: number; ttl: number; payload: Payload } | null = null;

/** 拉取并规范化 GitHub release。
 *  返回 'not-modified' 表示 ETag 命中（沿用 lastSuccess.payload）。
 *  其他失败抛错。
 */
async function fetchLatestFromGitHub(): Promise<LatestRelease | "not-modified"> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      // GitHub 建议带 User-Agent；用仓库名避免被 rate-limit 误杀
      "User-Agent": `${GITHUB_OWNER}-${GITHUB_REPO}-server`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (GITHUB_TOKEN) {
      headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
    }
    if (lastSuccess?.etag) {
      // 关键：带 If-None-Match 让 GitHub 返回 304；304 不计 rate limit。
      headers["If-None-Match"] = lastSuccess.etag;
    }
    const resp = await fetch(GITHUB_API, { signal: ctrl.signal, headers });
    if (resp.status === 304) {
      return "not-modified";
    }
    if (!resp.ok) {
      // 把 rate-limit 信息塞进错误，方便日志排查
      const remaining = resp.headers.get("x-ratelimit-remaining");
      const reset = resp.headers.get("x-ratelimit-reset");
      const extra = remaining !== null ? ` (rate-limit remaining=${remaining} reset=${reset})` : "";
      throw new Error(`GitHub API ${resp.status} ${resp.statusText}${extra}`);
    }
    const etag = resp.headers.get("etag");
    const data = (await resp.json()) as {
      tag_name?: string;
      name?: string;
      html_url?: string;
      published_at?: string;
      prerelease?: boolean;
      draft?: boolean;
      body?: string;
      assets?: Array<{
        name?: string;
        size?: number;
        content_type?: string;
        browser_download_url?: string;
      }>;
    };
    const tag = data.tag_name || "";
    const version = tag.replace(/^v/, "");
    const assets: ReleaseAsset[] = (data.assets || [])
      .filter((a) => !!a.browser_download_url && !!a.name)
      .map((a) => ({
        name: a.name || "",
        size: typeof a.size === "number" ? a.size : 0,
        contentType: a.content_type || "application/octet-stream",
        browserDownloadUrl: a.browser_download_url || "",
      }));
    const payload: LatestRelease = {
      available: true,
      tag,
      version,
      name: data.name || tag,
      htmlUrl: data.html_url || "",
      publishedAt: data.published_at || "",
      prerelease: Boolean(data.prerelease),
      draft: Boolean(data.draft),
      body: data.body || "",
      assets,
    };
    lastSuccess = { payload, etag };
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

router.get("/latest", async (c) => {
  const now = Date.now();

  // 1. 命中当前缓存（成功或失败都尊重各自 TTL）
  if (current && now - current.at < current.ttl) {
    return c.json(current.payload);
  }

  // 2. 缓存过期 → 尝试外呼
  try {
    const result = await fetchLatestFromGitHub();
    const payload: LatestRelease = result === "not-modified" ? lastSuccess!.payload : result;
    current = { at: now, ttl: CACHE_TTL_MS, payload };
    return c.json(payload);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);

    // 3. stale-while-error：外呼失败但有历史成功数据 → 继续返回旧数据，
    //    并把这条"旧数据"短期缓存（FAIL_CACHE_TTL_MS）防止持续打 GitHub。
    //    用户体验：版本号短暂停止更新 ≫ 面板挂掉。
    if (lastSuccess) {
      current = { at: now, ttl: FAIL_CACHE_TTL_MS, payload: lastSuccess.payload };
      return c.json(lastSuccess.payload);
    }

    // 4. 完全没有成功历史（首次启动就被 403） → 返回 unavailable
    const payload: Unavailable = { available: false, reason };
    current = { at: now, ttl: FAIL_CACHE_TTL_MS, payload };
    return c.json(payload);
  }
});

export default router;
