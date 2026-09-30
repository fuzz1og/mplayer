#!/bin/sh
# verify.sh — 兼容 shim：真正的实现在 scripts/verify.mjs（唯一事实源，#500）。
#
# 保留它是因为 CI（.github/workflows/ci.yml）与文档里的既有调用串写的是 ./scripts/verify.sh；
# 里面没有任何步骤，改验证范围只改 scripts/verify.mjs。
#
# Windows 上不要用 bash 跑它——那个 bash 可能是 WSL 的 Linux bash。用 `npm run verify -- <scope>`。
exec node "$(dirname "$0")/verify.mjs" "$@"
