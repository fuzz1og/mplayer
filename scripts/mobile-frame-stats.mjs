#!/usr/bin/env node
/**
 * 为什么不能靠 perfMonitor：它量的是 JS 线程 rAF 帧率，且要求连续 2 个 2s 窗口低于 30fps 才上报——
 * 一次一两秒的拖拽在它眼皮底下结构性不可见（「零 warn」什么也证明不了）。
 * 故本脚本的输出**不能单独定罪**，必须与 [drag] 日志合看。
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 仓库根取脚本自身位置，不用 git rev-parse：worktree 的 .git 是指向主克隆的绝对路径文件，
// 在 WSL 里解析 Windows 路径会 fatal: not a git repository，而本脚本正要在 worktree 里跑。
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let SERIAL = process.env.MOBILE_FRAME_SERIAL ?? '';
const PKG = process.env.MOBILE_FRAME_PKG ?? 'com.mplayer.mobile';
const LABEL = process.env.MOBILE_FRAME_LABEL ?? 'run';
const SWIPE = process.env.MOBILE_FRAME_SWIPE ?? '';
const WAIT = process.env.MOBILE_FRAME_WAIT ?? '6';
let LAYER = process.env.MOBILE_FRAME_LAYER ?? '';
const PARSE_DIR = process.env.MOBILE_FRAME_PARSE_DIR ?? '';
const ART = path.join(REPO, 'e2e', 'artifacts');

const ESC = String.fromCharCode(27);
const C = { info: ESC + '[1;36m', ok: ESC + '[32m', warn: ESC + '[33m', bad: ESC + '[31m', off: ESC + '[0m' };
const info = (msg) => console.log(C.info + '▶ ' + msg + C.off);
const ok = (msg) => console.log(C.ok + '  ✓ ' + msg + C.off);
const warn = (msg) => console.log(C.warn + '  ! ' + msg + C.off);
const bad = (msg) => console.log(C.bad + '  ✗ ' + msg + C.off);

/** adb（带 -s SERIAL 与否）。quiet 丢弃输出；tolerate 失败不中止。 */
function adb(args, options) {
  const opts = options ?? {};
  const res = spawnSync('adb', args, { stdio: opts.quiet ? 'ignore' : 'inherit' });
  if (res.error) { bad('找不到 adb'); process.exit(1); }
  return { status: res.status ?? 1, stdout: opts.quiet ? '' : '' };
}

/** 需要 stdout 的 adb 调用（quiet 模式 + 捕获） */
function adbCapture(args) {
  const res = spawnSync('adb', args, { encoding: 'utf8' });
  if (res.error) { bad('找不到 adb'); process.exit(1); }
  return { status: res.status ?? 1, stdout: res.stdout ?? '' };
}

const adbxCapture = (args) => adbCapture(SERIAL ? ['-s', SERIAL].concat(args) : args);

function stamp() {
  const d = new Date();
  const z = (n) => String(n).padStart(2, '0');
  return String(d.getFullYear()) + z(d.getMonth() + 1) + z(d.getDate()) + '-' + z(d.getHours()) + z(d.getMinutes()) + z(d.getSeconds());
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 解析（原 Python heredoc 的逐行移植） ----------

const SENTINEL = 9223372036854775807n; // Long.MAX_VALUE：Android 用它在时间戳列里表示「无事件」

const valid = (t) => t !== 0n && t !== SENTINEL && t > 0n;

/** 等价 Python round(x, 1)：银行家舍入（.5 取偶），否则边界上会与 Math.round 分叉 */
function round1(x) {
  const scaled = x * 10;
  const floor = Math.floor(scaled);
  const diff = scaled - floor;
  let r;
  if (diff > 0.5) r = floor + 1;
  else if (diff < 0.5) r = floor;
  else r = floor % 2 === 0 ? floor : floor + 1;
  return r / 10;
}

/** Python 侧 str(round(x, 1)) 的等价打印：恒 1 位小数；None → None */
const pyFloat = (x) => (x === null || x === undefined ? 'None' : x.toFixed(1));

/**
 * Python pct(xs, p)（xs 已升序）。
 * 两者在 p*n 非整数时分叉：n=48、p=0.9 → 42（ceil 会给 43）、p=0.99 → 46（ceil 给 47）。
 * 照着注释写会让 p90/p99 与历史产物不一致（对拍实测：61.2/64.9 vs 62.4/70）。
 */
function pct(xs, p) {
  if (xs.length === 0) return null;
  const idx = Math.max(0, Math.min(xs.length - 1, Math.trunc(p * xs.length) - 1));
  return xs[idx];
}

function parseFramestats(file) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { return null; }
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === '---PROFILEDATA---');
  if (start < 0) return null;
  if (start + 1 >= lines.length) return null;
  const header = lines[start + 1].split(',').map((c) => c.trim());
  if (!header.includes('IntendedVsync') || !header.includes('FrameCompleted')) return null;
  const ivI = header.indexOf('IntendedVsync');
  const fcI = header.indexOf('FrameCompleted');
  const rows = [];
  for (const line of lines.slice(start + 2)) {
    if (line.trim().startsWith('---')) break;
    const cells = line.split(',');
    if (cells.length <= Math.max(ivI, fcI)) continue;
    let iv;
    let fc;
    try { iv = BigInt(cells[ivI].trim()); fc = BigInt(cells[fcI].trim()); } catch { continue; }
    if (valid(iv) && valid(fc) && fc >= iv) rows.push([iv, fc]);
  }
  if (rows.length === 0) return null;
  const frameMs = rows.map((r) => Number(r[1] - r[0]) / 1e6).sort((a, b) => a - b);
  const ivs = rows.map((r) => r[0]);
  const gaps = [];
  for (let i = 0; i + 1 < ivs.length; i++) gaps.push(Number(ivs[i + 1] - ivs[i]) / 1e6);
  const spanNs = Number(ivs[ivs.length - 1] - ivs[0]);
  const sum = gaps.reduce((a, b) => a + b, 0);
  return {
    frames: rows.length,
    spanMs: round1(spanNs / 1e6),
    fps: spanNs > 0 ? round1(rows.length / (spanNs / 1e9)) : null,
    frameMs_p50: round1(pct(frameMs, 0.5)),
    frameMs_p90: round1(pct(frameMs, 0.9)),
    frameMs_p99: round1(pct(frameMs, 0.99)),
    frameMs_max: round1(frameMs[frameMs.length - 1]),
    maxGapMs: gaps.length > 0 ? round1(Math.max.apply(null, gaps)) : null,
    windowFps: gaps.length > 0 ? round1(1000 / (sum / gaps.length)) : null,
  };
}

function parseLatency(file) {
  let lines;
  try { lines = readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l.trim() !== ''); } catch { return null; }
  if (lines.length < 2) return null;
  const presents = [];
  for (const line of lines.slice(1)) {
    const cells = line.trim().split(/\s+/);
    if (cells.length < 3) continue;
    let t;
    try { t = BigInt(cells[2]); } catch { continue; }
    if (valid(t)) presents.push(t);
  }
  if (presents.length < 2) return null;
  const gaps = [];
  for (let i = 0; i + 1 < presents.length; i++) gaps.push(Number(presents[i + 1] - presents[i]) / 1e6);
  const span = Number(presents[presents.length - 1] - presents[0]) / 1e6;
  return {
    frames: presents.length,
    spanMs: round1(span),
    fps: span > 0 ? round1(presents.length / (span / 1000)) : null,
    maxGapMs: round1(Math.max.apply(null, gaps)),
  };
}

// ---------- 采集 / 复算 ----------

let FRAMESTATS;
let LATENCY;
let OUT_JSON;

if (PARSE_DIR) {
  // 复算模式：不连设备，解析已有 dump
  FRAMESTATS = path.join(PARSE_DIR, 'gfxinfo-framestats.txt');
  LATENCY = path.join(PARSE_DIR, 'surfaceflinger-latency.txt');
  if (!existsSync(FRAMESTATS)) { bad('复算目录缺少 ' + FRAMESTATS); process.exit(1); }
  OUT_JSON = path.join(PARSE_DIR, 'frame-stats.json');
  info('复算已有 dump：' + PARSE_DIR);
} else {
  // 采集模式
  if (spawnSync('adb', ['version'], { stdio: 'ignore' }).error) { bad('找不到 adb'); process.exit(1); }
  if (!SERIAL) {
    const out = adbCapture(['devices']).stdout;
    const first = out.split(/\r?\n/).slice(1).map((l) => l.trim().split(/\s+/)).find((c) => c[1] === 'device');
    SERIAL = first ? first[0] : '';
    if (!SERIAL) { bad('没有在位设备（adb devices 空）'); process.exit(1); }
  }
  if (adbxCapture(['get-state']).status !== 0) { bad('设备 ' + SERIAL + ' 不在位'); process.exit(1); }
  if (!adbxCapture(['shell', 'pm', 'list', 'packages']).stdout.includes('package:' + PKG)) {
    bad('设备上没装 ' + PKG + '（MOBILE_FRAME_PKG 可覆盖；dev 变体是 com.mplayer.mobile.dev）');
    process.exit(1);
  }
  if (!LAYER) {
    const list = adbxCapture(['shell', 'dumpsys', 'SurfaceFlinger', '--list']).stdout;
    const hit = list.split(/\r?\n/).map((l) => l.replace(/\r/g, '')).find((l) => l.includes(PKG));
    LAYER = hit === undefined ? '' : hit;
  }
  if (!LAYER) warn('没找到 SurfaceFlinger 层（SurfaceFlinger 交叉校验将被跳过）');

  const runDir = path.join(ART, 'frame-' + LABEL + '-' + stamp());
  mkdirSync(runDir, { recursive: true });
  FRAMESTATS = path.join(runDir, 'gfxinfo-framestats.txt');
  LATENCY = path.join(runDir, 'surfaceflinger-latency.txt');
  OUT_JSON = path.join(runDir, 'frame-stats.json');

  info('清空统计窗口（gfxinfo reset + SurfaceFlinger --latency-clear）');
  if (adbxCapture(['shell', 'dumpsys', 'gfxinfo', PKG, 'reset']).status !== 0) warn('gfxinfo reset 失败（继续）');
  if (LAYER) adbxCapture(['shell', 'dumpsys', 'SurfaceFlinger', '--latency-clear', LAYER]);

  if (SWIPE) {
    const parts = SWIPE.trim().split(/\s+/);
    if (parts.length !== 5) { bad('MOBILE_FRAME_SWIPE 需要 5 个值：x1 y1 x2 y2 时长ms'); process.exit(1); }
    info('注入手势：(' + parts[0] + ',' + parts[1] + ') → (' + parts[2] + ',' + parts[3] + ')，' + parts[4] + 'ms（adb input 是 120Hz 线性 MOVE 流，无真实手指速度曲线）');
    adb(['shell', 'input', 'swipe'].concat(parts));
  } else {
    info('请在 ' + WAIT + 's 内于设备上完成一次拖拽（下滑关闭面板 / 全屏播放器下拉）…');
    await sleep(Number(WAIT) * 1000);
  }

  info('抓取帧计时');
  writeFileSync(FRAMESTATS, adbxCapture(['shell', 'dumpsys', 'gfxinfo', PKG, 'framestats']).stdout);
  writeFileSync(LATENCY, LAYER ? adbxCapture(['shell', 'dumpsys', 'SurfaceFlinger', '--latency', LAYER]).stdout : '');
  ok('原始 dump：' + runDir);
}

// ---------- 汇总 ----------

const gfx = parseFramestats(FRAMESTATS);
const sf = parseLatency(LATENCY);
const report = { label: LABEL, gfxinfo: gfx, surfaceflinger: sf };

console.log('');
console.log('===== 帧计时摘要（label=' + LABEL + '）=====');
if (gfx) {
  console.log('  gfxinfo（应用侧逐帧，UI 线程管线）:');
  console.log('    帧数=' + gfx.frames + ' 窗口=' + pyFloat(gfx.spanMs) + 'ms 窗口帧率=' + pyFloat(gfx.fps) + '  帧耗时 p50/p90/p99/max = ' + pyFloat(gfx.frameMs_p50) + ' / ' + pyFloat(gfx.frameMs_p90) + ' / ' + pyFloat(gfx.frameMs_p99) + ' / ' + pyFloat(gfx.frameMs_max) + ' ms');
  console.log('    最大帧间隔=' + pyFloat(gfx.maxGapMs) + 'ms（平均间隔折算帧率=' + pyFloat(gfx.windowFps) + '）');
} else {
  console.log('  gfxinfo: 没解析出有效帧（release 上可能被系统丢弃；原始 dump 仍留档供人工看）');
}
if (sf) {
  console.log('  SurfaceFlinger（显示侧上屏，独立视角）:');
  console.log('    上屏帧数=' + sf.frames + ' 窗口=' + pyFloat(sf.spanMs) + 'ms 帧率=' + pyFloat(sf.fps) + ' 最大间隔=' + pyFloat(sf.maxGapMs) + 'ms');
} else if (LATENCY) {
  console.log('  SurfaceFlinger: 无有效数据（未取层 / 该 Android 版本输出格式不同）');
}
console.log('');
console.log('  读法（#430）：');
console.log('    · 帧数少 + 每帧都准时 —— 与「JS 卡住→面板冻住」一致，需回看 App 侧 [drag] 日志；');
console.log('    · 帧数正常 + 帧耗时长/最大间隔大 —— 渲染侧真有掉帧，与 JS 线程占用可能无关；');
console.log('    · 两者都要与 [drag] 行（样本/时长/p50/p95/max/超帧）合看才下判语。');
writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));
console.log('');
console.log('  机器可读：' + OUT_JSON);
const rc = gfx || sf ? 0 : 1;
if (rc !== 0) bad('没采到有效帧（原始 dump 已留档，可人工看格式差异）');
else ok('帧计时取证完成');
process.exit(rc);
