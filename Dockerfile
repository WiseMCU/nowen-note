# Stage 1: Build frontend
FROM node:20-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json ./
RUN npm install
COPY frontend/ .
RUN npx vite build

# Stage 2: Build backend
FROM node:20-slim AS backend-build
WORKDIR /app/backend
# 安装原生模块编译工具链（better-sqlite3 需要）
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY backend/package.json ./
RUN npm install
COPY backend/ .
RUN npx tsc

# Stage 3: Production
FROM node:20-slim
WORKDIR /app

# 安装原生模块编译工具链，安装依赖后清理
COPY backend/package.json ./backend/
RUN apt-get update && apt-get install -y python3 make g++ \
    && cd backend && npm install --omit=dev \
    && apt-get purge -y python3 make g++ && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/* /root/.npm /tmp/*

COPY --from=backend-build /app/backend/dist ./backend/dist
COPY backend/templates ./backend/templates
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV DB_PATH=/app/data/nowen-note.db
ENV PORT=3001

EXPOSE 3001

WORKDIR /app
CMD ["node", "backend/dist/index.js"]
