#!/usr/bin/env bash
# 移动端帧计时取证（#430）：从**系统侧**量用户看得见的那一层掉不掉帧。
#
# 为什么不能靠 perfMonitor：它量的是 JS 线程 rAF 帧率，且要求连续 2 个 2s 窗口低于 30fps
# 才上报——一次一两秒的拖拽在它眼皮底下结构性不可见（「零 warn」什么也证明不了）。
# 系统侧 gfxinfo / SurfaceFlinger 是独立第三方视角：release 构建可用、不需要 App 配合、
# 窗口天然 ≈2s（gfxinfo 环形缓冲约 120 帧 / SurfaceFlinger 128 帧 ≈ 2.13s@60Hz）。
#
# ⚠ 两个量必须一起看（#430 判据）：
#   1. App 侧 [drag] 日志（services/dragJankProbe.ts）—— JS 线程被占了吗；
#   2. 本脚本的帧计时 —— 用户看得见吗。
#   只看 1 是拿仪器自证；只看 2 不知道是不是拖拽这条路。
#
# ⚠ 反直觉但关键：本 App 的拖拽跟手跑在 JS 线程（PanResponder move → value.setValue）。
#   JS 卡住时面板是「冻住」而不是「画得慢」——UI 线程根本没被要求画新帧，帧统计可能反而
#   很健康（帧少但每帧都准时）。故本脚本的输出**不能单独定罪**，必须与 [drag] 日志合看。
#
# 用法：
#   scripts/mobile-frame-stats.sh                          # 注入 2s 下滑（需先设定坐标）
#   MOBILE_FRAME_SWIPE='628 900 628 1900 2000' scripts/mobile-frame-stats.sh
#   MOBILE_FRAME_WAIT=8 scripts/mobile-frame-stats.sh      # 不注入，留 8s 窗口给你手拖
#   MOBILE_FRAME_PARSE_DIR=e2e/artifacts/frame-xxx scripts/mobile-frame-stats.sh   # 只复算已有 dump
#
# 参数（环境变量）：
#   MOBILE_FRAME_SERIAL   adb 序列号（多设备必填；默认取唯一在位设备）
#   MOBILE_FRAME_PKG      App 包名，默认 com.mplayer.mobile
#   MOBILE_FRAME_LABEL    本次标签（如 idle / busy），进产物文件名与摘要
#   MOBILE_FRAME_SWIPE    "x1 y1 x2 y2 时长ms"；给了就注入，不给就等手拖
#   MOBILE_FRAME_WAIT     等手拖的秒数，默认 6
#   MOBILE_FRAME_LAYER    SurfaceFlinger 层名（默认按包名第一个匹配层）
#   MOBILE_FRAME_PARSE_DIR  仅复算：读该目录下的 framestats/latency dump，不连设备
#
# 退出码：0 采到并解析成功；1 前置失败 / 采不到有效帧。

set -euo pipefail

# 仓库根取脚本自身位置，不用 git rev-parse：worktree 的 .git 是指向主克隆的绝对路径文件，
# 在 WSL 里解析 Windows 路径会 `fatal: not a git repository`，而本脚本正要在 worktree 里跑
# （mobile-e2e.sh 用 git rev-parse，因此它在 Windows 建的 worktree 里跑不起来——已知环境限制）。
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERIAL="${MOBILE_FRAME_SERIAL:-}"
PKG="${MOBILE_FRAME_PKG:-com.mplayer.mobile}"
LABEL="${MOBILE_FRAME_LABEL:-run}"
SWIPE="${MOBILE_FRAME_SWIPE:-}"
WAIT="${MOBILE_FRAME_WAIT:-6}"
LAYER="${MOBILE_FRAME_LAYER:-}"
PARSE_DIR="${MOBILE_FRAME_PARSE_DIR:-}"
ART="$REPO/e2e/artifacts"

C_INFO=$'\033[1;36m'; C_OK=$'\033[32m'; C_WARN=$'\033[33m'; C_BAD=$'\033[31m'; C_OFF=$'\033[0m'
info() { printf '%s▶ %s%s\n' "$C_INFO" "$*" "$C_OFF"; }
ok()   { printf '%s  ✓ %s%s\n' "$C_OK"   "$*" "$C_OFF"; }
warn() { printf '%s  ! %s%s\n' "$C_WARN" "$*" "$C_OFF"; }
bad()  { printf '%s  ✗ %s%s\n' "$C_BAD"  "$*" "$C_OFF"; }

command -v python3 >/dev/null || { bad "找不到 python3（解析 dump 依赖）"; exit 1; }

adbx() { if [ -n "$SERIAL" ]; then adb -s "$SERIAL" "$@"; else adb "$@"; fi; }

if [ -n "$PARSE_DIR" ]; then
  # ---------- 复算模式：不连设备，解析已有 dump ----------
  FRAMESTATS="$PARSE_DIR/gfxinfo-framestats.txt"
  LATENCY="$PARSE_DIR/surfaceflinger-latency.txt"
  [ -f "$FRAMESTATS" ] || { bad "复算目录缺少 $FRAMESTATS"; exit 1; }
  OUT_JSON="$PARSE_DIR/frame-stats.json"
  info "复算已有 dump：$PARSE_DIR"
else
  # ---------- 采集模式 ----------
  command -v adb >/dev/null || { bad "找不到 adb"; exit 1; }
  if [ -z "$SERIAL" ]; then
    SERIAL="$(adb devices | tail -n +2 | awk '$2=="device"{print $1}' | head -1)"
    [ -n "$SERIAL" ] || { bad "没有在位设备（adb devices 空）"; exit 1; }
  fi
  adbx get-state >/dev/null 2>&1 || { bad "设备 $SERIAL 不在位"; exit 1; }
  adbx shell pm list packages 2>/dev/null | grep -q "package:$PKG" \
    || { bad "设备上没装 $PKG（MOBILE_FRAME_PKG 可覆盖；dev 变体是 com.mplayer.mobile.dev）"; exit 1; }

  if [ -z "$LAYER" ]; then
    LAYER="$(adbx shell dumpsys SurfaceFlinger --list 2>/dev/null | tr -d '\r' | grep -F "$PKG" | head -1 || true)"
  fi
  [ -n "$LAYER" ] || warn "没找到 SurfaceFlinger 层（SurfaceFlinger 交叉校验将被跳过）"

  TS="$(date +%Y%m%d-%H%M%S)"
  RUN_DIR="$ART/frame-$LABEL-$TS"
  mkdir -p "$RUN_DIR"
  FRAMESTATS="$RUN_DIR/gfxinfo-framestats.txt"
  LATENCY="$RUN_DIR/surfaceflinger-latency.txt"
  OUT_JSON="$RUN_DIR/frame-stats.json"

  info "清空统计窗口（gfxinfo reset + SurfaceFlinger --latency-clear）"
  adbx shell dumpsys gfxinfo "$PKG" reset >/dev/null 2>&1 || warn "gfxinfo reset 失败（继续）"
  if [ -n "$LAYER" ]; then adbx shell dumpsys SurfaceFlinger --latency-clear "$LAYER" >/dev/null 2>&1 || true; fi

  if [ -n "$SWIPE" ]; then
    # shellcheck disable=SC2086
    set -- $SWIPE
    [ $# -eq 5 ] || { bad "MOBILE_FRAME_SWIPE 需要 5 个值：x1 y1 x2 y2 时长ms"; exit 1; }
    info "注入手势：($1,$2) → ($3,$4)，$5ms（adb input 是 120Hz 线性 MOVE 流，无真实手指速度曲线）"
    adbx shell input swipe "$1" "$2" "$3" "$4" "$5"
  else
    info "请在 ${WAIT}s 内于设备上完成一次拖拽（下滑关闭面板 / 全屏播放器下拉）…"
    sleep "$WAIT"
  fi

  info "抓取帧计时"
  adbx shell dumpsys gfxinfo "$PKG" framestats > "$FRAMESTATS" 2>/dev/null || true
  if [ -n "$LAYER" ]; then
    adbx shell dumpsys SurfaceFlinger --latency "$LAYER" > "$LATENCY" 2>/dev/null || true
  else
    : > "$LATENCY"
  fi
  ok "原始 dump：$RUN_DIR"
fi

# ---------- 解析 ----------
set +e
python3 - "$FRAMESTATS" "$LATENCY" "$LABEL" "$OUT_JSON" <<'PY'
import json, sys

SENTINEL = 9223372036854775807  # Long.MAX_VALUE：Android 用它在时间戳列里表示「无事件」

def valid(t):
    return t != 0 and t != SENTINEL and t > 0

def pct(xs, p):
    if not xs:
        return None
    idx = max(0, min(len(xs) - 1, -(-int(p * len(xs)) // 1) - 1))  # ceil(p*n)-1
    return xs[idx]

def parse_framestats(path):
    try:
        text = open(path, 'r', errors='replace').read()
    except OSError:
        return None
    lines = text.splitlines()
    try:
        start = next(i for i, l in enumerate(lines) if l.strip() == '---PROFILEDATA---')
    except StopIteration:
        return None
    if start + 1 >= len(lines):
        return None
    header = [c.strip() for c in lines[start + 1].split(',')]
    if 'IntendedVsync' not in header or 'FrameCompleted' not in header:
        return None
    iv_i, fc_i = header.index('IntendedVsync'), header.index('FrameCompleted')
    rows = []
    for l in lines[start + 2:]:
        if l.strip().startswith('---'):
            break
        cells = l.split(',')
        if len(cells) <= max(iv_i, fc_i):
            continue
        try:
            iv, fc = int(cells[iv_i]), int(cells[fc_i])
        except ValueError:
            continue
        if valid(iv) and valid(fc) and fc >= iv:
            rows.append((iv, fc))
    if not rows:
        return None
    frame_ms = sorted((fc - iv) / 1e6 for iv, fc in rows)
    ivs = [iv for iv, _ in rows]
    gaps = [(ivs[i + 1] - ivs[i]) / 1e6 for i in range(len(ivs) - 1)]
    return {
        'frames': len(rows),
        'spanMs': round((ivs[-1] - ivs[0]) / 1e6, 1),
        'fps': round(len(rows) / ((ivs[-1] - ivs[0]) / 1e9), 1) if ivs[-1] > ivs[0] else None,
        'frameMs_p50': round(pct(frame_ms, 0.5), 1),
        'frameMs_p90': round(pct(frame_ms, 0.9), 1),
        'frameMs_p99': round(pct(frame_ms, 0.99), 1),
        'frameMs_max': round(frame_ms[-1], 1),
        'maxGapMs': round(max(gaps), 1) if gaps else None,
        'windowFps': round(1000 / (sum(gaps) / len(gaps)), 1) if gaps else None,
    }

def parse_latency(path):
    try:
        lines = [l for l in open(path, 'r', errors='replace').read().splitlines() if l.strip()]
    except OSError:
        return None
    if len(lines) < 2:
        return None
    presents = []
    for l in lines[1:]:
        cells = l.split()
        if len(cells) < 3:
            continue
        try:
            # 三列 = 应用绘制时刻 / vsync / 上屏时刻：取上屏时刻（用户真正看到的那一下）
            t = int(cells[2])
        except ValueError:
            continue
        if valid(t):
            presents.append(t)
    if len(presents) < 2:
        return None
    gaps = [(presents[i + 1] - presents[i]) / 1e6 for i in range(len(presents) - 1)]
    span = (presents[-1] - presents[0]) / 1e6
    return {
        'frames': len(presents),
        'spanMs': round(span, 1),
        'fps': round(len(presents) / (span / 1000), 1) if span > 0 else None,
        'maxGapMs': round(max(gaps), 1),
    }

framestats_path, latency_path, label, out_json = sys.argv[1:5]
gfx = parse_framestats(framestats_path)
sf = parse_latency(latency_path)
report = {'label': label, 'gfxinfo': gfx, 'surfaceflinger': sf}

print()
print('===== 帧计时摘要（label=%s）=====' % label)
if gfx:
    print('  gfxinfo（应用侧逐帧，UI 线程管线）:')
    print('    帧数=%s 窗口=%sms 窗口帧率=%s  帧耗时 p50/p90/p99/max = %s / %s / %s / %s ms'
          % (gfx['frames'], gfx['spanMs'], gfx['fps'],
             gfx['frameMs_p50'], gfx['frameMs_p90'], gfx['frameMs_p99'], gfx['frameMs_max']))
    print('    最大帧间隔=%sms（平均间隔折算帧率=%s）' % (gfx['maxGapMs'], gfx['windowFps']))
else:
    print('  gfxinfo: 没解析出有效帧（release 上可能被系统丢弃；原始 dump 仍留档供人工看）')
if sf:
    print('  SurfaceFlinger（显示侧上屏，独立视角）:')
    print('    上屏帧数=%s 窗口=%sms 帧率=%s 最大间隔=%sms'
          % (sf['frames'], sf['spanMs'], sf['fps'], sf['maxGapMs']))
elif latency_path:
    print('  SurfaceFlinger: 无有效数据（未取层 / 该 Android 版本输出格式不同）')
print()
print('  读法（#430）：')
print('    · 帧数少 + 每帧都准时 —— 与「JS 卡住→面板冻住」一致，需回看 App 侧 [drag] 日志；')
print('    · 帧数正常 + 帧耗时长/最大间隔大 —— 渲染侧真有掉帧，与 JS 线程占用可能无关；')
print('    · 两者都要与 [drag] 行（样本/时长/p50/p95/max/超帧）合看才下判语。')

with open(out_json, 'w') as f:
    json.dump(report, f, ensure_ascii=False, indent=2)
print()
print('  机器可读：%s' % out_json)
sys.exit(0 if (gfx or sf) else 1)
PY
RC=$?
set -e
if [ "$RC" -ne 0 ]; then bad "没采到有效帧（原始 dump 已留档，可人工看格式差异）"; exit "$RC"; fi
ok "帧计时取证完成"
