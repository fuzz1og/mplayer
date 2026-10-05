/**
 * `scripts/dev-build-rules.mjs` 的判据测试（#581）。
 *
 * 用 node:test 跑（`node --test .agents/skills/mobile-device-debugging/scripts/__tests__/dev-build.test.js`），
 * **零依赖、不碰 adb / gradle / 设备**：这里钉的是「实测踩过的坑」对应的判定，
 * 那些只有跑真机才验得到，所以必须能被单测钉住。
 *
 * **未覆盖**：真机出包、`pm install` 实际行为、三条 `dumpsys` 自检的现场命中 ——
 * 那些要设备 + 真构建，跑 `npm run mobile:dev-build` 验。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const rulesPromise = import('../dev-build-rules.mjs');

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

test('shortPathWarning：超阈值才告警，且文案给出处置（坑 4）', async () => {
  const { shortPathWarning, SHORT_PATH_WARN } = await rulesPromise;
  assert.equal(shortPathWarning('D:\\Playground\\mplayer\\packages\\mobile\\android'), null);

  const deep = 'D:\\Playground\\mplayer\\.claude\\worktrees\\update-prompt\\packages\\mobile\\android';
  assert.ok(deep.length > SHORT_PATH_WARN, '用例前提：该路径确实超阈值');
  const warning = shortPathWarning(deep);
  assert.match(warning, /CMake 对象路径可能超/);
  assert.match(warning, /换短路径检出构建/);
});

test('shortPathWarning：阈值边界（等于阈值不告警）', async () => {
  const { shortPathWarning, SHORT_PATH_WARN } = await rulesPromise;
  assert.equal(shortPathWarning('x'.repeat(SHORT_PATH_WARN)), null);
  assert.notEqual(shortPathWarning('x'.repeat(SHORT_PATH_WARN + 1)), null);
});
