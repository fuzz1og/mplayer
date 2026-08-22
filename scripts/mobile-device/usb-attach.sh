#!/usr/bin/env bash
# 把 Android 真机从 Windows 侧 attach 进 WSL（usbipd-win 架构）。
#
# 背景：WSL 里只允许存在一个 adb server（原生 Linux 版）。手机插在 Windows 上，
# 需要 usbipd 把这个 USB 设备透传进 WSL 内核，WSL 的原生 adb 才能看到它。
# 每次重新插拔都要重跑本脚本（bind 只需每台设备做一次，会弹一次 UAC）。
#
# 用法：scripts/mobile-device/usb-attach.sh
# 之后跑 scripts/mobile-debug.sh 进入调试回路。

set -euo pipefail

USBIPD_WIN="/mnt/c/Program Files/usbipd-win/usbipd.exe"
USBIPD_WINPATH='C:\Program Files\usbipd-win\usbipd.exe'
PS="/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"

command -v adb >/dev/null 2>&1 || {
  echo "✗ 找不到 adb（应装在 ~/.local/opt/platform-tools，软链 ~/.local/bin/adb）"; exit 1; }
[ -x "$USBIPD_WIN" ] || {
  echo "✗ Windows 未安装 usbipd-win：winget install dorssel.usbipd-win"; exit 1; }

info() { printf '\033[1;36m▶ %s\033[0m\n' "$*"; }
ok()   { printf '\033[32m✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[33m! %s\033[0m\n' "$*"; }
die()  { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# ---- 找候选设备（描述含 android，或命中常见厂商 VID）----
KNOWN_VID_RE='^(18d1|04e8|2717|12d1|22d9|2d95|2a70|22b8|0fce|0bb4|1004|19d2|2a45):'

info "扫描 Windows 侧 USB 设备（usbipd list）..."
mapfile -t ROWS < <("$USBIPD_WIN" list 2>/dev/null | grep -E '^[[:space:]]*[0-9]+-[0-9]+(\.[0-9]+)*[[:space:]]' || true)

[ ${#ROWS[@]} -gt 0 ] || die "Windows 没看到任何 USB 设备——请插上数据线、手机选「文件传输(MTP)」模式并打开 USB 调试"

CANDS=()
for row in "${ROWS[@]}"; do
  busid=$(awk '{print $1}' <<<"$row")
  vidpid=$(awk '{print $2}' <<<"$row")
  if grep -qiE 'android' <<<"$row" || grep -qE "$KNOWN_VID_RE" <<<"$vidpid"; then
    # 排除已经 Attached 的
    if grep -qiE '[[:space:]]Attached' <<<"$row"; then
      ok "$busid ($vidpid) 已经 attach 进 WSL"
    else
      CANDS+=("$busid")
    fi
  fi
done

[ ${#CANDS[@]} -gt 0 ] || die "没找到可 attach 的 Android 设备。检查：数据线 / 手机 USB 模式 / USB 调试开关"

for busid in "${CANDS[@]}"; do
  row=''
  for r in "${ROWS[@]}"; do
    if grep -F -q -w "$busid" <<<"$r"; then row="$r"; break; fi
  done

  # ---- 未绑定 → 提权 bind（每台设备一次，会弹 UAC）----
  if grep -qiE '[[:space:]]Not[[:space:]]+shared' <<<"$row"; then
    info "$busid 尚未 bind，正在请求管理员权限（请在 UAC 弹窗点「是」）..."
    "$PS" -NoProfile -Command "Start-Process -FilePath '$USBIPD_WINPATH' -ArgumentList 'bind','--busid','$busid' -Verb RunAs -Wait" \
      || die "bind 失败：UAC 被取消或策略拒绝。可手动在管理员终端跑：usbipd bind --busid $busid"
    sleep 1
  fi

  # ---- attach 进 WSL ----
  info "attach $busid 进 WSL ..."
  attached=0
  for i in 1 2 3; do
    out=$("$USBIPD_WIN" attach --wsl --busid "$busid" 2>&1) && { attached=1; echo "$out"; break; }
    echo "$out"
    if grep -qi 'busy' <<<"$out"; then
      die "Windows 正占用设备（通常是手机「文件传输/MTP」模式）。修法：手机下拉通知，把 USB 用途切成「仅充电」（USB 调试保持开），然后重跑本脚本"
    fi
    warn "第 $i 次 attach 失败，1s 后重试..."; sleep 1
  done
  [ $attached -eq 1 ] || die "attach 失败。试试：手机切换 USB 模式后重插，再跑一次本脚本"
done

sleep 2

# ---- 验证原生 adb 可见 ----
info "验证 WSL 原生 adb ..."
SERIALS=$(adb devices | tail -n +2 | awk 'NF {print $1"\t"$2}')
[ -n "$SERIALS" ] || die "usbipd 显示已 attach，但 adb 看不到设备。等 2 秒重跑本脚本，或 adb kill-server 后重试"
ok "adb 设备列表："
echo "$SERIALS" | sed 's/^/    /'
if grep -q 'unauthorized' <<<"$SERIALS"; then
  warn "设备未授权——请在手机上点「允许 USB 调试」弹窗"
fi
echo
echo "下一步：./scripts/mobile-debug.sh"
