#!/bin/sh
# dev-mobile.sh — 兼容 shim：真正的实现在 dev-mobile.mjs（唯一事实源，#502）。
#
# 保留它是因为文档 / package.json / skill 里的既有调用串写的是 dev-mobile.sh；
# 里面没有任何步骤，改流程只改 dev-mobile.mjs。
#
# 直接 `npm run dev:mobile` 亦可。
exec node "$(dirname "$0")/dev-mobile.mjs" "$@"
