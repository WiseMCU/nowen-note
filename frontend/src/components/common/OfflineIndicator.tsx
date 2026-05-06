/**
 * OfflineIndicator — 离线状态指示器
 * =========================================================================
 *
 * 展示当前网络状态和离线队列中待同步的操作数量。
 * 三种状态：
 *   - 在线 + 无待同步 → 不显示（完全隐藏）
 *   - 离线 → 显示"离线"标签（黄色）
 *   - 有待同步条目 → 显示"待同步 N 条"（蓝色，可点击手动 flush）
 *   - 刚恢复在线 → 短暂显示"已恢复连接"（绿色，5s 后消失）
 */

import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { Wifi, WifiOff, CloudUpload, Check } from "lucide-react";

export default function OfflineIndicator() {
  const { isOnline, wasOffline, pendingCount, flush } = useNetworkStatus();

  // 完全在线 + 无待同步 + 非刚恢复 → 隐藏
  if (isOnline && pendingCount === 0 && !wasOffline) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[9999] flex flex-col items-end gap-2 pointer-events-none">
      {/* 刚恢复在线提示 */}
      {wasOffline && isOnline && (
        <div className="pointer-events-auto flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-green-500/90 text-white text-xs shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-300">
          <Check className="w-3.5 h-3.5" />
          <span>已恢复连接</span>
        </div>
      )}

      {/* 离线状态 */}
      {!isOnline && (
        <div className="pointer-events-auto flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-500/90 text-white text-xs shadow-lg">
          <WifiOff className="w-3.5 h-3.5" />
          <span>离线模式</span>
        </div>
      )}

      {/* 待同步条目 */}
      {pendingCount > 0 && (
        <button
          onClick={() => { if (isOnline) flush(); }}
          disabled={!isOnline}
          className="pointer-events-auto flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-blue-500/90 hover:bg-blue-600/90 disabled:opacity-60 text-white text-xs shadow-lg transition-colors cursor-pointer disabled:cursor-default"
          title={isOnline ? "点击立即同步" : "等待网络恢复后自动同步"}
        >
          <CloudUpload className="w-3.5 h-3.5" />
          <span>待同步 {pendingCount} 条</span>
        </button>
      )}
    </div>
  );
}
