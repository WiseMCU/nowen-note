#!/usr/bin/env bash
# =============================================================================
# 用 Docker buildx 为 arm64 目标设备（A311D / RK3566 / OES / OECT 等）构建镜像
# -----------------------------------------------------------------------------
# 用法：
#   scripts/build-arm64.sh                       # 构建并加载到本机 docker（单架构 arm64）
#   scripts/build-arm64.sh --multi               # 同时构建 amd64+arm64（必须配合 --push）
#   scripts/build-arm64.sh --push registry/name  # 构建并推送到 registry
#   scripts/build-arm64.sh --tar                 # 导出为 tar 文件（便于 scp 到内网板子离线 load）
#
# 前置要求：
#   1. 安装并启用 Docker BuildKit / buildx（Docker Desktop 自带；Linux 需
#      `docker buildx create --use` 一次）。
#   2. 启用 QEMU binfmt_misc 以便在 x86 主机上模拟执行 arm64 二进制（buildx 会
#      自动调用）：
#        docker run --privileged --rm tonistiigi/binfmt --install arm64
#      （CI 环境用 docker/setup-qemu-action）
# =============================================================================

set -euo pipefail

# 切到仓库根（脚本在 scripts/ 下）
cd "$(dirname "$0")/.."

IMAGE_NAME="${IMAGE_NAME:-nowen-note}"
TAG="${TAG:-arm64}"

MODE="load"          # load | push | tar | multi-push
REGISTRY_IMAGE=""
OUT_TAR="nowen-note-arm64.tar"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --multi)
      MODE="multi-push"
      shift
      ;;
    --push)
      MODE="push"
      REGISTRY_IMAGE="${2:-}"
      if [[ -z "$REGISTRY_IMAGE" ]]; then
        echo "ERROR: --push 需要给出完整镜像名，例如 registry.example.com/nowen-note:arm64" >&2
        exit 1
      fi
      shift 2
      ;;
    --tar)
      MODE="tar"
      shift
      ;;
    -h|--help)
      sed -n '2,20p' "$0"
      exit 0
      ;;
    *)
      echo "未知参数: $1" >&2
      exit 1
      ;;
  esac
done

# 确保 buildx builder 存在
if ! docker buildx inspect nowen-builder >/dev/null 2>&1; then
  echo "[build-arm64] 创建 buildx builder: nowen-builder"
  docker buildx create --name nowen-builder --use >/dev/null
else
  docker buildx use nowen-builder >/dev/null
fi
docker buildx inspect --bootstrap >/dev/null

case "$MODE" in
  load)
    # 单架构 arm64 直接 load 到本机 docker（最常用，做本地冒烟）
    echo "[build-arm64] 构建 linux/arm64 → 本地镜像 ${IMAGE_NAME}:${TAG}"
    docker buildx build \
      --platform linux/arm64 \
      -t "${IMAGE_NAME}:${TAG}" \
      --load \
      .
    echo "[build-arm64] 完成。可用 \`docker run --platform linux/arm64 -p 3001:3001 ${IMAGE_NAME}:${TAG}\` 测试"
    ;;

  push)
    echo "[build-arm64] 构建 linux/arm64 并推送到 ${REGISTRY_IMAGE}"
    docker buildx build \
      --platform linux/arm64 \
      -t "${REGISTRY_IMAGE}" \
      --push \
      .
    ;;

  multi-push)
    # 多架构 manifest 只能直接 push 到 registry，不能 --load 到本地
    if [[ -z "${REGISTRY_IMAGE}" ]]; then
      REGISTRY_IMAGE="${IMAGE_NAME}:multi"
    fi
    echo "[build-arm64] 构建多架构 (amd64+arm64) 并推送到 ${REGISTRY_IMAGE}"
    docker buildx build \
      --platform linux/amd64,linux/arm64 \
      -t "${REGISTRY_IMAGE}" \
      --push \
      .
    ;;

  tar)
    # 适合没有 registry、只能 scp 到板子 `docker load -i` 的场景
    echo "[build-arm64] 构建 linux/arm64 → 导出到 ${OUT_TAR}"
    # buildx 支持 --output type=docker,dest=...,platform=...；先构建再 save 也行，这里用前者
    docker buildx build \
      --platform linux/arm64 \
      -t "${IMAGE_NAME}:${TAG}" \
      --output "type=docker,dest=${OUT_TAR}" \
      .
    echo "[build-arm64] 已写入 ${OUT_TAR}，在板子上用: docker load -i ${OUT_TAR}"
    ;;
esac
