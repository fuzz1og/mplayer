#!/bin/sh
# mobile-debug.sh — 兼容 shim：真正的实现在 mobile-debug.mjs（唯一事实源，#502）。
#
# 保留它是因为文档 / package.json / skill 里的既有调用串写的是 mobile-debug.sh；
# 里面没有任何步骤，改流程只改 mobile-debug.mjs。
#
# 直接 `npm run mobile:debug -- [--no-cold-start|-c]` 亦可。
exec node "$(dirname "$0")/mobile-debug.mjs" "$@"
