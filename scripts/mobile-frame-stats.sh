#!/bin/sh
# mobile-frame-stats.sh — 兼容 shim：真正的实现在 mobile-frame-stats.mjs（唯一事实源，#502）。
#
# 保留它是因为文档 / package.json / skill 里的既有调用串写的是 mobile-frame-stats.sh；
# 里面没有任何步骤，改流程只改 mobile-frame-stats.mjs。
#
# 直接 `npm run mobile:frame-stats` 亦可（环境变量同原脚本）。
exec node "$(dirname "$0")/mobile-frame-stats.mjs" "$@"
