#!/bin/sh
# release.sh — 兼容 shim：真正的实现在 release.mjs（唯一事实源，#502）。
#
# 保留它是因为文档 / package.json / skill 里的既有调用串写的是 release.sh；
# 里面没有任何步骤，改流程只改 release.mjs。
#
# 任何 shell 都能跑；Windows 上不要用 bash（那个 bash 可能是 WSL 的）——直接 `npm run release -- <version>`。
exec node "$(dirname "$0")/release.mjs" "$@"
