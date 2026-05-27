# =============================================================================
# nowen-note 多架构 Dockerfile（极致精简版 v2）
# -----------------------------------------------------------------------------
# 支持 linux/amd64 与 linux/arm64
# 优化：UPX 压缩 Node.js 二进制 + 裸 Alpine 运行时
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
RUN npx tsc && \
    rm -rf node_modules && \
    npm ci --omit=dev && \
    find ./node_modules -type d \( \
      -name test -o -name tests -o -name __tests__ \
      -o -name doc -o -name docs -o -name example -o -name examples \
      -o -name .github -o -name benchmark -o -name benchmarks \
      -o -name spec -o -name specs -o -name fixture -o -name fixtures \
      -o -name sample -o -name samples -o -name demo -o -name demos \
      -o -name coverage -o -name .circleci -o -name .travis \) \
      -exec rm -rf {} + 2>/dev/null || true && \
    find ./node_modules -type f \( \
      -name "*.md" -o -name "*.ts" -o -name "*.map" -o -name "*.d.ts" \
      -o -name "*.flow" -o -name ".eslintrc*" -o -name ".prettierrc*" \
      -o -name "tsconfig*.json" -o -name "jest.config*" -o -name "*.gyp" \
      -o -name ".npmignore" -o -name ".npmrc" -o -name "Makefile" \
      -o -name "LICENSE" -o -name "LICENCE" -o -name "CHANGELOG*" \
      -o -name "HISTORY*" -o -name "CONTRIBUTING*" -o -name "CODE_OF_CONDUCT*" \
      -o -name "SECURITY*" -o -name "AUTHORS*" -o -name "*.yml" -o -name "*.yaml" \
      -o -name "*.ini" -o -name "*.toml" -o -name "*.xml" -o -name "*.html" \) \
      -delete 2>/dev/null || true && \
    find ./node_modules -type d -name "build" -exec sh -c ' \
      for d; do find "$d" -type f ! -name "*.node" ! -name "*.so" -delete 2>/dev/null || true; done \
    ' _ {} + && \
    find ./node_modules -type d -empty -delete 2>/dev/null || true && \
    rm -rf /root/.npm /root/.cache /tmp/*

# ---------- Stage 3: UPX 压缩 Node.js ----------
FROM alpine:3.21 AS node-compress
# 下载 UPX 并压缩从 build 阶段来的 node 二进制
RUN wget -q "https://github.com/upx/upx/releases/download/v4.2.4/upx-4.2.4-amd64_linux.tar.xz" -O /tmp/upx.tar.xz && \
    tar -xf /tmp/upx.tar.xz -C /tmp && \
    mv /tmp/upx-*/upx /usr/local/bin/ && \
    rm -rf /tmp/upx*
COPY --from=backend-build /usr/local/bin/node /tmp/node
RUN upx --best -o /usr/local/bin/node /tmp/node && \
    rm /tmp/node

# ---------- Stage 4: 运行时 ----------
FROM alpine:3.21 AS runtime
RUN apk add --no-cache libstdc++ libgcc
COPY --from=node-compress /usr/local/bin/node /usr/local/bin/node
WORKDIR /app

COPY --from=backend-build /app/backend/node_modules ./backend/node_modules
COPY --from=backend-build /app/backend/dist ./backend/dist
COPY backend/templates ./backend/templates
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && mkdir -p /app/data

VOLUME ["/app/data"]

ENV NODE_ENV=production
ENV DB_PATH=/app/data/nowen-note.db
ENV PORT=3001

EXPOSE 3001

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "backend/dist/index.js"]
