// electron/preload.js
// 通过 contextBridge 把主进程事件暴露给 renderer，保持 contextIsolation=true。
const { contextBridge, ipcRenderer } = require("electron");

const allowedChannels = new Set([
  // 主进程 → renderer 的菜单/快捷键广播
  "menu:new-note",
  "menu:search",
  "menu:open-settings",
  "menu:toggle-sidebar",
  "menu:focus-note-list",
  "menu:zoom-in",
  "menu:zoom-out",
  "menu:zoom-reset",
  // 格式菜单：{ mark?: "bold"|"italic"|"underline"|"strike"|"code", node?: "heading"|"paragraph", level?: number }
  "menu:format",
  // Dock Quick Action（macOS）
  "dock:new-note",
  "dock:search",
  // 文件关联：双击 .md 打开
  "file:open",
  // 自动更新状态
  "updater:status",
  // 局域网服务发现：主进程发现/丢失 mDNS 服务后向 renderer 推送最新列表
  "discovery:update",
]);

contextBridge.exposeInMainWorld("nowenDesktop", {
  /**
   * 订阅主进程事件。返回反注册函数。
   * @param {string} channel 频道名（必须在 allowedChannels 白名单中）
   * @param {(payload: any) => void} listener
   */
  on(channel, listener) {
    if (!allowedChannels.has(channel)) {
      console.warn("[preload] blocked channel:", channel);
      return () => {};
    }
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },

  /** 主动触发更新检查 */
  checkForUpdates() {
    return ipcRenderer.invoke("updater:check");
  },

  /** 下载完成后由用户触发安装 */
  quitAndInstall() {
    return ipcRenderer.invoke("updater:quit-and-install");
  },

  /** 获取 app 基本信息（版本号等） */
  getAppInfo() {
    return ipcRenderer.invoke("app:info");
  },

  /** 打开日志目录（方便用户取日志反馈问题） */
  openLogDir() {
    return ipcRenderer.invoke("app:open-log-dir");
  },

  /**
   * renderer → 主进程：上报当前编辑器"格式状态"，供主进程同步系统菜单栏的
   * checked 标记（HIG：菜单项应反映当前上下文状态）。
   *
   * @param {null | {
   *   bold?: boolean,
   *   italic?: boolean,
   *   underline?: boolean,
   *   strike?: boolean,
   *   code?: boolean,
   *   heading1?: boolean,
   *   heading2?: boolean,
   *   heading3?: boolean,
   *   paragraph?: boolean,
   * }} state
   *   null 表示"无可用编辑器"（编辑器销毁 / 焦点离开 / MD 模式未命中），
   *   主进程应清空所有格式菜单的 checked。
   *
   * 调用端职责：**自己做节流**（建议 100ms）与 **去重**（浅比较）。此 IPC 极轻量但频繁调用仍划不来。
   */
  sendFormatState(state) {
    ipcRenderer.send("menu:format-state", state ?? null);
  },

  /** 运行在 Electron 客户端的标识（前端用来条件渲染桌面专属 UI） */
  isDesktop: true,
  platform: process.platform,

  /**
   * 局域网服务发现（mDNS）：
   *   - start():  启动扫描 _nowen-note._tcp.local.；返回 { ok, available }
   *                available=false 表示主进程缺 bonjour-service 依赖（不会报错，前端
   *                仅显示"未发现"）
   *   - stop():   停止扫描并取消订阅
   *   - list():   主动获取当前已知服务列表（通常用不到，start 后会自动推送）
   *   - onUpdate(cb): 订阅列表变化；返回反注册函数
   *
   * 返回的 service 结构：
   *   { name, host, port, ipv4, addresses: string[], txt: Record<string,string>, lastSeen: number }
   */
  discovery: {
    start() {
      return ipcRenderer.invoke("discovery:start");
    },
    stop() {
      return ipcRenderer.invoke("discovery:stop");
    },
    list() {
      return ipcRenderer.invoke("discovery:list");
    },
    onUpdate(listener) {
      const wrapped = (_event, payload) => listener(payload);
      ipcRenderer.on("discovery:update", wrapped);
      return () => ipcRenderer.removeListener("discovery:update", wrapped);
    },
  },

  /**
   * 模式切换：前端"设置/关于"页可以放按钮调用这些接口，等价于走系统菜单。
   * 调用任意一个都会写入 settings.json + 清登录态 + relaunch（不会立刻 resolve）。
   *
   *   switchToLite:    弹出"选择服务器"窗，用户选完后切到 lite 并重启
   *   switchToFull:    确认后切回内置本地模式并重启
   *   changeServer:    仅更换 lite 模式下的远端 URL（依然停留在 lite）
   */
  mode: {
    switchToLite() {
      return ipcRenderer.invoke("mode:switch-to-lite");
    },
    switchToFull() {
      return ipcRenderer.invoke("mode:switch-to-full");
    },
    changeServer() {
      return ipcRenderer.invoke("mode:change-server");
    },
  },

  /**
   * 单笔记导出为 PDF：renderer 构造好完整 HTML（含内联样式与图片），主进程
   * 用离屏 BrowserWindow 渲染后 printToPDF，弹保存对话框写盘。
   *
   * @param {{ html: string, suggestedName?: string }} payload
   * @returns {Promise<{ ok: boolean, path?: string, canceled?: boolean, error?: string }>}
   */
  exportNoteToPDF(payload) {
    return ipcRenderer.invoke("export:note-to-pdf", payload);
  },
});
