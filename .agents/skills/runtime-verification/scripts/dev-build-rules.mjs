/**
 * runtime-verification / dev build 一条龙的纯判据（零 I/O、零副作用、不 process.exit）。
 *
 * 抽成独立模块的理由：下面每一条都是「实测踩过、跑真机才验得到」的判定，必须能被
 * `node --test` 直接 import 钉住（`./__tests__/dev-build.test.js`）。
 * runner（`./dev-build.mjs`）只负责按这些判据编排命令。
 *
 * 本次（#582 评审后）落在这里的判定，逐条对应评审缺陷：
 *   1. `spawnPlan()` —— Windows 上 `.bat`/`.cmd` 必须经 `cmd.exe /d /s /c`，否则
 *      Node ≥18.20/20.12/21.7 spawn 直接 `EINVAL`（本机 node v22.23.2 实测：
 *      no-shell → EINVAL；`shell:true` → 可用；`cmd.exe /d /s /c` → 可用）。
 *   2. `adbTimeoutMs()` / `classifySpawnFailure()` / `adbHangHint()` —— 每条 adb 调用都要有超时，
 *      卡死要按「两份 adb 抢 5037」给处置，而不是永远等下去。
 *   3. `checkPlan()` / `decidesExitCode()` —— 把「启动期」与「播放后」拆成两个相位：
 *      冷启动必然不成立的后三条**不许**决定退出码。
 *   4. `reverseListed()` / `reverseFailureHint()` —— reverse 没建成却打印 ✓ 是全链最贵的静默失败。
 *   5. `serviceBlock()` / `isServiceForeground()` —— FGS 判定必须落在**一个** ServiceRecord 块内。
 *   6. `shortPathWarning()` —— 告警的处置必须点名第二层坑（短路径杂牌检出 → 启动崩）。
 *   7. `identityAnchor()` / `parsePackageDump()` / `findSymbolInApk()` —— 身份锚：
 *      证明设备上跑的确实是这份产物。
 *   9. （`ROOT` 推导在 runner 里，那边一句注释点名耦合。）
 */
import zlib from 'node:zlib';

// ── 常量 ─────────────────────────────────────────────────────────

export const DEV_BUILD = {
  /** dev 变体的 applicationId 后缀（`android/app/build.gradle` 的 `applicationIdSuffix '.dev'`） */
  appId: 'com.mplayer.mobile.dev',
  /** 拉起必须用显式组件：scheme 与 release 共用，裸 `mplayer://` 会弹选择器 */
  launchComponent: 'com.mplayer.mobile.dev/com.mplayer.mobile.MainActivity',
  port: 8081,
  apkRelPath: ['app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk'],
  remoteTmp: '/data/local/tmp/mplayer-dev.apk',
  /** restorecon 失败时改推这里（SELinux 上下文还原在 /sdcard 上不撞） */
  remoteSd: '/sdcard/mplayer-dev.apk',
  buildTask: 'assembleDebug',
  /**
   * FGS 的真身：native-player 的 `PlayerService`。
   * 原脚本写的是 expo-audio 的 `AudioControlsService` —— 那个服务**已被移除**
   * （见 `packages/mobile/android/app/src/main/AndroidManifest.xml` 的 I3 注释：
   * 一个 app 只能有一个 MediaSessionService，播放会话改由 PlayerService 承载）。
   * 名字不改，这一条就算正在播歌也永远不 PASS。
   */
  fgsService: 'expo.modules.mplayerplayer.PlayerService',
  /**
   * 播放通知渠道 id。`services/notificationService.ts`：现用 `music-playback-native`，
   * 原 `music-playback`（IMPORTANCE_HIGH）已废弃。注意前者**包含**后者这个子串 ——
   * 所以只按子串匹配会连废弃渠道一起放过，这里用完整 id。
   */
  notificationChannel: 'music-playback-native',
};

/**
 * CMake 对象路径上限 250 字符。实测数据点：主克隆
 * `…\mplayer\packages\mobile\android`（43 字符）正常；`.claude\worktrees\<name>\packages\mobile\android`
 * （78 字符）必失败（`CMAKE_OBJECT_PATH_MAX` / `build.ninja still dirty after 100 tries`）。
 * 真阈值落在两者之间、未做二分实测 —— 所以只**告警**不拦。
 */
export const SHORT_PATH_WARN = 60;

/** 每条 adb 调用的默认超时。0 一律当「没给」（0 在 spawnSync 里是「不超时」，正是要修的那个坑）。 */
export const DEFAULT_ADB_TIMEOUT_MS = 30_000;
export const ADB_TIMEOUT_ENV = 'MOBILE_ADB_TIMEOUT_MS';
/** 拉起后等 JS bundle 起来的预算（冷启 Metro 首次打包可能要几十秒） */
export const DEFAULT_LAUNCH_TIMEOUT_MS = 90_000;
export const LAUNCH_TIMEOUT_ENV = 'MOBILE_LAUNCH_TIMEOUT_MS';
/** `--after-play` 阶段等「人去播一首」的预算 */
export const DEFAULT_POSTPLAY_TIMEOUT_MS = 120_000;
export const POSTPLAY_TIMEOUT_ENV = 'MOBILE_POSTPLAY_TIMEOUT_MS';
/** 设备时钟与 `lastUpdateTime`（秒级截断）之间允许的偏差 */
export const FRESH_INSTALL_TOLERANCE_MS = 5_000;

// ── 命令编排（纯） ────────────────────────────────────────────────

export function gradleExecutable(platform = process.platform) {
  return platform === 'win32' ? 'gradlew.bat' : './gradlew';
}

export function gradleArgs(task = DEV_BUILD.buildTask, abi = 'arm64-v8a') {
  return [task, `-PreactNativeArchitectures=${abi}`];
}

/** Windows 上只有批处理需要 shell；`.exe`（adb）不需要。 */
export function isBatchFile(file) {
  return /\.(bat|cmd)$/i.test(String(file ?? ''));
}

/** cmd 里有特殊含义或空白的参数要引起来；参数里带字面量 `"` 的情况本脚本不会出现（只有 abi 与 gradle flag）。 */
export function quoteForCmd(arg) {
  const s = String(arg);
  return /[\s&<>()@^|]/.test(s) ? `"${s}"` : s;
}

/**
 * 把一个命令编排成「可执行文件 + argv」，Windows 的 `.bat`/`.cmd` 走 `cmd.exe /d /s /c`。
 *
 * 返回 `{ command, args, verbatim }`：`verbatim: true` 表示调用方必须传
 * `windowsVerbatimArguments: true` —— 这一项不是可选的，见下面的实测记录。
 *
 * 本机（node v22.23.2 / win32）实测矩阵，`.bat` 只 echo `%*`：
 *   - 直接 spawn 不套 shell            → `EINVAL`（缺陷 1 的根因，脚本曾经**必然**失败）
 *   - `shell: true`                    → 可用，但把参数交给一层真的 shell 解析，不好控
 *   - `['/d','/s','/c', bat, ...args]` → 可用，但路径含空格时被 cmd 的引号规则拆开（实测失败）
 *   - 本函数（verbatim + 整体引号）    → 含空格路径也正确（实测 `ARGS=[assembleDebug -Pfoo=arm64-v8a]`）
 *
 * 为什么必须 verbatim：libuv 对 `cmd.exe` 有专门的引号转义（会把参数里的 `"` 变成 `\"`），
 * 手工拼的引号会被它改坏（实测 `'\"D:\…' is not recognized`）。verbatim 让它原样透传，
 * 引号规则由我们按 cmd 的 `/s` 语义自己负责：最外层一对引号，被 `/s` 剥掉后剩下
 * `"<带空格的路径>" args`，正好是 cmd 期望的形状。
 */
export function spawnPlan(file, args, platform = process.platform) {
  const argv = [...(args ?? [])].map(String);
  if (platform !== 'win32' || !isBatchFile(file)) {
    return { command: file, args: argv, verbatim: false };
  }
  const line = [file, ...argv].map(quoteForCmd).join(' ');
  return { command: 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`], verbatim: true };
}

// ── 超时 / 失败归因 ──────────────────────────────────────────────

/** 环境变量 → 毫秒。非法值/过大/0 一律回落到默认值（0 会被 spawnSync 当成「永不超时」）。 */
export function parseTimeoutMs(raw, fallback, { min = 1_000, max = 900_000 } = {}) {
  const n = Number.parseInt(String(raw ?? '').trim(), 10);
  if (!Number.isFinite(n) || n < min) return fallback;
  return Math.min(n, max);
}

export function adbTimeoutMs(raw) {
  return parseTimeoutMs(raw, DEFAULT_ADB_TIMEOUT_MS);
}

export function launchTimeoutMs(raw) {
  return parseTimeoutMs(raw, DEFAULT_LAUNCH_TIMEOUT_MS, { min: 5_000 });
}

export function postPlayTimeoutMs(raw) {
  return parseTimeoutMs(raw, DEFAULT_POSTPLAY_TIMEOUT_MS, { min: 10_000 });
}

/**
 * spawnSync 的结果 → 失败归因；正常结束（哪怕退出码非 0）返回 null。
 * `kind: 'timeout'` 是「命令卡死」，`kind: 'spawn'` 是「命令根本没起来」（EINVAL/ENOENT…）。
 * 原脚本把两者都压成 `status: -1`，于是「起不来」被念成「gradle 出包失败」，用户照着短路径告警
 * 换检出 —— 修错了方向（缺陷 1 的次生伤害）。
 */
export function classifySpawnFailure(res) {
  const err = res?.error;
  if (!err) return null;
  const code = err.code ?? '';
  const message = String(err.message ?? err);
  if (code === 'ETIMEDOUT' || res.signal === 'SIGTERM') return { kind: 'timeout', code: code || 'ETIMEDOUT', message };
  return { kind: 'spawn', code, message };
}

/** adb 卡死时的处置文案（缺陷 2）。本机最常见的成因是「两份 adb 抢 5037」。 */
export function adbHangHint(timeoutMs = DEFAULT_ADB_TIMEOUT_MS, port = DEV_BUILD.port) {
  return `adb 命令 ${timeoutMs}ms 没返回，已放弃等待。`
    + `\n本机最常见的成因：**两份 adb 抢 5037**（雷电/SDK 自带一份，scoop/PATH 上一份），两个 server 互踢，`
    + `每个 adb 调用都会挂住 —— 表现为「脚本卡死」而不是报错。`
    + `\n处置（PowerShell，按序做）：`
    + `\n  1) 看谁占着 5037：Get-NetTCPConnection -LocalPort 5037 -State Listen | Select-Object OwningProcess`
    + `\n  2) 按 pid 认它是哪一份：Get-Process -Id <pid> | Select-Object Path`
    + `\n  3) 只留一份：把另一份 adb.exe 改名/移走，或钉死用哪份（设 MOBILE_ADB=<path>），再 adb kill-server; adb start-server`
    + `\n  4) **重建 reverse**：adb -s <serial> reverse tcp:${port} tcp:${port}`
    + `\n     ↑ server 重启后 reverse 列表会清空，不重建就是静默断流（应用照常启动，只是拉不到 bundle）。`;
}

// ── 设备 / 安装 ──────────────────────────────────────────────────

/** `adb shell getprop ro.product.cpu.abi` 的输出 → 合法 abi / null。
 *  合法 abi 含连字符（`arm64-v8a` / `armeabi-v7a`），也含下划线（`x86_64`）。 */
export function parseAbi(output) {
  const value = String(output ?? '').trim().split(/\r?\n/).pop()?.trim() ?? '';
  return /^[a-z0-9_-]+$/i.test(value) ? value : null;
}

/** pm install 的失败输出是否属于「换 /sdcard/ 重试」那一类 */
export function needsSdcardFallback(output) {
  return /restorecon|INSTALL_FAILED_MEDIA_UNAVAILABLE/i.test(String(output ?? ''));
}

/** dev-client 深链：`url=` 必须整体百分号编码 */
export function devClientUri(port = DEV_BUILD.port) {
  return `mplayer://expo-development-client/?url=${encodeURIComponent(`http://localhost:${port}`)}`;
}

/** android 目录过长时的告警文案；正常返回 null */
export function shortPathWarning(androidDir) {
  const dir = String(androidDir ?? '');
  if (dir.length <= SHORT_PATH_WARN) return null;
  return `android 目录路径 ${dir.length} 字符（> ${SHORT_PATH_WARN}）：CMake 对象路径可能超 Windows 250 上限`
    + `，构建会报 CMAKE_OBJECT_PATH_MAX / build.ninja still dirty。`
    + `\n  处置分两层，只做第一层会掉进第二层：`
    + `\n  ① 先换短路径检出（如 D:\\npw）—— 但**别**换成一个杂牌短路径检出后再出包：`
    + `\n     短路径检出里 autolinking 扫不到 native-player / splashscreen 这类模块，出出来的 APK`
    + `\n     启动即崩「ClassNotFoundException: expo.modules.splashscreen」（构建日志一切正常）。`
    + `\n  ② 正解是**在主克隆里建临时分支构建**：原生目录与 node_modules 都齐，路径也短。`
    + `\n     即「git -C <主克隆> switch -c tmp/dev-build」→ 出包 → 装 → 「switch」回原分支。`;
}

// ── 身份锚（缺陷 7） ─────────────────────────────────────────────

/**
 * `dumpsys package <pkg>` → `{ installed, lastUpdateTime, lastUpdateTimeMs, versionName }`。
 * 取**第一条**匹配：Package 段的 `lastUpdateTime` 在 User 段之前。
 */
export function parsePackageDump(output) {
  const text = String(output ?? '');
  const empty = { installed: false, lastUpdateTime: null, lastUpdateTimeMs: null, versionName: null };
  if (!text.trim() || /Unable to find package/i.test(text)) return empty;
  const last = /lastUpdateTime=([^\r\n]+)/.exec(text);
  const ver = /versionName=([^\s\r\n]+)/.exec(text);
  return {
    installed: true,
    lastUpdateTime: last ? last[1].trim() : null,
    lastUpdateTimeMs: last ? parseAndroidTime(last[1]) : null,
    versionName: ver ? ver[1].trim() : null,
  };
}

/** `2026-10-06 01:23:45`（设备本地时间，无时区）→ 毫秒。只在**设备时钟域**里比较，不和宿主机时钟混。 */
export function parseAndroidTime(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(text ?? '').trim());
  if (!m) return null;
  const [y, mo, d, h, mi, se] = m.slice(1).map(Number);
  const ms = new Date(y, mo - 1, d, h, mi, se).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** `adb shell date +%s` → 毫秒（设备时钟，秒级）。 */
export function deviceClockMs(output) {
  const m = /(\d{9,})/.exec(String(output ?? ''));
  return m ? Number(m[1]) * 1000 : null;
}

/**
 * 安装新鲜度：`lastUpdateTime` 不早于「安装前读到的设备时间」。
 *
 * 为什么不和宿主机的 buildStart 比：两边时钟不同域（设备时钟可能偏几分钟），
 * 直接比会得到一个既不真也不假的结论。所以基线取**设备自己**在 push 之前读的时间，
 * 只回答一个问题：「这个包是本次安装装上去的吗」。
 */
export function isFreshInstall({ lastUpdateTimeMs, deviceTimeBeforeMs, toleranceMs = FRESH_INSTALL_TOLERANCE_MS } = {}) {
  if (!Number.isFinite(lastUpdateTimeMs) || !Number.isFinite(deviceTimeBeforeMs)) return false;
  return lastUpdateTimeMs >= deviceTimeBeforeMs - toleranceMs;
}

/** 身份锚结论：`{ ok, detail, versionName, lastUpdateTime }`。 */
export function identityAnchor({ packageDump, deviceTimeBeforeMs, toleranceMs = FRESH_INSTALL_TOLERANCE_MS } = {}) {
  const info = packageDump ?? { installed: false };
  const shown = `${DEV_BUILD.appId} versionName=${info.versionName ?? '?'} lastUpdateTime=${info.lastUpdateTime ?? '?'}`;
  if (!info.installed) {
    return { ok: false, detail: `设备上没有 ${DEV_BUILD.appId}（装的可能是 release 包或 Expo Go）`, versionName: null, lastUpdateTimeMs: null };
  }
  if (!Number.isFinite(info.lastUpdateTimeMs)) {
    return { ok: false, detail: `读不到 lastUpdateTime（${shown}）—— 无法证明这是本次装上去的包`, versionName: info.versionName ?? null, lastUpdateTimeMs: null };
  }
  if (!Number.isFinite(deviceTimeBeforeMs)) {
    return {
      ok: false,
      detail: `读不到设备时钟，无法判定 ${shown} 是不是本次装上去的（时间戳这条锚立不起来）`,
      versionName: info.versionName ?? null,
      lastUpdateTimeMs: info.lastUpdateTimeMs,
    };
  }
  if (!isFreshInstall({ lastUpdateTimeMs: info.lastUpdateTimeMs, deviceTimeBeforeMs, toleranceMs })) {
    return {
      ok: false,
      detail: `设备上这份 .dev 包的 lastUpdateTime（${info.lastUpdateTime}）早于本次安装前读到的设备时间`
        + `（${new Date(deviceTimeBeforeMs).toISOString()}）`
        + ` —— 设备上跑的是旧包，后面的结论一律作废`,
      versionName: info.versionName ?? null,
      lastUpdateTimeMs: info.lastUpdateTimeMs,
    };
  }
  return { ok: true, detail: `本次装的包：${shown}`, versionName: info.versionName ?? null, lastUpdateTimeMs: info.lastUpdateTimeMs };
}

/** `adb shell pm path <pkg>` → `{ apk, all }`（多 split 时取 base.apk）。 */
export function parsePackagePath(output) {
  const all = String(output ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('package:'))
    .map((l) => l.slice('package:'.length).trim())
    .filter(Boolean);
  return { apk: all.find((p) => /(^|\/)base\.apk$/.test(p)) ?? all[0] ?? null, all };
}

// ── logcat / 进程 ────────────────────────────────────────────────

/** 启动期 logcat 判据：`Running "main"` 出现、且没有 `undefined is not a function`。 */
export function logcatVerdict(text) {
  const t = String(text ?? '');
  const runningMain = /Running "main"/.test(t);
  const undefinedCall = /undefined is not a function/.test(t);
  if (undefinedCall) {
    return {
      ok: false, runningMain, undefinedCall,
      reason: 'logcat 出现 `undefined is not a function`：JS 侧拿到的是旧 chunk / 新导出没被 Metro 认到'
        + '（见 SKILL.md 陷阱速查 #576）。处置：npx expo start --clear 重起 Metro，再冷启一次。',
    };
  }
  if (!runningMain) {
    return {
      ok: false, runningMain, undefinedCall,
      reason: 'logcat 里没有 `Running "main"`：JS bundle 没起来 —— Metro 没连上 / reverse 没通 / 应用在启动期就崩了。',
    };
  }
  return { ok: true, runningMain, undefinedCall, reason: '' };
}

/** `pidof` 结论。`unknown` = 工具不可用/输出无法判读 —— 那是**观测不到**，不是「进程死了」。 */
export function processAliveVerdict({ stdout = '', stderr = '', status = 0 } = {}) {
  const out = String(stdout ?? '');
  const err = String(stderr ?? '');
  if (/\b\d{2,}\b/.test(out)) return 'alive';
  if (status !== 0 || /not found|inaccessible|unknown command|usage:/i.test(out + err)) return 'unknown';
  return 'dead';
}

// ── 自检相位（缺陷 3 / 5） ───────────────────────────────────────

/**
 * FGS 判定必须**限定在一个 ServiceRecord 块内**。
 * 原实现拿 `/AudioControlsService[\s\S]*isForeground=true/` 扫整份 `dumpsys activity services`，
 * 只要 AudioControlsService 出现在**任何**一个前台服务之前就算 PASS —— 假 PASS 比漏判更坏。
 */
export function serviceBlock(output, serviceName) {
  const name = String(serviceName ?? '');
  const lines = String(output ?? '').split(/\r?\n/);
  const blocks = [];
  let cur = null;
  for (const line of lines) {
    if (/^\s*ServiceRecord\{/.test(line)) {
      if (cur) blocks.push(cur);
      cur = [line];
    } else if (cur) {
      cur.push(line);
    }
  }
  if (cur) blocks.push(cur);
  if (!blocks.length) return null;
  const inHeader = blocks.find((b) => b[0].includes(name));
  if (inHeader) return inHeader.join('\n');
  /** 头行换行/被截断时的兜底：仍在**单个块**内找，不跨块。 */
  const anywhere = blocks.find((b) => b.some((l) => l.includes(name)));
  return anywhere ? anywhere.join('\n') : null;
}

export function isServiceForeground(output, serviceName = DEV_BUILD.fgsService) {
  const block = serviceBlock(output, serviceName);
  return block ? /isForeground\s*=\s*true/.test(block) : false;
}

export function reverseListed(output, port = DEV_BUILD.port) {
  return new RegExp(`tcp:${port}\\s+tcp:${port}`).test(String(output ?? ''));
}

export function reverseFailureHint(port = DEV_BUILD.port) {
  return `adb reverse tcp:${port} 没建成（或建成但没出现在 reverse --list 里）。`
    + `\n这是全链最贵的静默失败：应用照常启动、logcat 干净，只是拉不到 bundle，看起来像「JS 没执行」。`
    + `\n处置（按序）：`
    + `\n  1) 双 transport 检测：adb devices -l —— 若同一个设备同时有 <serial> 与 <serial>:<port> 两条`
    + `\n     （WSL/usbipd 一份 + Windows 原生 adb 一份），reverse 会绑到另一条 transport 上；`
    + `\n  2) 丢掉多余那条：adb disconnect <ip:port>，或 adb -s <serial> reverse --remove-all；`
    + `\n  3) 只启一份 adb server（见「5037 被抢」的处置），再重建：`
    + `\n     adb -s <serial> reverse tcp:${port} tcp:${port} && adb -s <serial> reverse --list`;
}

/**
 * 自检分相位。三组：
 *   - `launch`       启动期成立与否**决定退出码**（装上了 + 起得来）；
 *   - `advisory`     启动期的观测，但工具可能不可用（`pidof`）→ 只提示，不判死；
 *   - `postPlayback` FGS / media3 会话 / 播放通知 —— **结构上要求正在播放**，
 *                    冷启动必然不成立，所以默认不计入退出码，只有显式 `--after-play` 才计。
 *
 * 为什么不是「默认跑一遍但不计退出码」：那会在每次冷跑末尾刷三条「未命中」，
 * 把「假失败」换成「三条噪音」，人照样学会忽略。默认就**不跑**，只在结尾提示怎么验。
 */
export function checkPlan() {
  return {
    launch: [
      { id: 'pkg-fresh', phase: 'launch', kind: 'identity', label: '身份锚：.dev 包已装且是本次产物' },
      { id: 'logcat-main', phase: 'launch', kind: 'logcat', label: 'logcat：Running "main" 且无 undefined is not a function' },
    ],
    advisory: [
      { id: 'process-alive', phase: 'advisory', kind: 'pidof', label: '进程在跑（pidof，观测不到不算失败）' },
    ],
    postPlayback: [
      {
        id: 'fgs', phase: 'post-playback', kind: 'service-foreground', label: 'FGS 前台服务',
        service: DEV_BUILD.fgsService, args: ['shell', 'dumpsys', 'activity', 'services', DEV_BUILD.appId],
      },
      {
        id: 'media-session', phase: 'post-playback', kind: 'regex', label: 'media3 媒体会话',
        pattern: /Media button session is com\.mplayer\.mobile\.dev/,
        args: ['shell', 'dumpsys', 'media_session'],
      },
      {
        id: 'notification', phase: 'post-playback', kind: 'regex', label: '播放通知',
        pattern: new RegExp(DEV_BUILD.notificationChannel),
        args: ['shell', 'dumpsys', 'notification', '--noredact'],
      },
    ],
  };
}

/** 这条自检是否决定退出码。后三项目**只在** `--after-play` 下才计（缺陷 3 的不变量）。 */
export function decidesExitCode(check, { afterPlay = false } = {}) {
  if (check?.phase === 'launch') return true;
  if (check?.phase === 'post-playback') return afterPlay === true;
  return false;
}

// ── APK 内符号（`--dex`，缺陷 7） ────────────────────────────────

const ZIP_EOCD_SIG = 0x06054b50;
const ZIP_CD_SIG = 0x02014b50;

/** 读 zip 目录（APK 就是 zip）。结构不符 / zip64 一律返回已读到的部分，不抛。 */
export function readZipEntries(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer ?? []);
  const eocd = findEocd(buf);
  if (eocd < 0) return [];
  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff) return []; // zip64：不猜，交给上层报「读不出」
  const entries = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== ZIP_CD_SIG) return entries;
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const lfhOffset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    entries.push(readEntry(buf, { name, method, compressedSize, lfhOffset }));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function findEocd(buf) {
  const min = Math.max(0, buf.length - 66_000); // 注释最长 65535
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === ZIP_EOCD_SIG) return i;
  }
  return -1;
}

function readEntry(buf, { name, method, compressedSize, lfhOffset }) {
  if (lfhOffset + 30 > buf.length) return { name, method, error: 'local header 越界' };
  const nameLen = buf.readUInt16LE(lfhOffset + 26);
  const extraLen = buf.readUInt16LE(lfhOffset + 28);
  const start = lfhOffset + 30 + nameLen + extraLen;
  if (start + compressedSize > buf.length) return { name, method, error: 'compressed data 越界' };
  const raw = buf.subarray(start, start + compressedSize);
  if (method === 0) return { name, method, bytes: raw };
  if (method === 8) {
    try {
      return { name, method, bytes: zlib.inflateRawSync(raw) };
    } catch (err) {
      return { name, method, error: String(err?.message ?? err) };
    }
  }
  return { name, method, error: `不支持的压缩方式 ${method}` };
}

/**
 * 在 APK 的条目里找符号（`--dex`）。
 *
 * 为什么不是直接搜 APK 字节：dex 与 `assets/index.android.bundle` 在 APK 里通常是 deflate 压缩的，
 * 裸搜必漏。这里先解压再搜，零依赖（只用 node:zlib）。
 * 注意：dev build 的 JS bundle 由 Metro 提供、不打进 APK，所以 `--dex` 对 JS 侧符号多半无效 ——
 * 它瞄的是 Kotlin/Java/原生符号（dex 的字符串表里就是明文）。
 */
export function findSymbolInApk(buffer, symbol, { maxEntryBytes = 64 * 1024 * 1024 } = {}) {
  const text = String(symbol ?? '').trim();
  const empty = { found: null, hits: [], scanned: 0, skipped: [], reason: '' };
  if (!text) return { ...empty, reason: '符号为空' };
  const entries = readZipEntries(buffer);
  if (!entries.length) return { ...empty, reason: '读不出 APK 的 zip 目录（不是 zip / zip64 / 文件被截断）' };
  const needle = Buffer.from(text, 'utf8');
  const hits = [];
  const skipped = [];
  let scanned = 0;
  for (const e of entries) {
    if (!e.bytes) { skipped.push(e.name); continue; }
    if (e.bytes.length > maxEntryBytes) { skipped.push(e.name); continue; }
    scanned++;
    if (e.bytes.includes(needle)) hits.push(e.name);
  }
  return { found: hits.length > 0, hits, scanned, skipped, reason: '' };
}
