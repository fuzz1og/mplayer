#!/bin/sh
# design-lint.sh — 兼容 shim：真正的实现在 scripts/design-lint.mjs（唯一事实源，#500）。
#
# 保留它是因为 CI（.github/workflows/ci.yml）与文档里的既有调用串写的是 ./scripts/design-lint.sh；
# 里面没有任何步骤，改验证范围只改 scripts/design-lint.mjs。
#
# Windows 上不要用 bash 跑它——用 `npm run design-lint`。
exec node "$(dirname "$0")/design-lint.mjs" "$@"
