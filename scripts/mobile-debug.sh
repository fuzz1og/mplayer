#!/usr/bin/env bash
# MPlayer 真机调试一条龙（usbipd 架构：WSL 原生 adb 单 server）：
#   重置 adb → 设备/双 transport 检查 → USB reverse → 起 Metro → 冷启 App → logcat
#
# 前置：手机已通过 scripts/mobile-device/usb-attach.sh attach 进 WSL。
# 用法：scripts/mobile-debug.sh            # 完整回路（含冷启）
#       scripts/mobile-debug.sh --no-cold-start   # 不杀 App，直接热拉起
#       scripts/mobile-debug.sh -c                # 清 Metro 缓存启动
#
# 完成标准：logcat 出现 Running "main" + 存量数据迁移完成；
#          Metro 日志（packages/mobile/.expo/dev/logs/start.log）出现 metro:bundling:done。

set -euo pipefail

PORT=8081
EXP_PKG=host.exp.exponent

ROOT="$(git rev-parse --show-toplevel)"
MOBILE="$ROOT/packages/mobile"
LOG="$MOBILE/.expo/dev/logs/start.log"

NO_COLD=0; CLEAR=0
for a in "$@"; do
  case "$a" in
    --no-cold-start) NO_COLD=1 ;;
    -c|--clear)      CLEAR=1 ;;
    *) echo "未知参数：$a"; exit 1 ;;
  esac
done

info() { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
ok()   { printf '\033[32m✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[33m! %s\033[0m\n' "$*"; }
die()  { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

command -v adb >/dev/null || die "找不到 adb"

info "0. 重置 adb（保证单 server，消灭互踢竞态）"
adb kill-server >/dev/null 2>&1 || true
adb start-server >/dev/null

info "1. 设备检查"
DEVS="$(adb devices | tail -n +2 | grep -v '^[[:space:]]*$' || true)"
[ -n "$DEVS" ] || die "无设备。先插线并跑 scripts/mobile-device/usb-attach.sh"
echo "$DEVS" | sed 's/^/    /'
grep -q 'unauthorized' <<<"$DEVS" && warn "设备 unauthorized——去手机上点「允许 USB 调试」"
grep -q 'offline'      <<<"$DEVS" && warn "设备 offline——重插线或重跑 usb-attach.sh"

# 双 transport 串线陷阱：无线 + USB 同时挂着时 reverse 静默不通
if awk '$2=="device"{print $1}' <<<"$DEVS" | grep -qE '^[0-9.]+:[0-9]+$'; then
  warn "检测到无线 transport（双 transport 会静默串线），断开无线只留 USB"
  adb disconnect >/dev/null 2>&1 || true
fi

info "2. USB reverse 隧道 tcp:$PORT"
adb reverse "tcp:$PORT" "tcp:$PORT"
ok "手机侧 localhost:$PORT → 本机 Metro"

info "3. Metro（Expo dev server）"
mkdir -p "$(dirname "$LOG")"
if curl -sf "http://127.0.0.1:$PORT/status" 2>/dev/null | grep -q packager-status:running; then
  ok "Metro 已在跑，复用之（日志：$LOG）"
else
  EXPO_ARGS=(start --localhost)
  [ $CLEAR -eq 1 ] && EXPO_ARGS+=(-c)
  : > "$LOG"
  ( cd "$MOBILE" && nohup npx expo "${EXPO_ARGS[@]}" >>"$LOG" 2>&1 & echo $! > "$MOBILE/.expo/dev/metro.pid" )
  echo "    后台启动中（日志：$LOG）..."
  ready=0
  for _ in $(seq 1 60); do
    curl -sf "http://127.0.0.1:$PORT/status" 2>/dev/null | grep -q packager-status:running && { ready=1; break; }
    sleep 1
  done
  [ $ready -eq 1 ] && ok "Metro 就绪" || die "Metro 60s 未就绪，排查：$LOG"
fi

if [ $NO_COLD -eq 0 ]; then
  info "4. 冷启 App（force-stop $EXP_PKG）"
  adb shell am force-stop "$EXP_PKG" 2>/dev/null || true
  sleep 1
else
  info "4. 跳过冷启（--no-cold-start）"
fi

info "5. 拉起 exp://localhost:$PORT"
adb shell am start -a android.intent.action.VIEW -d "exp://localhost:$PORT" >/dev/null
ok "已发起。等 bundle 编译（首次较慢）"

info "6. logcat 监听（Ctrl-C 退出；Metro 继续后台跑）"
echo "    完成标准：出现 Running \"main\" 和 存量数据迁移完成"
echo ""
exec adb logcat -v time ReactNativeJS:V ExpoModulesCore:V ActivityTaskManager:I '*:S'
