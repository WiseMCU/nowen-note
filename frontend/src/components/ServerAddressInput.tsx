import React from "react";
import { Globe, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  parseServerUrl,
  type ServerAddressParts,
  type ServerScheme,
} from "@/lib/serverUrl";

/**
 * 判定一段文本是否"看起来是一整段 URL"——只要命中其一就尝试自动拆分：
 *   1) 显式带 scheme：     http://...   https://...
 *   2) host 后跟 :port：   39.106.81.133:666 / example.com:8080
 *   3) host 后跟 /path：   example.com/api
 * 单纯写 IP 或域名（没有冒号、没有斜杠）不命中，避免用户正常逐字符输入
 * 主机名时被误识别成 URL 反复拆分。
 *
 * 注意：IPv6 字面地址（含多个冒号）暂不在此判定，因为 Host 输入框约定不收
 * IPv6（serverUrl.ts 也明说）。如果以后要支持，需要在这里区分 ":\d+$" 与
 * IPv6 形式（含括号或多冒号）。
 */
function looksLikeFullUrl(raw: string): boolean {
  const s = raw.trim();
  if (!s) return false;
  if (/^https?:\/\//i.test(s)) return true;
  // 域名/IP 后紧跟 :端口
  if (/^[^\s:/]+:\d+(\/|$)/.test(s)) return true;
  // 域名/IP 后紧跟 /
  if (/^[^\s:/]+\//.test(s)) return true;
  return false;
}

/**
 * 登录 / 服务器连接页共用的地址输入组件。
 *
 * UI 布局（横向）：
 *   [ http ▾ ] [ :// ] [        host 输入框        ] [  : port  ]
 *     协议下拉            主机/IP（必填）                端口（可空）
 *
 * 为什么把三个字段拆开：
 *   - 合并成单行字符串时，用户经常漏掉 scheme、把 port 写错字符（: vs ：），
 *     移动端 autocomplete 也容易把它当成邮箱/URL 来整行自动补全，误操作多
 *   - 拆开后每一个输入框的 keyboard/autocomplete 都可以单独约束，端口用
 *     numeric keypad，host 用无自动纠错，体验稳定得多
 *
 * 右侧 rightSlot 用于放连接状态图标（checking / ok / fail），保持和旧版
 * LoginPage 的视觉一致。
 */

export interface ServerAddressInputProps {
  value: ServerAddressParts;
  onChange: (next: ServerAddressParts) => void;
  /** host blur 时触发——LoginPage 用它做"失焦自动测连接" */
  onHostBlur?: () => void;
  autoFocus?: boolean;
  disabled?: boolean;
  /** 右侧额外图标（连接状态） */
  rightSlot?: React.ReactNode;
  /** 主色调：emerald | indigo（两个调用页的配色不同） */
  accent?: "emerald" | "indigo";
}

const ACCENT_CLASS: Record<NonNullable<ServerAddressInputProps["accent"]>, string> = {
  // 统一成 focus-within 版本，让整行在任意子输入框 focus 时都高亮
  emerald:
    "focus-within:ring-2 focus-within:ring-emerald-500/40 focus-within:border-emerald-500 dark:focus-within:border-emerald-500",
  indigo:
    "focus-within:ring-2 focus-within:ring-indigo-500/40 focus-within:border-indigo-500 dark:focus-within:border-indigo-500",
};

export default function ServerAddressInput({
  value,
  onChange,
  onHostBlur,
  autoFocus,
  disabled,
  rightSlot,
  accent = "indigo",
}: ServerAddressInputProps) {
  const { t } = useTranslation();

  const update = (patch: Partial<ServerAddressParts>) => onChange({ ...value, ...patch });

  /**
   * 用户在 host 输入框里粘贴 / 输入了一整段 URL 时，自动拆成 protocol + host + port
   * 三段并整体替换。这是为了解决"用户从浏览器复制 http://x.x.x.x:666/ 这种带尾斜杠
   * 的整段 URL 时，按字段输入要拆三次"的痛点。
   *
   * 触发时机：
   *   - onPaste：监听粘贴事件最稳定，preventDefault 后我们自己把数据写回去。
   *   - onChange（host 字段）：用户也可能直接键盘输入一段（例如手机上长按复制的
   *     URL 通过键盘候选词整段贴入），所以 onChange 里 也要做一次"看着像 URL 就
   *     拆"的兜底。注意只在"明显像 URL"时拆，避免用户正常逐字符输入主机名时
   *     被反复拆分（参见 looksLikeFullUrl 的注释）。
   *
   * 拆分使用 serverUrl.ts 的 parseServerUrl，它已经处理了：
   *   - 缺 scheme 时默认 http
   *   - 末尾斜杠 / path / query
   *   - 解析失败兜底返回空地址（这种情况我们就不替换，按用户原始输入处理）
   */
  const tryAutoSplit = (raw: string): boolean => {
    if (!looksLikeFullUrl(raw)) return false;
    const parsed = parseServerUrl(raw);
    if (!parsed.host) return false;
    onChange(parsed);
    return true;
  };

  const handleHostChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    if (tryAutoSplit(raw)) return;
    update({ host: raw });
  };

  const handleHostPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    if (!text) return;
    if (tryAutoSplit(text)) {
      // 自己已经把三段都填好了；阻止浏览器把整段塞进 host 字段
      e.preventDefault();
    }
  };

  const handlePortPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    // 粘贴到 port 框时，如果对方也是一整段 URL，同样应该拆分（用户行为预期）
    const text = e.clipboardData.getData("text");
    if (!text) return;
    if (tryAutoSplit(text)) {
      e.preventDefault();
    }
  };

  return (
    <div
      className={
        "relative flex items-stretch w-full border border-zinc-200 dark:border-zinc-700 rounded-xl " +
        "bg-zinc-50/50 dark:bg-zinc-800/50 transition-all overflow-hidden " +
        ACCENT_CLASS[accent]
      }
    >
      {/* Protocol select */}
      <div className="relative flex items-center pl-3 pr-1 border-r border-zinc-200 dark:border-zinc-700">
        <Globe className="h-4 w-4 text-zinc-400 dark:text-zinc-500 mr-1.5" />
        <select
          value={value.protocol}
          disabled={disabled}
          onChange={(e) => update({ protocol: e.target.value as ServerScheme })}
          aria-label={t("server.protocolLabel")}
          className={
            "appearance-none bg-transparent text-sm text-zinc-900 dark:text-zinc-100 " +
            "focus:outline-none pr-5 py-2.5 cursor-pointer disabled:cursor-not-allowed"
          }
        >
          <option value="http">http</option>
          <option value="https">https</option>
        </select>
        <ChevronDown className="h-3.5 w-3.5 text-zinc-400 dark:text-zinc-500 absolute right-1 top-1/2 -translate-y-1/2 pointer-events-none" />
      </div>

      {/* :// 分隔 */}
      <span className="select-none flex items-center px-1.5 text-xs text-zinc-400 dark:text-zinc-500">
        ://
      </span>

      {/* Host */}
      <input
        type="text"
        value={value.host}
        onChange={handleHostChange}
        onPaste={handleHostPaste}
        onBlur={onHostBlur}
        placeholder={t("server.hostPlaceholder")}
        autoFocus={autoFocus}
        disabled={disabled}
        // 关键：禁用移动端自动纠错/自动大写，主机名里最怕"被改成首字母大写"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        inputMode="url"
        className={
          "flex-1 min-w-0 bg-transparent py-2.5 pr-2 text-sm " +
          "text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 " +
          "focus:outline-none disabled:cursor-not-allowed"
        }
      />

      {/* : 分隔 + Port */}
      <span className="select-none flex items-center px-1 text-sm text-zinc-400 dark:text-zinc-500 border-l border-zinc-200 dark:border-zinc-700">
        :
      </span>
      <input
        type="text"
        value={value.port}
        onChange={(e) => {
          // 端口只收数字；非数字按键体验上直接过滤掉
          const v = e.target.value.replace(/\D/g, "").slice(0, 5);
          update({ port: v });
        }}
        onPaste={handlePortPaste}
        placeholder={t("server.portPlaceholder")}
        disabled={disabled}
        inputMode="numeric"
        pattern="\d*"
        maxLength={5}
        aria-label={t("server.portLabel")}
        className={
          "w-[72px] bg-transparent py-2.5 pr-2 text-sm text-center " +
          "text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 " +
          "focus:outline-none disabled:cursor-not-allowed"
        }
      />

      {/* 右侧状态槽 */}
      {rightSlot && (
        <div className="flex items-center pr-3 pl-1">{rightSlot}</div>
      )}
    </div>
  );
}
