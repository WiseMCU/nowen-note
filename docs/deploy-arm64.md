# ARM64 设备部署指南

本项目可以在 aarch64 设备上以 Docker 方式运行，把板子当作后端服务器，
前端通过浏览器访问。已验证 / 计划支持的目标设备：

| 设备 | SoC | 架构 | 常见系统 |
| --- | --- | --- | --- |
| OES 开发板 | 视型号 | aarch64 | OES Linux（Debian 系） |
| Khadas VIM3 等 | Amlogic A311D | aarch64 (Cortex-A73+A53) | Armbian / Ubuntu |
| OECT 开发板 | 视型号 | aarch64 | Debian 系 |
| RK3566 各型号 | Rockchip RK3566 | aarch64 (Cortex-A55) | Armbian / OpenKylin |

> 四款均为 64 位 ARM，统一按 `linux/arm64` 构建即可。

---

## 一、在 x86 开发机上交叉构建 arm64 镜像

推荐做法：**x86 构建 → 传到板子 load**，比板子原生构建快得多。

### 1. 一次性环境准备

```bash
# 注册 QEMU binfmt，使 x86 能执行 arm64 二进制（buildx 需要）
docker run --privileged --rm tonistiigi/binfmt --install arm64

# 创建 buildx builder（脚本会自动创建，也可手动）
docker buildx create --name nowen-builder --use
docker buildx inspect --bootstrap
```

### 2. 构建方式（任选一种）

**A. 本地加载（做冒烟测试）**

```bash
bash scripts/build-arm64.sh
# 构建完成后:
docker run --platform linux/arm64 -p 3001:3001 -v nowen-data:/app/data nowen-note:arm64
```

**B. 导出 tar 文件（内网没 registry 的常用姿势）**

```bash
bash scripts/build-arm64.sh --tar
# 得到 nowen-note-arm64.tar，scp 到板子后：
docker load -i nowen-note-arm64.tar
```

**C. 推到 registry**

```bash
bash scripts/build-arm64.sh --push registry.example.com/nowen-note:arm64
```

**D. 多架构 manifest（同时发 amd64 + arm64）**

```bash
bash scripts/build-arm64.sh --multi
# 默认 tag 是 nowen-note:multi，可用 IMAGE_NAME=xxx TAG=xxx 覆盖
```

---

## 二、在板子上运行

### 方式 1：直接 docker run

```bash
docker run -d \
  --name nowen-note \
  --restart unless-stopped \
  -p 3001:3001 \
  -v nowen-note-data:/app/data \
  nowen-note:arm64
```

访问 `http://<板子 IP>:3001` 即可。

### 方式 2：docker-compose

将仓库中的 `docker-compose.yml` 复制到板子上，然后：

```bash
docker compose up -d
```

> 若使用已构建的 arm64 镜像而非本地再次 build，可把 compose 里的 `build:`
> 整块删掉，只保留 `image: nowen-note:arm64`。

---

## 三、板子前置依赖

| 要求 | 说明 |
| --- | --- |
| Linux 内核 | ≥ 4.x；板子自带的 Armbian/OES 一般满足 |
| Docker Engine | ≥ 20.10；`apt install docker.io` 即可 |
| 磁盘 | ≥ 500 MB（镜像 ~350 MB + 笔记数据卷） |
| 内存 | ≥ 512 MB 空闲（better-sqlite3 + Node 运行时） |

---

## 四、常见问题

### Q1. 构建到 "Cannot find module @rollup/rollup-linux-arm64-gnu"
已在新版 `Dockerfile` 修复：按 `TARGETARCH` 动态安装对应 rollup 原生包。
如果你仍在用旧 Dockerfile，请 `git pull` 拉最新。

### Q2. better-sqlite3 编译非常慢 / 卡住不动
这是 QEMU 模拟 arm64 的预期表现（单次构建耗时 3–8 分钟）。建议：
- 用一次性 `--multi` 构建并 push 到私有 registry，后续板子只拉镜像；
- 或在板子原生构建一次，打成 tar 复用。

### Q3. 想在板子原生构建
可以，但时间会是交叉构建的 2–4 倍。直接在板子仓库根执行：
```bash
docker build -t nowen-note:arm64 .
```

### Q4. JWT 密钥怎么处理
无需手动配置：`docker-entrypoint.sh` 首次启动会在 `/app/data/.jwt_secret`
自动生成强随机密钥并持久化。多台板子各自独立。
如需统一密钥（多实例共享登录态），用 `-e JWT_SECRET=...` 显式注入。

### Q5. 板子能反过来给 x86 主机用吗？
`nowen-note:arm64` 镜像不能在 x86 上原生跑，但启用了 binfmt/qemu 的主机
可以通过 `docker run --platform linux/arm64` 模拟执行（慢，仅用于验证）。
