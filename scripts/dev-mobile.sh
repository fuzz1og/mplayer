#!/usr/bin/env bash
# 移动端 Expo dev server（Windows Git Bash / macOS / Linux）
# 用法：bash scripts/dev-mobile.sh
#
# 说明：
# 1. 主仓库根 node_modules 依赖提升不完整（expo-router 等落在
#    packages/mobile/node_modules），需要 NODE_PATH 指向移动端本地依赖，
#    否则 @expo/cli 解析 expo-router/_ctx-shared 会失败。
# 2. Metro 的 watcher 已通过 packages/mobile/metro.config.js 的 blockList
#    排除易消失的构建产物目录（vitest 临时目录、android/build 等），
#    避免 Windows 上"外部进程删除目录导致 watcher 崩溃"。
# 3. 非 CI 模式启动：保留热重载（Fast Refresh）。
set -e
cd "$(dirname "$0")/../packages/mobile"
export NODE_PATH="$(pwd)/node_modules"
npx expo start --port 8091
