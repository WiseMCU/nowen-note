import path from "path"
import fs from "node:fs"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// 读取根 package.json 的 version，注入到前端以便 UI 展示真实版本号
// （release.sh 会在发布时更新根 package.json 的 version 字段）
const rootPkg = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf-8"),
) as { version?: string }
const APP_VERSION = rootPkg.version || "0.0.0"

const ANDROID_HTML_PRELOAD_BLOCKLIST =
  /(?:vendor-(?:tiptap|codemirror|diagram|files|markdown|react-icons|yjs)|EditorPane|TiptapEditor|MindMapEditor|SharedNoteView|FileManager|pdf\.worker|mermaid|cytoscape|jspdf|html2canvas|katex)/

function getPackageName(id: string): string | null {
  const normalized = id.replace(/\\/g, "/")
  const marker = "/node_modules/"
  const markerIndex = normalized.lastIndexOf(marker)
  if (markerIndex === -1) return null

  const parts = normalized.slice(markerIndex + marker.length).split("/")
  if (parts[0]?.startsWith("@")) {
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null
  }
  return parts[0] || null
}

function isPackage(pkg: string, names: string[]) {
  return names.some((name) => pkg === name || pkg.startsWith(`${name}/`))
}

export default defineConfig({
  root: path.resolve(__dirname),
  plugins: [react()],
  define: {
    // 编译期常量；使用 JSON.stringify 确保是带引号的字符串字面量
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  optimizeDeps: {
    esbuildOptions: {
      keepNames: true,
    },
  },
  build: {
    sourcemap: false,
    // 禁用 modulePreload polyfill 注入，避免某些 rollup 版本将
    // "vite/modulepreload-polyfill" 误识别为 source phase import 而报错。
    // 现代浏览器（Chrome 64+、Firefox 115+、Safari 17.5+）已原生支持 modulepreload，
    // Capacitor WebView 和 Electron 同样无需 polyfill。
    modulePreload: {
      polyfill: false,
      resolveDependencies(_url, deps, context) {
        if (context.hostType !== "html") return deps
        return deps.filter((dep) => !ANDROID_HTML_PRELOAD_BLOCKLIST.test(dep))
      },
    },
    // 降低 chunk 大小警告阈值
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        // 手动分包，降低构建内存峰值
        manualChunks(id) {
          const pkg = getPackageName(id)
          if (!pkg) return undefined

          if (isPackage(pkg, ["react", "react-dom", "scheduler", "use-sync-external-store"])) {
            return "vendor-react"
          }
          if (isPackage(pkg, ["i18next", "react-i18next", "i18next-browser-languagedetector"])) {
            return "vendor-i18n"
          }
          if (pkg === "framer-motion") return "vendor-motion"
          if (pkg === "lucide-react") return "vendor-lucide"
          if (pkg === "react-icons") return "vendor-react-icons"
          if (pkg.startsWith("@radix-ui/") || isPackage(pkg, ["class-variance-authority", "clsx", "tailwind-merge", "next-themes"])) {
            return "vendor-ui"
          }
          if (pkg.startsWith("@capacitor/")) return "vendor-capacitor"
          if (pkg.startsWith("@tiptap/") || pkg.startsWith("prosemirror-") || isPackage(pkg, ["lowlight", "highlight.js", "katex"])) {
            return "vendor-tiptap"
          }
          if (pkg.startsWith("@codemirror/") || pkg.startsWith("@lezer/") || pkg === "y-codemirror.next") {
            return "vendor-codemirror"
          }
          if (isPackage(pkg, ["mermaid", "cytoscape", "cytoscape-cose-bilkent", "elkjs", "dagre", "roughjs"]) || pkg.startsWith("@mermaid-js/")) {
            return "vendor-diagram"
          }
          if (isPackage(pkg, ["jspdf", "html2canvas", "pdfjs-dist", "mammoth", "jszip", "file-saver"])) {
            return "vendor-files"
          }
          if (
            isPackage(pkg, ["react-markdown", "remark-gfm", "remark-parse", "remark-rehype", "rehype-raw", "rehype-stringify", "unified", "vfile", "turndown", "marked", "dompurify"]) ||
            pkg.startsWith("micromark") ||
            pkg.startsWith("mdast-util-") ||
            pkg.startsWith("hast-util-")
          ) {
            return "vendor-markdown"
          }
          if (pkg === "date-fns") return "vendor-date"
          if (pkg === "idb") return "vendor-idb"
          if (isPackage(pkg, ["yjs", "y-protocols", "y-indexeddb", "lib0"])) return "vendor-yjs"
          return undefined
        },
      },
    },
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    // 接受来自手机 App（Capacitor WebView）跨 origin 的 HMR WebSocket 握手。
    // 手机侧的 `capacitor.config.ts#server.url` 会把 WebView 直接指向
    // `http://<电脑LAN_IP>:5173`，此时 host 就是 LAN IP。
    // 不设 hmr.host 时 vite 会把 HMR clientScript 固定成某个值（通常是 localhost），
    // 导致手机端无法命中 HMR 通道——因此显式放开。
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      // 后端的实时协作 WebSocket（Y.js presence / 协同编辑）也必须代理，
      // 否则手机端 `new WebSocket("/ws")` 会落到 vite 自己的 HMR server 上。
      "/ws": {
        target: "ws://localhost:3001",
        ws: true,
        changeOrigin: true,
      },
    },
  },
})
