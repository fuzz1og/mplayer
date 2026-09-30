#!/bin/sh
# usb-attach.sh — 兼容 shim：真正的实现在 usb-attach.mjs（唯一事实源，#502）。
#
# 保留它是因为文档 / package.json / skill 里的既有调用串写的是 usb-attach.sh；
# 里面没有任何步骤，改流程只改 usb-attach.mjs。
#
# 直接 `npm run mobile:usb-attach` 亦可（只在 WSL 里有意义）。
exec node "$(dirname "$0")/usb-attach.mjs" "$@"
