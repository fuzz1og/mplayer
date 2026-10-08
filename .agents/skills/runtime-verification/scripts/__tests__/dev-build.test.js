/**
 * `scripts/dev-build-rules.mjs` 的判据测试（由 #582 评审后的 `mobile-dev-build` 迁移而来）。
 *
 * 用 node:test 跑（`node --test .agents/skills/runtime-verification/scripts/__tests__/dev-build.test.js`），
 * **零依赖、不碰 adb / gradle / 设备**：这里钉的是「实测踩过的坑」对应的判定 ——
 * 那些只有跑真机才验得到，所以必须能被单测钉住。
 *
 * 本轮新增的钉子，逐条对应评审缺陷：
 *   1. `spawnPlan`：Windows 的 `.bat`/`.cmd` → `cmd.exe /d /s /c`（无 shell 直 spawn 在
 *      node ≥18.20 是 `EINVAL`，脚本曾经**必然**失败）；POSIX 直 spawn。
 *   2. `adbTimeoutMs` 的默认值/可配/非法值回落；`classifySpawnFailure` 区分「卡死」与「起不来」。
 *   3. `checkPlan` / `decidesExitCode`：冷启动必然不成立的后三项目**不许**决定退出码。
 *   4. `reverseListed`，5. `serviceBlock` / `isServiceForeground`（跨服务假 PASS），
 *   6. `shortPathWarning` 的第二层坑，7. 身份锚（时间戳 + 符号扫描）。
 *
 * **未覆盖**：真机出包、`pm install` 实际行为、dumpsys 现场命中、`cmd.exe` 的真实退出 ——
 * 那些要设备 + 真构建，接上设备跑 `../dev-build.mjs` 验（`--dry-run` 可先看计划）。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const path = require('node:path');

const rulesPromise = import('../dev-build-rules.mjs');

// ── 构造一个最小可用的 zip（APK 就是 zip）：一条 store、一条 deflate ──
function makeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const data = Buffer.from(e.data, 'utf8');
    const raw = e.store ? data : zlib.deflateRawSync(data);
    const method = e.store ? 0 : 8;

    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt16LE(method, 8);
    lfh.writeUInt32LE(raw.length, 18);
    lfh.writeUInt32LE(data.length, 22);
    lfh.writeUInt16LE(name.length, 26);

    const local = Buffer.concat([lfh, name, raw]);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt32LE(raw.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(offset, 42);

    centrals.push(Buffer.concat([cd, name]));
    locals.push(local);
    offset += local.length;
  }
  const cdBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cdBuf, eocd]);
}

// ── 原有 6 条（签名未变，只按新文案调整第 5 条的断言） ──────────────

test('gradleExecutable：Windows 用 .bat，其余用 ./gradlew', async () => {
  const { gradleExecutable } = await rulesPromise;
  assert.equal(gradleExecutable('win32'), 'gradlew.bat');
  assert.equal(gradleExecutable('linux'), './gradlew');
  assert.equal(gradleExecutable('darwin'), './gradlew');
});

test('parseAbi：取最后一行、只认合法 abi、异常输入返回 null', async () => {
  const { parseAbi } = await rulesPromise;
  assert.equal(parseAbi('arm64-v8a\n'), 'arm64-v8a');
  assert.equal(parseAbi('* daemon not running; starting now *\narm64-v8a\n'), 'arm64-v8a');
  assert.equal(parseAbi('x86_64'), 'x86_64');
  assert.equal(parseAbi(''), null);
  assert.equal(parseAbi(undefined), null);
  assert.equal(parseAbi('error: device offline'), null);
  assert.equal(parseAbi('arm64 v8a'), null);
});

test('needsSdcardFallback：只认 restorecon 族失败（坑 3）', async () => {
  const { needsSdcardFallback } = await rulesPromise;
  assert.equal(needsSdcardFallback('Failure [INSTALL_FAILED_MEDIA_UNAVAILABLE: Failed to restorecon]'), true);
  assert.equal(needsSdcardFallback('Failure [INSTALL_FAILED_NO_MATCHING_ABIS]'), false);
  assert.equal(needsSdcardFallback('Success'), false);
  assert.equal(needsSdcardFallback(''), false);
});

test('devClientUri：url= 整体百分号编码（坑 5 的前置）', async () => {
  const { devClientUri, DEV_BUILD } = await rulesPromise;
  assert.equal(
    devClientUri(),
    'mplayer://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081',
  );
  assert.equal(devClientUri(8082).endsWith('url=http%3A%2F%2Flocalhost%3A8082'), true);
  assert.equal(DEV_BUILD.launchComponent, 'com.mplayer.mobile.dev/com.mplayer.mobile.MainActivity');
});

test('shortPathWarning：超阈值才告警，且文案给出处置（坑 4 / 缺陷 6）', async () => {
  const { shortPathWarning, SHORT_PATH_WARN } = await rulesPromise;
  assert.equal(shortPathWarning('D:\\Playground\\mplayer\\packages\\mobile\\android'), null);

  const deep = 'D:\\Playground\\mplayer\\.claude\\worktrees\\update-prompt\\packages\\mobile\\android';
  assert.ok(deep.length > SHORT_PATH_WARN, '用例前提：该路径确实超阈值');
  const warning = shortPathWarning(deep);
  assert.match(warning, /CMake 对象路径可能超/);
  assert.match(warning, /换短路径检出/);
  // 缺陷 6：处置必须点名第二层坑，并给出真正解法 —— 只写「换短路径检出」正是下一个坑的入口
  assert.match(warning, /ClassNotFoundException: expo\.modules\.splashscreen/);
  assert.match(warning, /autolinking/);
  assert.match(warning, /主克隆里建临时分支构建/);
});

test('shortPathWarning：阈值边界（等于阈值不告警）', async () => {
  const { shortPathWarning, SHORT_PATH_WARN } = await rulesPromise;
  assert.equal(shortPathWarning('x'.repeat(SHORT_PATH_WARN)), null);
  assert.notEqual(shortPathWarning('x'.repeat(SHORT_PATH_WARN + 1)), null);
});

// ── 缺陷 1：Windows 上 .bat/.cmd 的启动方式 ──────────────────────

test('spawnPlan：Windows 的 .bat/.cmd 经 cmd.exe /d /s /c，并声明 verbatim（缺陷 1）', async () => {
  const { spawnPlan, isBatchFile } = await rulesPromise;
  const bat = 'D:\\repo\\packages\\mobile\\android\\gradlew.bat';
  const plan = spawnPlan(bat, ['assembleDebug', '-PreactNativeArchitectures=arm64-v8a'], 'win32');

  assert.equal(plan.command, 'cmd.exe');
  assert.deepEqual(plan.args.slice(0, 3), ['/d', '/s', '/c']);
  assert.equal(plan.args.length, 4);
  assert.match(plan.args[3], /gradlew\.bat assembleDebug -PreactNativeArchitectures=arm64-v8a/);
  // 无 shell 直 spawn 在 node ≥18.20 是 EINVAL；verbatim 也必须为真，
  // 否则 libuv 会对 cmd.exe 做它自己那套引号转义，把上面这行改坏。
  assert.equal(plan.verbatim, true);
  assert.equal(isBatchFile('gradlew.bat'), true);
  assert.equal(isBatchFile('npx.cmd'), true);
  assert.equal(isBatchFile('adb.exe'), false);
});

test('spawnPlan：POSIX 直 spawn，不套 cmd.exe（缺陷 1）', async () => {
  const { spawnPlan, gradleExecutable, gradleArgs } = await rulesPromise;
  const plan = spawnPlan(gradleExecutable('darwin'), gradleArgs('assembleDebug', 'arm64-v8a'), 'darwin');
  assert.equal(plan.command, './gradlew');
  assert.deepEqual(plan.args, ['assembleDebug', '-PreactNativeArchitectures=arm64-v8a']);
  assert.equal(plan.verbatim, false);
  // .exe 在 Windows 上同样直 spawn（只有批处理需要 shell）
  const adb = spawnPlan('adb', ['devices'], 'win32');
  assert.equal(adb.command, 'adb');
  assert.deepEqual(adb.args, ['devices']);
  assert.equal(adb.verbatim, false);
});

test('spawnPlan：带空格的路径被引起来，仍落在 cmd.exe 的一行里（缺陷 1）', async () => {
  const { spawnPlan } = await rulesPromise;
  const plan = spawnPlan('C:\\my tools\\android\\gradlew.bat', ['assembleDebug'], 'win32');
  assert.equal(plan.command, 'cmd.exe');
  // 整体引号 + 路径引号：cmd 的 /s 语义剥掉最外层后剩下 "路径" args，实测两种路径都对
  assert.equal(plan.args[3], '""C:\\my tools\\android\\gradlew.bat" assembleDebug"');
  assert.equal(plan.verbatim, true);
});

// ── 缺陷 2：超时与失败归因 ──────────────────────────────────────

test('adbTimeoutMs：默认 30s、可按环境变量配、非法/0 回落（缺陷 2）', async () => {
  const { adbTimeoutMs, DEFAULT_ADB_TIMEOUT_MS, ADB_TIMEOUT_ENV } = await rulesPromise;
  assert.equal(DEFAULT_ADB_TIMEOUT_MS, 30_000);
  assert.equal(ADB_TIMEOUT_ENV, 'MOBILE_ADB_TIMEOUT_MS');
  assert.equal(adbTimeoutMs(undefined), 30_000);
  assert.equal(adbTimeoutMs(''), 30_000);
  assert.equal(adbTimeoutMs('5000'), 5_000);
  assert.equal(adbTimeoutMs('45000'), 45_000);
  // 0 在 spawnSync 里是「永不超时」——正是要修的那个坑，必须回落
  assert.equal(adbTimeoutMs('0'), 30_000);
  assert.equal(adbTimeoutMs('abc'), 30_000);
  assert.equal(adbTimeoutMs('-1'), 30_000);
  assert.equal(adbTimeoutMs('999999999'), 900_000);
});

test('launchTimeoutMs / postPlayTimeoutMs：各有默认值且能配（缺陷 2/3）', async () => {
  const { launchTimeoutMs, postPlayTimeoutMs } = await rulesPromise;
  assert.equal(launchTimeoutMs(undefined), 90_000);
  assert.equal(launchTimeoutMs('1000'), 90_000, '低于下限回落：拉起等 1s 等于必然假失败');
  assert.equal(launchTimeoutMs('120000'), 120_000);
  assert.equal(postPlayTimeoutMs(undefined), 120_000);
  assert.equal(postPlayTimeoutMs('300000'), 300_000);
});

test('classifySpawnFailure：卡死与「起不来」分开归因（缺陷 1/2）', async () => {
  const { classifySpawnFailure } = await rulesPromise;
  const e = (code, message) => Object.assign(new Error(message), { code });
  assert.equal(classifySpawnFailure({ status: 0 }), null);
  assert.equal(classifySpawnFailure({ status: 1, stderr: 'compile error' }), null);
  assert.equal(classifySpawnFailure({ error: e('EINVAL', 'spawnSync gradlew.bat EINVAL') }).kind, 'spawn');
  assert.equal(classifySpawnFailure({ error: e('ENOENT', 'spawn adb ENOENT') }).kind, 'spawn');
  assert.equal(classifySpawnFailure({ error: e('ETIMEDOUT', 'spawnSync adb ETIMEDOUT') }).kind, 'timeout');
  // spawnSync 超时时 status 为 null、signal 为 SIGTERM
  assert.equal(classifySpawnFailure({ status: null, signal: 'SIGTERM', error: new Error('killed') }).kind, 'timeout');
});

test('adbHangHint：给出 5037 的处置（缺陷 2）', async () => {
  const { adbHangHint } = await rulesPromise;
  const hint = adbHangHint(30_000);
  assert.match(hint, /30000ms/);
  assert.match(hint, /5037/);
  assert.match(hint, /Get-NetTCPConnection -LocalPort 5037/);
  assert.match(hint, /只留一份/);
  assert.match(hint, /重建 reverse/);
});

// ── 缺陷 3：相位划分决定退出码 ──────────────────────────────────

test('checkPlan：启动期只有身份锚 + logcat，且都决定退出码（缺陷 3）', async () => {
  const { checkPlan, decidesExitCode } = await rulesPromise;
  const plan = checkPlan();
  assert.deepEqual(plan.launch.map((c) => c.id), ['pkg-fresh', 'logcat-main']);
  assert.ok(plan.launch.every((c) => c.phase === 'launch'));
  assert.ok(plan.launch.every((c) => decidesExitCode(c)));
  // 启动期不该出现 dumpsys 自检：它们要「正在播放」
  assert.ok(plan.launch.every((c) => !/dumpsys/.test((c.args ?? []).join(' '))));
});

test('checkPlan / decidesExitCode：冷启动下后三项目绝不决定退出码（缺陷 3）', async () => {
  const { checkPlan, decidesExitCode } = await rulesPromise;
  const { postPlayback, advisory } = checkPlan();
  assert.deepEqual(postPlayback.map((c) => c.id), ['fgs', 'media-session', 'notification']);

  // 这是缺陷 3 的核心不变量：默认（冷跑）一个都不许计入
  assert.ok(postPlayback.every((c) => !decidesExitCode(c)));
  assert.ok(postPlayback.every((c) => !decidesExitCode(c, { afterPlay: false })));
  // 只有显式 --after-play 才计入（那时人已经去播了，能成立）
  assert.ok(postPlayback.every((c) => decidesExitCode(c, { afterPlay: true })));
  // pidof 是观测，工具不可用不算失败 → 永不决定退出码
  assert.ok(advisory.every((c) => !decidesExitCode(c, { afterPlay: true })));
  assert.equal(decidesExitCode(undefined), false);
});

// ── 缺陷 5：FGS 判定限定在一个 ServiceRecord 块内 ────────────────

const SVC = 'expo.modules.mplayerplayer.PlayerService';
const dumpWith = (blocks) => [
  'Services in Current User: 0',
  ...blocks,
].join('\n');

test('isServiceForeground：必须在自己的 ServiceRecord 块内命中（缺陷 5）', async () => {
  const { isServiceForeground } = await rulesPromise;
  const selfForeground = dumpWith([
    `  ServiceRecord{5f8e4a3 u0 com.mplayer.mobile.dev/${SVC}}`,
    '    intent={act=androidx.media3.session.MediaSessionService}',
    '    isForeground=true',
    '',
  ]);
  assert.equal(isServiceForeground(selfForeground, SVC), true);

  // 原实现（全文扫 [\s\S]*isForeground=true）会在这里假 PASS：
  // PlayerService 的块里**没有**前台标记，前台的是后面另一个服务。
  const otherForeground = dumpWith([
    `  ServiceRecord{5f8e4a3 u0 com.mplayer.mobile.dev/${SVC}}`,
    '    intent={act=androidx.media3.session.MediaSessionService}',
    '    isForeground=false',
    '',
    '  ServiceRecord{aaa111 u0 com.mplayer.mobile.dev/com.other.SomeService}',
    '    isForeground=true',
    '',
  ]);
  assert.equal(isServiceForeground(otherForeground, SVC), false);

  // 服务不在 dumpsys 输出里 → false（不是「没找到就算过」）
  assert.equal(isServiceForeground(dumpWith([]), SVC), false);
  assert.equal(isServiceForeground('', SVC), false);
});

test('serviceBlock：只返回目标服务那一段；等号两侧空格也认（缺陷 5）', async () => {
  const { serviceBlock, isServiceForeground } = await rulesPromise;
  const text = dumpWith([
    `  ServiceRecord{5f8e4a3 u0 com.mplayer.mobile.dev/${SVC}}`,
    '    isForeground = true',
    '',
    '  ServiceRecord{bbb222 u0 com.mplayer.mobile.dev/com.other.SomeService}',
    '    isForeground=false',
    '',
  ]);
  const block = serviceBlock(text, SVC);
  assert.ok(block.includes(SVC));
  assert.equal(block.includes('SomeService'), false, '块不能跨到下一个 ServiceRecord');
  assert.equal(isServiceForeground(text, SVC), true);
});

test('FGS 服务名是 native-player 的 PlayerService，不是已移除的 AudioControlsService（缺陷 5）', async () => {
  const { DEV_BUILD } = await rulesPromise;
  assert.equal(DEV_BUILD.fgsService, 'expo.modules.mplayerplayer.PlayerService');
  assert.doesNotMatch(DEV_BUILD.fgsService, /AudioControlsService/);
  assert.equal(DEV_BUILD.notificationChannel, 'music-playback-native');
});

// ── 缺陷 4：reverse 复核 ────────────────────────────────────────

test('reverseListed：reverse --list 里真的列到这对端口才算建成（缺陷 4）', async () => {
  const { reverseListed, reverseFailureHint } = await rulesPromise;
  assert.equal(reverseListed('host-2 tcp:8081 tcp:8081\n'), true);
  assert.equal(reverseListed('abc123 tcp:8081 tcp:8081\n'), true);
  assert.equal(reverseListed(''), false);
  assert.equal(reverseListed('tcp:8081 tcp:8082'), false);
  assert.equal(reverseListed('host-2 tcp:8082 tcp:8082'), false);

  const hint = reverseFailureHint();
  assert.match(hint, /双 transport/);
  assert.match(hint, /adb disconnect/);
  assert.match(hint, /重建/);
  assert.match(hint, /tcp:8081 tcp:8081/);
});

// ── 缺陷 7：身份锚 ──────────────────────────────────────────────

const PKG_DUMP = [
  'Packages:',
  '  Package [com.mplayer.mobile.dev] (5f8e4a3):',
  '    userId=10123',
  '    versionCode=1 minSdk=24 targetSdk=34',
  '    versionName=1.0.0',
  '    firstInstallTime=2026-10-01 09:00:00',
  '    lastUpdateTime=2026-10-06 01:23:45',
  '    dataDir=/data/user/0/com.mplayer.mobile.dev',
].join('\n');

test('parsePackageDump / parseAndroidTime：读出 lastUpdateTime 与 versionName（缺陷 7）', async () => {
  const { parsePackageDump, parseAndroidTime } = await rulesPromise;
  const info = parsePackageDump(PKG_DUMP);
  assert.equal(info.installed, true);
  assert.equal(info.versionName, '1.0.0');
  assert.equal(info.lastUpdateTime, '2026-10-06 01:23:45');
  assert.equal(info.lastUpdateTimeMs, new Date(2026, 9, 6, 1, 23, 45).getTime());

  assert.equal(parseAndroidTime('2026-10-06T01:23:45'), new Date(2026, 9, 6, 1, 23, 45).getTime());
  assert.equal(parseAndroidTime('nonsense'), null);
  assert.equal(parseAndroidTime(undefined), null);

  const missing = parsePackageDump('Unable to find package: com.mplayer.mobile.dev');
  assert.equal(missing.installed, false);
  assert.equal(parsePackageDump('').installed, false);
});

test('deviceClockMs：date +%s 的秒 → 毫秒（缺陷 7）', async () => {
  const { deviceClockMs } = await rulesPromise;
  assert.equal(deviceClockMs('1759723456\n'), 1759723456000);
  assert.equal(deviceClockMs('1759723456\r\n'), 1759723456000);
  assert.equal(deviceClockMs('date: not found'), null);
  assert.equal(deviceClockMs(''), null);
});

test('identityAnchor：装的是旧包/没装/读不到时间都要判死（缺陷 7）', async () => {
  const { identityAnchor, isFreshInstall, FRESH_INSTALL_TOLERANCE_MS } = await rulesPromise;
  const info = { installed: true, versionName: '1.2.3', lastUpdateTime: '2026-10-06 01:23:45', lastUpdateTimeMs: 100_000 };
  assert.equal(FRESH_INSTALL_TOLERANCE_MS, 5_000);

  // 基线在安装前读（略早于 lastUpdateTime）→ 成立
  assert.equal(identityAnchor({ packageDump: info, deviceTimeBeforeMs: 99_000 }).ok, true);
  // 设备上是两小时前的包 → 判死（这就是「日志 changed=true 的假验收」那一类）
  const stale = identityAnchor({ packageDump: info, deviceTimeBeforeMs: 100_000 + 7_200_000 });
  assert.equal(stale.ok, false);
  assert.match(stale.detail, /旧包/);
  // 没装
  assert.equal(identityAnchor({ packageDump: { installed: false }, deviceTimeBeforeMs: 1 }).ok, false);
  // 装了但读不到 lastUpdateTime / 读不到设备时间 → 不能假装成立
  assert.equal(identityAnchor({ packageDump: { installed: true }, deviceTimeBeforeMs: 1 }).ok, false);
  assert.equal(identityAnchor({ packageDump: info, deviceTimeBeforeMs: null }).ok, false);

  assert.equal(isFreshInstall({ lastUpdateTimeMs: 100_000, deviceTimeBeforeMs: 100_000 }), true);
  assert.equal(isFreshInstall({ lastUpdateTimeMs: 95_000, deviceTimeBeforeMs: 100_000 }), true, '秒级截断的容差');
  assert.equal(isFreshInstall({ lastUpdateTimeMs: 94_000, deviceTimeBeforeMs: 100_000 }), false);
});

test('logcatVerdict：Running "main" 才算起来；undefined is not a function 一律判死（缺陷 3）', async () => {
  const { logcatVerdict } = await rulesPromise;
  assert.equal(logcatVerdict('I ReactNativeJS: Running "main"').ok, true);
  assert.equal(logcatVerdict('').ok, false);

  const redbox = logcatVerdict('I ReactNativeJS: Running "main"\nE ReactNativeJS: TypeError: undefined is not a function');
  assert.equal(redbox.ok, false, '红屏优先于 Running "main"');
  assert.match(redbox.reason, /undefined is not a function/);
  assert.match(redbox.reason, /expo start --clear/);
});

test('processAliveVerdict：观测不到 != 进程死了（缺陷 3 的 advisory）', async () => {
  const { processAliveVerdict } = await rulesPromise;
  assert.equal(processAliveVerdict({ stdout: '12345\n', status: 0 }), 'alive');
  assert.equal(processAliveVerdict({ stdout: '', status: 1 }), 'unknown', '命令失败 = 观测不到');
  assert.equal(processAliveVerdict({ stdout: 'pidof: not found', status: 127 }), 'unknown');
  assert.equal(processAliveVerdict({ stdout: '', stderr: '', status: 0 }), 'dead');
});

test('parsePackagePath：多 split 时取 base.apk（缺陷 7）', async () => {
  const { parsePackagePath } = await rulesPromise;
  const split = 'package:/data/app/~~x==/com.mplayer.mobile.dev-y==/base.apk\npackage:/data/app/~~x==/com.mplayer.mobile.dev-y==/split_config.arm64_v8a.apk\n';
  assert.equal(parsePackagePath(split).apk, '/data/app/~~x==/com.mplayer.mobile.dev-y==/base.apk');
  assert.equal(parsePackagePath(split).all.length, 2);
  assert.equal(parsePackagePath('package:/data/app/only.apk').apk, '/data/app/only.apk');
  assert.equal(parsePackagePath('').apk, null);
});

test('findSymbolInApk：解压后扫条目（store 与 deflate 都要命中）（缺陷 7）', async () => {
  const { findSymbolInApk, readZipEntries } = await rulesPromise;
  const apk = makeZip([
    { name: 'classes.dex', data: 'xxxx onUpdateNotification yyyy', store: true },
    { name: 'classes2.dex', data: 'zzzz PlayerService wwww' },
    { name: 'assets/index.android.bundle', data: 'changed=true' },
  ]);

  assert.deepEqual(readZipEntries(apk).map((e) => e.name), ['classes.dex', 'classes2.dex', 'assets/index.android.bundle']);

  // store 条目
  const stored = findSymbolInApk(apk, 'onUpdateNotification');
  assert.equal(stored.found, true);
  assert.deepEqual(stored.hits, ['classes.dex']);
  // deflate 条目：裸搜 APK 字节会漏，解压后才命中
  const deflated = findSymbolInApk(apk, 'PlayerService');
  assert.equal(deflated.found, true);
  assert.deepEqual(deflated.hits, ['classes2.dex']);
  assert.equal(findSymbolInApk(apk, 'changed=true').found, true);

  // 旧包：符号不在 → found=false（这才是「设备跑的不是这份代码」的证据）
  assert.equal(findSymbolInApk(apk, 'AudioControlsService').found, false);

  // 读不出结构时是 null（未知），不是 false（没有）
  assert.equal(findSymbolInApk(Buffer.from('not a zip at all'), 'x').found, null);
  assert.equal(findSymbolInApk(apk, '  ').found, null);
  assert.equal(readZipEntries(Buffer.from('not a zip')).length, 0);
});

// ── 缺陷 8（字面缺口）：MOBILE_ADB / MOBILE_GRADLE 只是「路径钉死」，不是 5037 争抢的处置 ──
// 评审原话：它「既不检测争抢也不重试，只是允许钉死路径；在没有测试覆盖的情况下它更接近
// 测试钩子而不是处置」。所以这里钉死**它就是路径钉死**这一语义，并补上此前为零的覆盖；
// 5037 的检测/处置在 adbHangHint()（已有用例），此处不假装有检测、也不许回归成自动处置。

test('adbBinaryFor：MOBILE_ADB 钉死二进制路径；未设/空串回落 PATH 上的 adb（缺陷 8）', async () => {
  const { adbBinaryFor } = await rulesPromise;
  const pinned = 'D:\\leidian\\LDPlayer14\\adb.exe';
  assert.equal(adbBinaryFor({ MOBILE_ADB: pinned }), pinned);
  assert.equal(adbBinaryFor({ MOBILE_ADB: 'adb' }), 'adb');
  assert.equal(adbBinaryFor({}), 'adb');
  assert.equal(adbBinaryFor(), 'adb');
  // 空串按未设处理（沿用 `process.env.MOBILE_ADB || 'adb'` 的既有语义，不是新行为）
  assert.equal(adbBinaryFor({ MOBILE_ADB: '' }), 'adb');
});

test('gradleBinaryFor：MOBILE_GRADLE 钉死二进制路径；未设回落 android 目录下的 gradlew(.bat)（缺陷 8）', async () => {
  const { gradleBinaryFor, gradleExecutable } = await rulesPromise;
  const pinned = 'D:\\tools\\gradle\\bin\\gradle.bat';
  assert.equal(gradleBinaryFor({ MOBILE_GRADLE: pinned }, 'D:\\repo\\android', 'win32'), pinned);
  assert.equal(gradleBinaryFor({}, 'D:\\repo\\android', 'win32'), path.join('D:\\repo\\android', 'gradlew.bat'));
  assert.equal(gradleBinaryFor({}, '/repo/android', 'linux'), path.join('/repo/android', './gradlew'));
  // 空串按未设处理
  assert.equal(gradleBinaryFor({ MOBILE_GRADLE: '' }, '/repo/android', 'darwin'), path.join('/repo/android', './gradlew'));
  // 回落值仍由既有 gradleExecutable() 决定（不在这里另造一套平台判定）
  assert.equal(gradleBinaryFor({}, '/r/a', 'win32'), path.join('/r/a', gradleExecutable('win32')));
  assert.equal(gradleBinaryFor({}, '/r/a', 'darwin'), path.join('/r/a', gradleExecutable('darwin')));
});
