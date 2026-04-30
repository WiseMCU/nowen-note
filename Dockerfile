# =============================================================================
# nowen-note 多架构 Dockerfile（精简版）
# -----------------------------------------------------------------------------
# 支持 linux/amd64 与 linux/arm64
#
# 优化：
#   - 后端运行时使用 node:20-alpine（~50MB vs ~200MB）
#   - 后端构建阶段编译 TypeScript 后 npm prune --production，
#     运行时直接复制 node_modules，不再重装依赖
#   - 构建工具（python3/make/g++）仅在构建阶段安装
# =============================================================================

ARG TARGETARCH=amd64

# ---------- Stage 1: 前端构建 ----------
FROM --platform=$BUILDPLATFORM node:20-slim AS frontend-build
ARG TARGETARCH
WORKDIR /app/frontend

COPY package.json /app/package.json
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

RUN ROLLUP_VER=$(node -e "try{const l=require('./package-lock.json');const v=(l.packages||{})['node_modules/rollup']||(l.dependencies||{}).rollup||{};console.log(v.version||'')}catch(e){console.log('')}") && \
    [ -z "$ROLLUP_VER" ] && ROLLUP_VER="4.59.0" ; \
    case "$TARGETARCH" in \
      amd64) ROLLUP_PKG="@rollup/rollup-linux-x64-gnu@${ROLLUP_VER}" ;; \
      arm64) ROLLUP_PKG="@rollup/rollup-linux-arm64-gnu@${ROLLUP_VER}" ;; \
      *)     ROLLUP_PKG="" ;; \
    esac; \
    if [ -n "$ROLLUP_PKG" ]; then \
      echo "Installing $ROLLUP_PKG ..." && \
      npm install "$ROLLUP_PKG" --save-optional 2>/dev/null || true; \
    fi

COPY frontend/ .
RUN npx vite build

# ---------- Stage 2: 后端构建 ----------
FROM node:20-alpine AS backend-build
RUN apk add --no-cache python3 make g++
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend/ .
RUN npx tsc && npm prune --production

# ---------- Stage 3: 运行时镜像 ----------
FROM node:20-alpine
WORKDIR /app

# 只需复制编译产物和生产依赖（已 prune）
COPY --from=backend-build /app/backend/node_modules ./backend/node_modules
COPY --from=backend-build /app/backend/dist ./backend/dist
COPY --from=backend-build /app/backend/package.json ./backend/package.json
COPY backend/templates ./backend/templates
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

RUN mkdir -p /app/data

VOLUME ["/app/data"]

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENV NODE_ENV=production
ENV DB_PATH=/app/data/nowen-note.db
ENV PORT=3001

EXPOSE 3001

WORKDIR /app
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "backend/dist/index.js"]
