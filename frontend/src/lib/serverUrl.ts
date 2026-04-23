/**
 * 服务器地址拆分 / 合并工具
 *
 * 用户在登录/连接页会把服务器地址拆成三个字段：
 *   protocol: "http" | "https"   —— 下拉选择，默认 http
 *   host:     "192.168.1.10"     —— 纯主机/IP，不含 scheme、不含 :port、不含 path
 *   port:     "3001"             —— 可空；空则不拼到 URL，走 protocol 默认端口 (80/443)
 *
 * 历史版本只有一个"服务器地址"文本框，localStorage 里可能存成整串 URL，
 * 所以本模块同时提供 parseServerUrl，能把旧数据拆回三段回填。
 */

export type ServerScheme = "http" | "https";

export interface ServerAddressParts {
  protocol: ServerScheme;
  host: string;
  /** 字符串形式，空串表示不指定 */
  port: string;
}

/**
 * 把用户填写的 (protocol, host, port) 拼成后端期望的 baseUrl。
 * 约定：
 *   - host 去首尾空白、strip 可能粘贴进来的 scheme 前缀、去末尾 /
 *   - port 非数字会被忽略
 *   - 返回值不带尾部斜杠
 * 若 host 为空，返回空串（调用方应负责提示"请输入地址"）。
 */
export function buildServerUrl(parts: ServerAddressParts): string {
  const host = normalizeHost(parts.host);
  if (!host) return "";
  const port = normalizePort(parts.port);
  const base = `${parts.protocol}://${host}`;
  return port ? `${base}:${port}` : base;
}

/**
 * 解析一个已经完整的 URL（或用户粘贴的半成品），返回 3 段。
 * 容错：
 *   - 没有协议 → 默认 http
 *   - 带 path / query 会被忽略
 *   - 解析失败兜底返回 { http, "", "" }，不抛异常
 */
export function parseServerUrl(input: string | null | undefined): ServerAddressParts {
  const fallback: ServerAddressParts = { protocol: "http", host: "", port: "" };
  if (!input) return fallback;

  const raw = input.trim();
  if (!raw) return fallback;

  // URL 构造器要求有 scheme，否则会抛；这里先补 http:// 再解析
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  try {
    const u = new URL(withScheme);
    const protocol: ServerScheme = u.protocol === "https:" ? "https" : "http";
    return {
      protocol,
      host: u.hostname,
      // u.port 对默认端口（80/443）返回 ""，正好符合我们的约定
      port: u.port || "",
    };
  } catch {
    return fallback;
  }
}

function normalizeHost(raw: string): string {
  return raw
    .trim()
    // 粘贴时可能带着 http(s):// 前缀，清掉
    .replace(/^https?:\/\//i, "")
    // 去掉末尾的 path / 斜杠
    .replace(/\/.*$/, "")
    // 去掉可能混进来的 :port（Host 输入框只放主机）
    // 注意：IPv6 暂不支持（需要方括号包裹），作为简化：如果包含冒号则
    // 视为 host:port，只取前半段。使用者不应把 IPv6 写在这里。
    .replace(/:\d+$/, "");
}

function normalizePort(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  // 仅接受纯数字；非法输入一律当作不指定
  return /^\d+$/.test(trimmed) ? trimmed : "";
}
