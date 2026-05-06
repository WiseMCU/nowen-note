import { api } from "./api";

export interface MiNoteEntry {
  id: string;
  title: string;
  snippet: string;
  folderId: string;
  folderName: string;
  createDate: number;
  modifyDate: number;
  colorId: number;
  selected: boolean;
}

export interface MiCloudState {
  phase: "idle" | "verifying" | "loading" | "ready" | "importing" | "done" | "error";
  message: string;
  notes: MiNoteEntry[];
  folders: Record<string, string>;
  importedCount: number;
}

const MI_CLOUD_COOKIE_KEY = "mi-cloud-cookie";

// 保存 cookie 到 sessionStorage（不持久化到 localStorage，安全考虑）
//
// 在受限的 WebView 环境（部分 Capacitor / Android System WebView 隐私模式 /
// 宿主 app 关闭存储权限）下，sessionStorage 访问会同步抛 SecurityError。
// MiCloudImport 在函数体里 `useState(getMiCookie())` 即触发同步访问，一旦
// 抛错且没有 ErrorBoundary 兜底，就会把整个 SettingsModal 卸掉。
// 这里统一吞掉异常退化为"读不到 / 写不进"，既不影响其它 storage 可用环境，
// 也彻底切断"sessionStorage 不可用 → 模态框崩溃"这条链路。
export function saveMiCookie(cookie: string) {
  try {
    sessionStorage.setItem(MI_CLOUD_COOKIE_KEY, cookie);
  } catch {
    // sessionStorage 不可用：静默忽略，本次会话内 cookie 不持久化即可。
  }
}

export function getMiCookie(): string {
  try {
    return sessionStorage.getItem(MI_CLOUD_COOKIE_KEY) || "";
  } catch {
    return "";
  }
}

export function clearMiCookie() {
  try {
    sessionStorage.removeItem(MI_CLOUD_COOKIE_KEY);
  } catch {
    // 同上：访问受限时无所谓"清不掉"。
  }
}

// 验证 Cookie
export async function verifyMiCookie(cookie: string): Promise<{ valid: boolean; error?: string }> {
  const res = await api.miCloudVerify(cookie);
  return res;
}

// 获取笔记列表
export async function fetchMiNotes(cookie: string): Promise<{
  notes: MiNoteEntry[];
  folders: Record<string, string>;
}> {
  const res = await api.miCloudNotes(cookie);
  return {
    notes: res.notes.map((n: any) => ({ ...n, selected: true })),
    folders: res.folders,
  };
}

// 导入选中的笔记
export async function importMiNotes(
  cookie: string,
  noteIds: string[],
  notebookId?: string
): Promise<{ success: boolean; count: number; errors: string[] }> {
  return api.miCloudImport(cookie, noteIds, notebookId);
}
