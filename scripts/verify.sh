#!/usr/bin/env bash
# verify.sh — 验证的唯一入口：本地全量与 CI 分片都调这一个脚本。
# 边界决策见 docs/adr/2026-09-29-ci-verification-boundary.md；
# Expo 依赖一致性那一条见 docs/adr/2026-09-29-dependency-update-governance.md。
#
# 用法:
#   ./scripts/verify.sh              # all：static + renderer + main + core + mobile + expo
#   ./scripts/verify.sh static       # core:build + lint + design-lint + 双端 typecheck + build
#   ./scripts/verify.sh renderer     # 根 vitest（renderer + src/__tests__ 顶层）
#   ./scripts/verify.sh main         # 主进程 vitest（node env，独立 config）
#   ./scripts/verify.sh core         # @mplayer/core vitest
#   ./scripts/verify.sh mobile       # packages/mobile vitest
#   ./scripts/verify.sh expo         # Expo SDK 依赖一致性（expo install --check）
#   ./scripts/verify.sh fast         # = static（兼容旧用法：跳过全部测试）
set -euo pipefail

cd "$(dirname "$0")/.."

SCOPE="${1:-all}"

# 除 core 自己（走源码 alias）外，其余测试都从 @mplayer/core 的 dist 取件。
# CI 里各分片是独立 job，所以每个 scope 各自确保 core 已构建，不依赖 job 顺序。
ensure_core() {
  echo "→ core:build..."
  npm run core:build
}

run_static() {
  ensure_core
  echo "→ lint..."
  npm run lint
  echo "→ design-lint..."
  ./scripts/design-lint.sh
  echo "→ root typecheck..."
  npm run typecheck
  echo "→ mobile typecheck..."
  npm run typecheck:mobile
  echo "→ build..."
  npm run build
}

run_renderer() {
  ensure_core
  echo "→ renderer + src/__tests__ 测试..."
  npx vitest run
}

run_main() {
  ensure_core
  echo "→ main 测试（node env）..."
  npm run test:main
}

run_core() {
  # packages/core/vitest.config.ts 把 @mplayer/core alias 到源码，不需要 dist
  echo "→ core 测试..."
  npm test -w packages/core
}

run_mobile() {
  ensure_core
  echo "→ mobile 测试..."
  npx vitest run --config packages/mobile/vitest.config.ts
}

# Expo SDK 依赖一致性。这是本仓唯一「上游可能让它自己变红」的检查：
# 它读 Expo 远端的 SDK 期望版本，Expo 发布新的期望补丁时就会红（与本次改动无关），
# 红的处置是 expo install --fix。官方保证在 CI 下非零退出：
# "It exits with non-zero in Continuous Integration (CI)."（docs.expo.dev/more/expo-cli）
run_expo() {
  echo "→ Expo SDK 依赖一致性（expo install --check）..."
  ( cd packages/mobile && CI=1 npx expo install --check )
}

case "$SCOPE" in
  all)         run_static; run_renderer; run_main; run_core; run_mobile; run_expo ;;
  static|fast) run_static ;;
  renderer)    run_renderer ;;
  main)        run_main ;;
  core)        run_core ;;
  mobile)      run_mobile ;;
  expo)        run_expo ;;
  *)
    echo "未知 scope: $SCOPE" >&2
    echo "可用: all / static / fast / renderer / main / core / mobile / expo" >&2
    exit 2
    ;;
esac

echo "✓ verify passed ($SCOPE)"
