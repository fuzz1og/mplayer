#!/usr/bin/env bash
# verify.sh — 提交/发布前全量验证（对齐 AGENTS.md 验证顺序）
# 用法: ./scripts/verify.sh        # 全量（lint + 双端 typecheck + renderer 测试）
#       ./scripts/verify.sh fast   # 快速（lint + 双端 typecheck，跳过测试）
set -e

cd "$(dirname "$0")/.."

echo "→ lint..."
npm run lint

echo "→ design-lint..."
./scripts/design-lint.sh

echo "→ root typecheck..."
npm run typecheck

echo "→ mobile typecheck..."
npm run typecheck:mobile

if [ "$1" != "fast" ]; then
  echo "→ renderer tests..."
  npx vitest run
fi

echo "✓ verify passed"
