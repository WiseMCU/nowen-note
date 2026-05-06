# =============================================================================
# nowen-note 多架构 Dockerfile（极致精简版）
# -----------------------------------------------------------------------------
# 支持 linux/amd64 与 linux/arm64
#
# 优化点：
#   - 运行时 node:20-alpine 基础镜像（~47MB 压缩后）
#   - 构建阶段编译后 npm prune --production，运行时不再重装
#   - 构建工具（python3/make/g++）仅构建阶段安装，不进运行时
#   - 清理 node_modules 中的测试、文档、源码等无关文件
#   - 合并 RUN 层减少镜像层数
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
# 编译 TypeScript → 清理 dev 依赖 → 清理 node_modules 中的冗余文件
RUN npx tsc && npm prune --production && \
    find ./node_modules -type d \( -name test -o -name tests -o -name __tests__ \
      -o -name doc -o -name docs -o -name example -o -name examples \
      -o -name .github -o -name benchmark -o -name benchmarks \) \
      -exec rm -rf {} + 2>/dev/null || true && \
    find ./node_modules -type f \( -name "*.md" -o -name "*.ts" -o -name "*.map" \
      -o -name "*.flow" -o -name ".eslintrc*" -o -name ".prettierrc*" \
      -o -name "tsconfig*.json" -o -name "jest.config*" \) \
      -delete 2>/dev/null || true && \
    # 清理 better-sqlite3 的编译中间产物，只保留运行时必要的文件
    for dir in ./node_modules/better-sqlite3/build; do \
      [ -d "$dir" ] && find "$dir" -type f ! -name "*.node" -delete 2>/dev/null || true; \
    done && \
    rm -rf /root/.npm /tmp/*

# ---------- Stage 3: 运行时 ----------
FROM node:20-alpine
WORKDIR /app

# 仅复制运行时必要文件
COPY --from=backend-build /app/backend/node_modules ./backend/node_modules
COPY --from=backend-build /app/backend/dist ./backend/dist
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

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "backend/dist/index.js"]
