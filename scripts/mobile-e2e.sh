#!/usr/bin/env bash
# MPlayer 移动端真机 e2e：把手工真机验收流程固化为一条命令（adb 驱动，非 Playwright）。
#
# 链路：设备在位 → reverse 隧道 → Metro 健康 + 归属校验 → 冷启 App（logcat 断言）→
#       发现页排行榜四分区 → 榜单详情页 → 点歌出声（logcat + 播放栏断言）。
# 每步截图/日志存档到 e2e/artifacts/（已 gitignore，仅本地留档）。
#
# 用法：
#   scripts/mobile-e2e.sh                       # 唯一设备 + 复用 8081 Metro（没有则自起）
#   MOBILE_E2E_SERIAL=N7TOAIMFOJPFIV7D scripts/mobile-e2e.sh
#   MOBILE_E2E_DIR=/path/to/other/packages/mobile scripts/mobile-e2e.sh   # 复用别的 checkout 的 Metro
#
# 参数（环境变量）：
#   MOBILE_E2E_SERIAL          adb 序列号（多设备必填；默认取唯一在位设备）
#   MOBILE_E2E_PORT            Metro/Expo 端口，默认 8081
#   MOBILE_E2E_DIR             预期 Metro projectRoot，默认本仓库 packages/mobile
#                              （用于识破陈年 Metro / 别的 worktree 起的 Metro 串线）
#   MOBILE_E2E_WAIT_DEVICE     无设备时轮询等待秒数，默认 20（usbipd 直挂常需要重 attach）
#   MOBILE_E2E_BOOT_TIMEOUT    冷启断言超时秒数，默认 240（首编译较慢）
#   MOBILE_E2E_START_METRO     端口无 Metro 时是否代为拉起（1 是 / 0 否），默认 1
#
# 前置：手机经 usbipd 直挂进 WSL（scripts/mobile-device/usb-attach.sh）；
#       @mplayer/core 已构建（packages/core/dist 过期症状：启动即 undefined is not a function，
#       本脚本会把它识别为明确 FAIL）。
#
# 退出码：0 全部通过；1 有 FAIL（摘要逐条列出）。

set -euo pipefail

REPO="$(git rev-parse --show-toplevel)"
PORT="${MOBILE_E2E_PORT:-8081}"
SERIAL="${MOBILE_E2E_SERIAL:-}"
EXPECT_ROOT="${MOBILE_E2E_DIR:-$REPO/packages/mobile}"
WAIT_DEVICE="${MOBILE_E2E_WAIT_DEVICE:-20}"
BOOT_TIMEOUT="${MOBILE_E2E_BOOT_TIMEOUT:-240}"
START_METRO="${MOBILE_E2E_START_METRO:-1}"
EXP_PKG="host.exp.exponent"
ART="$REPO/e2e/artifacts"
LCAT_FILE="$ART/mobile-logcat.log"
DUMP_FILE="$ART/mobile-uidump.xml"

# 参考机（OPPO PKB110, 1256x2760）手工校准坐标；其他分辨率按 wm size 等比缩放
REF_W=1256; REF_H=2760
TAB_DISCOVER_X=466; TAB_DISCOVER_Y=2593   # 底部 tab「发现」
SONG2_X=628; SONG2_Y=814                  # 榜单详情页列表第 2 行

# ---------- 输出助手 ----------
C_INFO=$'\033[1;36m'; C_OK=$'\033[32m'; C_WARN=$'\033[33m'; C_BAD=$'\033[31m'; C_OFF=$'\033[0m'
info()  { printf '%s▶ %s%s\n'  "$C_INFO" "$*" "$C_OFF"; }
ok()    { printf '%s  ✓ %s%s\n' "$C_OK"   "$*" "$C_OFF"; }
warn()  { printf '%s  ! %s%s\n' "$C_WARN" "$*" "$C_OFF"; }
bad()   { printf '%s  ✗ %s%s\n' "$C_BAD"   "$*" "$C_OFF"; }
detail(){ printf '    %s\n' "$*"; }

# ---------- 摘要 ----------
declare -a SUMMARY=()
FAILS=0
record() { # id PASS|FAIL|SKIP note
  SUMMARY+=("$1|$2|$3")
  case "$2" in
    PASS) ok "[$1] $3" ;;
    FAIL) bad "[$1] $3"; FAILS=$((FAILS + 1)) ;;
    SKIP) warn "[$1] 跳过：$3" ;;
  esac
}

# 前置步骤失败即终止：把未跑步骤标 SKIP、打摘要、退 1（参数可为空=无剩余步骤）
abort_after() {
  local id
  for id in "$@"; do
    [ -n "$id" ] || continue
    record "$id" SKIP "前置步骤失败"
  done
  stop_logcat
  print_summary
  exit 1
}

SUMMARY_PRINTED=0
print_summary() {
  [ "$SUMMARY_PRINTED" = 1 ] && return 0
  SUMMARY_PRINTED=1
  printf '\n%s===== 移动端 e2e 摘要 =====%s\n' "$C_INFO" "$C_OFF"
  local row id st note
  for row in "${SUMMARY[@]}"; do
    id="${row%%|*}"; row="${row#*|}"; st="${row%%|*}"; note="${row#*|}"
    case "$st" in
      PASS) printf '%s✓%s %s — %s\n' "$C_OK"   "$C_OFF" "$id" "$note" ;;
      FAIL) printf '%s✗%s %s — %s\n' "$C_BAD"   "$C_OFF" "$id" "$note" ;;
      SKIP) printf '%s-%s %s — %s\n' "$C_WARN" "$C_OFF" "$id" "$note" ;;
    esac
  done
  if [ "$FAILS" -eq 0 ]; then
    printf '%s结果：全部通过（%d 步）%s\n' "$C_OK" "${#SUMMARY[@]}" "$C_OFF"
  else
    printf '%s结果：%d 步失败，产物与 logcat 见 %s%s\n' "$C_BAD" "$FAILS" "$ART" "$C_OFF"
  fi
}

# ---------- 基础设施 ----------
command -v adb >/dev/null || { echo "✗ 找不到 adb（~/.local/opt/platform-tools，软链 ~/.local/bin/adb）"; exit 1; }
command -v python3 >/dev/null || { echo "✗ 找不到 python3（uiautomator dump 解析依赖）"; exit 1; }
for f in "$REPO/packages/mobile/app.json" "$REPO/package.json"; do
  [ -f "$f" ] || { echo "✗ 请在 MPlayer 仓库（或其 worktree）内运行：$f 不存在"; exit 1; }
done
mkdir -p "$ART"

adbx() { if [ -n "$SERIAL" ]; then adb -s "$SERIAL" "$@"; else adb "$@"; fi; }

device_ok() { # 本轮目标的 serial 是否仍以 device 状态在位
  adb devices | tail -n +2 | awk -v s="$SERIAL" '$1==s && $2=="device"' | grep -q .
}

# usbipd 透传掉线自愈：重 attach → 等在位（脚本所在环境是 usbipd 直挂，
# attach 中途掉线是常态；非 usbipd 环境找不到 usbipd.exe 时只重试 adb）
heal_device() {
  local i busid out usbipd="/mnt/c/Program Files/usbipd-win/usbipd.exe"
  warn "设备 $SERIAL 不在位，尝试自愈（透传重挂）..."
  for i in 1 2 3; do
    if [ -x "$usbipd" ]; then
      for busid in $("$usbipd" list 2>/dev/null | grep -E '^[[:space:]]*[0-9]+-' | grep -iE 'android|adb|PKB110|2a70|18d1|22d9' | awk '{print $1}'); do
        if out=$("$usbipd" attach --wsl --busid "$busid" 2>&1); then
          detail "已重挂 $busid"
        else
          warn "attach $busid 失败：$(tail -1 <<<"$out")"
        fi
      done
    fi
    sleep 4
    adb start-server >/dev/null 2>&1 || true
    if device_ok; then
      adbx reverse "tcp:$PORT" "tcp:$PORT" >/dev/null 2>&1 || true
      # kill-server 会带走 logcat 捕获进程，复活它（不 clear，旧断言已消费）
      if ! kill -0 "${LCAT_PID:-0}" 2>/dev/null; then start_logcat; fi
      ok "设备恢复，reverse 已重建"
      return 0
    fi
    # 尾部重置：下一轮干净枚举（手动验证过 attach 本身不需要 kill-server）
    adb kill-server >/dev/null 2>&1 || true
  done
  return 1
}

shot() { # 截图存档（容错：设备掉线时警告，不打断断言链）
  if adbx exec-out screencap -p > "$ART/$1" 2>/dev/null; then
    detail "截图：e2e/artifacts/$1"
  else
    warn "截图失败：$1（设备可能掉线）"
  fi
}

# logcat 捕获（冷启前启动，贯穿全程；各步骤对同一份文件轮询断言）
LCAT_PID=""
start_logcat() {
  : > "$LCAT_FILE"
  # -T 1：即便 logcat -c 失败，也只从启动瞬间起算，避免旧缓冲造成假 PASS
  adbx logcat -v time -T 1 'ReactNativeJS:V' 'ExpoModulesCore:V' '*:S' > "$LCAT_FILE" 2>&1 &
  LCAT_PID=$!
}
stop_logcat() {
  if [ -n "$LCAT_PID" ]; then kill "$LCAT_PID" 2>/dev/null || true; LCAT_PID=""; fi
}
# 兜底：任何路径退出（含 set -e 意外击穿）都保证有摘要
trap 'stop_logcat; print_summary' EXIT

logcat_wait() { # $1=grep 模式 $2=超时秒 → 0 找到
  local deadline=$((SECONDS + $2))
  while [ "$SECONDS" -lt "$deadline" ]; do
    # -a：logcat 里混裸字节（直链 URL 行）会被当二进制，-q 也照样废掉 -o 提取
    grep -aq "$1" "$LCAT_FILE" 2>/dev/null && return 0
    # adb 掉线会带走捕获进程：设备还在就复活（: > file 只丢已消费的历史行）
    if ! kill -0 "${LCAT_PID:-0}" 2>/dev/null && device_ok; then start_logcat; fi
    sleep 1
  done
  return 1
}

# UI 树抓到 DUMP_FILE（uiautomator 偶发 idle 失败，重试）；0=成功
# 关键：进手先删旧文件——失败时绝不能让上层 grep 命中上一轮的过期快照
dump_ui() {
  local i xml
  rm -f "$DUMP_FILE"
  for i in 1 2 3 4 5; do
    adbx shell uiautomator dump /sdcard/mobile-e2e-dump.xml >/dev/null 2>&1 || true
    xml="$(adbx exec-out cat /sdcard/mobile-e2e-dump.xml 2>/dev/null || true)"
    if grep -q '<node' <<<"$xml"; then printf '%s\n' "$xml" > "$DUMP_FILE"; return 0; fi
    sleep 1
  done
  return 1
}

# $1=正则（匹配 text / content-desc）$2=XML 文件 → 打印首个匹配节点中心坐标（无匹配输出空）
ui_center_of() {
  python3 - "$1" "$2" <<'PYEOF'
import sys, re, xml.etree.ElementTree as ET
pat, path = sys.argv[1], sys.argv[2]
try:
    root = ET.parse(path).getroot()
except Exception:
    sys.exit(0)
for n in root.iter('node'):
    hay = (n.get('text') or '') + '\x00' + (n.get('content-desc') or '')
    if re.search(pat, hay):
        m = re.match(r'\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]', n.get('bounds') or '')
        if m:
            l, t, r, b = map(int, m.groups())
            print((l + r) // 2, (t + b) // 2)
            sys.exit(0)
PYEOF
}

# $1=正则 $2=XML 文件 → text 命中的节点数
ui_count_text() {
  python3 - "$1" "$2" <<'PYEOF'
import sys, re, xml.etree.ElementTree as ET
pat, path = sys.argv[1], sys.argv[2]
try:
    root = ET.parse(path).getroot()
except Exception:
    print(0); sys.exit(0)
print(sum(1 for n in root.iter('node') if re.search(pat, n.get('text') or '')))
PYEOF
}

# 按文本找元素并点按；$2=最多尝试轮数（每轮找不到且 allow_scroll 时上滑再找）
ui_tap_text() { # $1=正则 $2=轮数 $3=allow_scroll(0/1)
  local pos i
  for i in $(seq 1 "${2:-2}"); do
    if ! dump_ui; then device_ok || { heal_device || true; }; fi
    pos="$(ui_center_of "$1" "$DUMP_FILE" || true)"
    if [ -n "$pos" ]; then
      # $pos 是 "cx cy" 两个整数，故意分两次展开
      adbx shell input tap $pos 2>/dev/null \
        || { heal_device || return 1; adbx shell input tap $pos 2>/dev/null || return 1; }
      detail "按文本点按：/$1/ → ($pos)"
      return 0
    fi
    if [ "${3:-0}" = "1" ]; then adbx shell input swipe 628 2100 628 1300 300 2>/dev/null || true; sleep 1.5; fi
  done
  return 1
}

# 坐标点按（带掉线自愈重试）；失败返回 1，调用方负责 FAIL 记录
dev_tap() {
  if adbx shell input tap "$1" "$2" 2>/dev/null; then return 0; fi
  heal_device || return 1
  adbx shell input tap "$1" "$2" 2>/dev/null
}

scale_xy() { # $1=x $2=y → 按参考机分辨率等比换算为整数坐标（必须带换行，否则 read 判 EOF 返回 1）
  awk -v x="$1" -v y="$2" -v rw="$REF_W" -v rh="$REF_H" \
      -v W="$SCREEN_W" -v H="$SCREEN_H" 'BEGIN { printf "%d %d\n", x*W/rw, y*H/rh }'
}

info "MPlayer 移动端真机 e2e"
detail "串号=$SERIAL(空=自动)  端口=$PORT  预期 Metro projectRoot=$EXPECT_ROOT"
detail "产物目录：$ART"
echo

# ---------- 1. 设备在位 ----------
STEP_REST=(reverse metro coldstart discover hotlist-detail play)
devs=""
deadline=$((SECONDS + WAIT_DEVICE))
while :; do
  devs="$(adb devices | tail -n +2 | grep -vE '^[[:space:]]*$' || true)"
  [ -n "$devs" ] && break
  [ "$SECONDS" -ge "$deadline" ] && break
  sleep 2
done
if [ -z "$devs" ]; then
  record device FAIL "无设备（等了 ${WAIT_DEVICE}s）。插线后跑 scripts/mobile-device/usb-attach.sh；usbipd 透传掉线时重挂：adb kill-server 后 /mnt/c/Windows/System32/cmd.exe /c \"usbipd attach --wsl --busid <busid>\""
  abort_after "${STEP_REST[@]}"
fi
# 指定了 serial 但不在位：先试一轮透传自愈再判 FAIL（attach 掉线是常态）
if [ -n "$SERIAL" ] && ! awk '$2=="device"{print $1}' <<<"$devs" | grep -qx "$SERIAL"; then
  heal_device || true
  devs="$(adb devices | tail -n +2 | grep -vE '^[[:space:]]*$' || true)"
fi
if grep -q 'unauthorized' <<<"$devs"; then
  record device FAIL "设备 unauthorized——去手机上点「允许 USB 调试」"
  abort_after "${STEP_REST[@]}"
fi
# 双 transport 串线陷阱：无线 + USB 同时挂时 reverse 静默不通（同 mobile-debug.sh）
if awk '$2=="device"{print $1}' <<<"$devs" | grep -qE '^[0-9.]+:[0-9]+$'; then
  warn "检测到无线 transport（双 transport 会静默串线），断开无线只留 USB"
  adb disconnect >/dev/null 2>&1 || true
  devs="$(adb devices | tail -n +2 | grep -vE '^[[:space:]]*$' || true)"
fi
if [ -n "$SERIAL" ]; then
  awk '$2=="device"{print $1}' <<<"$devs" | grep -qx "$SERIAL" \
    || { record device FAIL "序列号 $SERIAL 不在在位设备中。当前：$(echo "$devs" | tr '\n' ' ')"; abort_after "${STEP_REST[@]}"; }
else
  count="$(awk '$2=="device"' <<<"$devs" | wc -l)"
  [ "$count" -eq 1 ] || { record device FAIL "在位设备多于 1 台，请用 MOBILE_E2E_SERIAL 指定。当前：$(echo "$devs" | tr '\n' ' ')"; abort_after "${STEP_REST[@]}"; }
  SERIAL="$(awk '$2=="device"{print $1}' <<<"$devs" | head -1)"
fi
SCREEN_W="$(adbx shell wm size | grep -oE '[0-9]+x[0-9]+' | tail -1 | cut -d x -f1)"
SCREEN_H="$(adbx shell wm size | grep -oE '[0-9]+x[0-9]+' | tail -1 | cut -d x -f2)"
record device PASS "在位 serial=$SERIAL，屏幕 ${SCREEN_W}x${SCREEN_H}"

# ---------- 2. reverse 隧道 ----------
if adbx reverse "tcp:$PORT" "tcp:$PORT" 2>/dev/null; then
  record reverse PASS "手机侧 localhost:$PORT → 本机 $PORT"
else
  record reverse FAIL "adb reverse 失败（重跑前先 adb kill-server，或按 mobile-device-debugging skill 排查）"
  abort_after metro coldstart discover hotlist-detail play
fi

# ---------- 3. Metro 健康与归属 ----------
metro_status="$(curl -sf --max-time 5 "http://127.0.0.1:$PORT/status" || true)"
if grep -q 'packager-status:running' <<<"$metro_status"; then
  info "Metro 已在 $PORT 跑，复用之（不杀、不起第二个）"
elif [ "$START_METRO" = "1" ]; then
  info "Metro 未运行，代为拉起（$REPO/packages/mobile，日志 packages/mobile/.expo/dev/logs/e2e-metro.log）"
  mkdir -p "$REPO/packages/mobile/.expo/dev/logs"
  ( cd "$REPO/packages/mobile" && nohup npx expo start --localhost --port "$PORT" \
      >>"$REPO/packages/mobile/.expo/dev/logs/e2e-metro.log" 2>&1 & )
  ready=0
  for _ in $(seq 1 90); do
    curl -sf --max-time 2 "http://127.0.0.1:$PORT/status" 2>/dev/null | grep -q packager-status:running && { ready=1; break; }
    sleep 1
  done
  if [ "$ready" -eq 1 ]; then
    ok "Metro 就绪"
  else
    record metro FAIL "代拉的 Metro 90s 未就绪，排查 packages/mobile/.expo/dev/logs/e2e-metro.log"
    abort_after coldstart discover hotlist-detail play
  fi
else
  record metro FAIL "端口 $PORT 无 Metro 且 MOBILE_E2E_START_METRO=0。先跑 scripts/mobile-debug.sh 或手动 npx expo start"
  abort_after coldstart discover hotlist-detail play
fi

# 归属校验：App 实际吃到的 manifest 里 extra.expoClient._internal.projectRoot
manifest="$(curl -sf --max-time 10 -H 'expo-platform: android' -H 'Accept: application/expo+json,application/json' "http://127.0.0.1:$PORT/" || true)"
actual_root="$(python3 -c 'import json,sys; m=json.load(sys.stdin); print(m["extra"]["expoClient"]["_internal"].get("projectRoot",""))' <<<"$manifest" 2>/dev/null || true)"
if [ -z "$actual_root" ]; then
  record metro FAIL "取不到 manifest 的 projectRoot（$PORT 可能不是 Expo dev server？）"
  abort_after coldstart discover hotlist-detail play
elif [ "$actual_root" != "$EXPECT_ROOT" ]; then
  record metro FAIL "Metro 归属不符：$PORT 上的 Metro 属于 [$actual_root]，预期 [$EXPECT_ROOT]。陈年/别的 worktree 的 Metro 串线——改用 MOBILE_E2E_DIR=该目录 复用，或杀掉后重跑"
  abort_after coldstart discover hotlist-detail play
else
  record metro PASS "projectRoot 匹配：$actual_root"
fi

# ---------- 4. 冷启 + 启动断言 ----------
info "冷启 App（force-stop $EXP_PKG → exp://localhost:$PORT）"
adbx shell am force-stop "$EXP_PKG" >/dev/null 2>&1 || true
sleep 1
adbx logcat -c >/dev/null 2>&1 || true
start_logcat
if ! adbx shell am start -a android.intent.action.VIEW -d "exp://localhost:$PORT" >/dev/null 2>&1; then
  heal_device || true
  if ! adbx shell am start -a android.intent.action.VIEW -d "exp://localhost:$PORT" >/dev/null 2>&1; then
    record coldstart FAIL "am start 失败（设备掉线且自愈未果）。当前设备：$(adb devices | tail -n +2 | tr '\n' ' ')"
    abort_after discover hotlist-detail play
  fi
fi

have_main=0; have_migrate=0; boot_fail=""
deadline=$((SECONDS + BOOT_TIMEOUT))
while [ "$SECONDS" -lt "$deadline" ]; do
  if grep -q 'undefined is not a function' "$LCAT_FILE" 2>/dev/null; then
    boot_fail="启动即 undefined is not a function——core dist 断裂症状，先 npm run core:build 再冷启"
    break
  fi
  grep -q 'Running "main"' "$LCAT_FILE" 2>/dev/null && have_main=1
  grep -q '存量数据迁移完成' "$LCAT_FILE" 2>/dev/null && have_migrate=1
  [ "$have_main" -eq 1 ] && [ "$have_migrate" -eq 1 ] && break
  device_ok || heal_device || true
  sleep 2
done
if [ -z "$boot_fail" ] && [ "$have_main" -eq 0 ]; then
  boot_fail="${BOOT_TIMEOUT}s 内未见 Running \"main\"——bundle 未编译完或隧道不通（看 e2e/artifacts/mobile-logcat.log）"
elif [ -z "$boot_fail" ] && [ "$have_migrate" -eq 0 ]; then
  boot_fail='启动后未见 存量数据迁移完成——启动接线（setupLegacyMigration）未跑到'
fi
if [ -n "$boot_fail" ]; then
  shot mobile-01-coldstart-fail.png
  record coldstart FAIL "$boot_fail"
  abort_after discover hotlist-detail play
fi
ok '启动断言：Running "main" + 存量数据迁移完成，无 undefined is not a function'
shot mobile-01-coldstart.png
record coldstart PASS "冷启完成，启动日志断言通过"

# ---------- 5. 发现页 · 排行榜四分区 ----------
read -r TX TY < <(scale_xy "$TAB_DISCOVER_X" "$TAB_DISCOVER_Y")
if ! ui_tap_text '^(发现)$' 2 0; then
  if ! dev_tap "$TX" "$TY"; then
    record discover FAIL "点「发现」tab 失败（设备掉线且自愈未果）。当前设备：$(adb devices | tail -n +2 | tr '\n' ' ')"
    abort_after hotlist-detail play
  fi
  detail "文本未命中，按参考坐标点「发现」：($TX,$TY)"
fi
sleep 3   # 等 tab 切换 + 排行榜骨架屏出现

# 四分区标题逐个等（网络拉榜 5-8s 起渲染，给足轮询）；键迭代避免标题内空格被 word-split
declare -A SECTIONS=(
  [netease-hot]='网易云音乐 · 热歌榜'
  [qq-hot]='QQ 音乐 · 热歌榜'
  [netease-new]='网易云音乐 · 新歌榜'
  [qq-new]='QQ 音乐 · 新歌榜'
)
missing="netease-hot qq-hot netease-new qq-new"
deadline=$((SECONDS + 60)); scrolls=0
while [ -n "${missing// /}" ] && [ "$SECONDS" -lt "$deadline" ]; do
  # dump 失败且设备真不在位（usbipd attach 掉线是常态）才自愈；否则只是 uiautomator idle 抖动
  if ! dump_ui; then device_ok || { heal_device || true; }; fi
  for k in $missing; do
    # 前缀匹配：标题节点实际是「…热歌榜 ›」（带箭头），闭合引号前还有内容
    # if 形式：grep 未命中不能让 for 循环带非零状态返回（顶层 set -e 会杀脚本）
    # 删除不能带尾空格：最后一个 key 后面没有空格，带空格的模式永远删不掉 → 死循环到超时
    if [ -f "$DUMP_FILE" ] && grep -qF "text=\"${SECTIONS[$k]}" "$DUMP_FILE" 2>/dev/null; then
      missing="${missing/$k/}"
    fi
  done
  [ -n "${missing// /}" ] || break
  scrolls=$((scrolls + 1))
  if [ "$scrolls" -ge 3 ]; then
    # 一屏只装得下两个分区，新歌榜在折叠区：前 2 轮纯等（骨架屏/首屏数据），
    # 之后每轮滑一屏直到列表底（input swipe 到底自动 clamp）
    adbx shell input swipe 628 2200 628 700 400 2>/dev/null || true
    sleep 2.5
  else
    sleep 2
  fi
done
shot mobile-02-discover-hotlist.png
if [ -n "${missing// /}" ]; then
  miss_titles=""
  for k in $missing; do miss_titles+="「${SECTIONS[$k]}」"; done
  record discover FAIL "排行榜分区未齐（缺失：$miss_titles）。截图 mobile-02-discover-hotlist.png 可核对——骨架屏卡住/接口失败都会命中"
  abort_after hotlist-detail play
fi
# 分区头齐了还要有歌曲行：rank 数字文本节点（每个分区渲染 top N 行）
if ! dump_ui; then device_ok || { heal_device || true; }; fi
rank_nodes="$(ui_count_text '^[0-9]{1,3}$' "$DUMP_FILE")"
if [ "${rank_nodes:-0}" -lt 4 ]; then
  record discover FAIL "四分区标题齐但歌曲行未渲染（rank 数字节点仅 ${rank_nodes} 个，应 ≥4）"
  abort_after hotlist-detail play
fi
record discover PASS "四分区（网易云/QQ · 热歌/新歌）齐，rank 行 ${rank_nodes} 个"

# ---------- 6. 榜单详情页 ----------
if ! ui_tap_text 'QQ 音乐 · 新歌榜' 3 1; then
  shot mobile-03-hotlist-tap-fail.png
  record hotlist-detail FAIL "找不到「QQ 音乐 · 新歌榜」分区头可点（截图 mobile-03-hotlist-tap-fail.png）"
  abort_after play
fi
sleep 2
# 详情页断言：全量列表渲染（top100；rank 数字节点足够多即代表列表行在。
# 可视行数随迷你播放栏/Toast 浮动，阈值取宽松的 8，语义是「列表真的渲染了行」）
deadline=$((SECONDS + 30)); detail_ranks=0
while [ "$SECONDS" -lt "$deadline" ]; do
  if ! dump_ui; then device_ok || { heal_device || true; }; fi
  detail_ranks="$(ui_count_text '^[0-9]{1,3}$' "$DUMP_FILE")"
  [ "${detail_ranks:-0}" -ge 8 ] && break
  sleep 2
done
shot mobile-03-hotlist-detail.png
if [ "${detail_ranks:-0}" -ge 8 ]; then
  record hotlist-detail PASS "QQ 音乐 · 新歌榜详情页全量列表渲染（rank 节点 ${detail_ranks} 个）"
else
  record hotlist-detail FAIL "详情页列表未渲染全（rank 节点仅 ${detail_ranks} 个，应 ≥8）。截图 mobile-03-hotlist-detail.png"
  abort_after play
fi

# ---------- 7. 点歌出声 ----------
read -r SX SY < <(scale_xy "$SONG2_X" "$SONG2_Y")
if ! dev_tap "$SX" "$SY"; then
  record play FAIL "点列表第 2 行失败（设备掉线且自愈未果）。当前设备：$(adb devices | tail -n +2 | tr '\n' ' ')"
  abort_after ""
fi
detail "点列表第 2 行：($SX,$SY)"
# RN 的 console.log('[player]', msg) 多参数在 logcat 里渲染为 '[player]', 'msg'（引号逗号分隔），
# 不能带 "[player] " 前缀匹配，直接匹配消息本体
if ! logcat_wait '开始播放《' 20; then
  shot mobile-04-playing-fail.png
  record play FAIL "点歌后 20s 无「开始播放《」日志——点击未命中歌曲行或播放流程未发起"
  print_summary
  exit 1
fi
PLAYED="$(grep -aoE '开始播放《[^》]+》' "$LCAT_FILE" | tail -1 | sed 's/^开始播放《//; s/》$//' || true)"
SONG_NAME="${PLAYED%%[（-]*}"   # 保险：去掉可能拖带的备注尾巴
# 注意：BRE 里 \(..\)=分组、(..)=字面括号，这里要匹配字面括号必须裸写
if logcat_wait '播放器就绪(出声)' 60; then
  ok "logcat：开始播放《$PLAYED》 + 播放器就绪(出声)"
else
  shot mobile-04-playing-fail.png
  record play FAIL "「开始播放《$PLAYED》」已见，但 60s 无「播放器就绪(出声)」——音源解析/缓冲失败"
  print_summary
  exit 1
fi
sleep 2
shot mobile-04-playing.png
# 播放栏断言：屏幕上应出现歌名文本（底部迷你播放栏）
if [ -n "$SONG_NAME" ] && dump_ui && grep -qF "text=\"$SONG_NAME\"" "$DUMP_FILE"; then
  record play PASS "出声且播放栏显示歌名《$SONG_NAME》（截图 mobile-04-playing.png）"
else
  record play FAIL "已出声，但屏幕文本未见歌名「$SONG_NAME」——播放栏可能未滑入（截图 mobile-04-playing.png 核对）"
fi

stop_logcat
print_summary
[ "$FAILS" -eq 0 ]
