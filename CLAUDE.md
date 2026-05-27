# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

nowen-note is a self-hosted private knowledge base application (inspired by Synology Note Station). It targets Web, Electron (Windows/macOS/Linux), and Android (via Capacitor). Current version: 1.0.28, licensed GPL-3.0.

## Common Commands

### Development
```bash
npm run dev:backend     # Backend dev server on :3001
npm run dev:frontend    # Frontend Vite dev server on :5173
npm run install:all     # Install all deps + rebuild native modules
```

### Build
```bash
npm run build:all       # Build both backend and frontend
npm run build:backend   # Backend only (tsc)
npm run build:frontend  # Frontend only (tsc -b && vite build)
```

### Frontend (cd frontend)
```bash
npm run lint            # ESLint
npm run test            # Vitest watch mode
npm run test:run        # Vitest single run
```

### Backend (cd backend)
```bash
npm run dev             # tsx watch (hot reload)
npm run build           # tsc
npm run start           # node dist/index.js
```

### Electron
```bash
npm run electron:dev    # Build all + launch Electron
npm run electron:build  # Rebuild native modules + build + package
```

## Architecture

### Monorepo Layout
- `backend/` — Hono REST API server (TypeScript, better-sqlite3)
- `frontend/` — React SPA (Vite, Tiptap/CodeMirror editors)
- `electron/` — Electron desktop shell (main.js entry)
- `packages/` — SDK (`@nowen/sdk`), MCP server (`nowen-mcp`), CLI (`nowen-cli`), browser clipper (`@nowen/clipper`)

### Backend (`backend/src/`)
- **Entry**: `index.ts` — Hono app setup, middleware, route mounting, DB init
- **Database**: `db/schema.ts` (SQLite connection, WAL mode, FTS5), `db/migrations.ts` (schema), `db/seed.ts` (defaults)
- **Routes**: 29 route modules in `routes/` (ai, auth, notes, notebooks, shares, etc.)
- **Services**: Business logic in `services/` (backup, realtime/yjs, email, webhooks, audit, embedding, vec-store)
- **Auth**: JWT with bcryptjs, API tokens, TOTP support in `lib/`

### Frontend (`frontend/src/`)
- **Entry**: `main.tsx` → `App.tsx` (layout, routing, resize handles)
- **State**: React Context + useReducer in `store/AppContext.tsx` (not Redux)
- **API client**: `lib/api.ts` — monolithic client with offline queue and optimistic locking
- **Editors**: `TiptapEditor.tsx` (rich text), `MarkdownEditor.tsx` (CodeMirror 6)
- **Real-time**: Yjs collaboration via WebSocket (`/ws`), client provider in `lib/`
- **Tests**: Vitest, test files in `__tests__/` directories alongside source

### Key Technical Details
- **Database**: SQLite via better-sqlite3, WAL journal mode, FTS5 full-text search, sqlite-vec for RAG embeddings. Schema managed in `db/migrations.ts`
- **AI**: Multi-provider support (Qwen, OpenAI, Gemini, DeepSeek, Doubao, Ollama) in `routes/ai.ts`. Features: writing assist, title generation, tag suggestion, RAG Q&A
- **Real-time**: Yjs server-side in `services/yjs.ts` and `services/realtime.ts`
- **Styling**: Tailwind CSS with semantic CSS variable color system, shadcn/ui component patterns, dark mode via class toggle
- **i18n**: i18next with `zh-CN.json` and `en.json` in `frontend/src/i18n/`
- **Frontend proxy**: Vite proxies `/api` and `/ws` to backend `:3001`

## Git Conventions

- Default branch: `develop`
- Commit messages: conventional commits (feat, fix, chore, etc.)
