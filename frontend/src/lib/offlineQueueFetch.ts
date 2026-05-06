/**
 * offlineQueueFetch — 离线队列专用的"裸 fetch"封装
 * =========================================================================
 *
 * flushQueue 需要一个不经过 offlineQueue 拦截的发送函数（否则循环依赖）。
 * 这里直接用原生 fetch + token/baseUrl，无 offline 拦截逻辑。
 */

import { getBaseUrl } from "@/lib/api";

function getToken(): string | null {
  return localStorage.getItem("nowen-token");
}

/**
 * 为 flushQueue 提供的发送函数。
 * @param url    相对路径，如 "/notes/xxx"
 * @param method HTTP method
 * @param body   请求体（DELETE 时为 null）
 */
export async function offlineQueueFetch(
  url: string,
  method: string,
  body: Record<string, unknown> | null,
): Promise<{ ok: boolean; status: number; data?: any }> {
  const token = getToken();
  const fullUrl = `${getBaseUrl()}${url}`;

  const res = await fetch(fullUrl, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  let data: any;
  try {
    data = await res.json();
  } catch {
    data = undefined;
  }

  return { ok: res.ok, status: res.status, data };
}
