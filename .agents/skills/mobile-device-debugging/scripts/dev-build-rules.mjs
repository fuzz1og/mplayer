/**
 * dev build 一条龙的纯判据（零 I/O、零副作用）。
 *
 * 抽成独立模块的理由：下面每一条都是「实测踩过、跑真机才验得到」的判定，必须能被
 * `node --test` 直接 import 钉住（`./__tests__/dev-build.test.js`）。
 * runner（`./dev-build.mjs`）只负责按这些判据编排命令。
 */

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
};

/**
 * CMake 对象路径上限 250 字符。实测数据点：主克隆
 * `…\mplayer\packages\mobile\android`（43 字符）正常；`.claude\worktrees\<name>\packages\mobile\android`
 * （78 字符）必失败（`CMAKE_OBJECT_PATH_MAX` / `build.ninja still dirty after 100 tries`）。
 * 真阈值落在两者之间、未做二分实测 —— 所以只**告警**不拦。
 */
export const SHORT_PATH_WARN = 60;

export function gradleExecutable(platform = process.platform) {
  return platform === 'win32' ? 'gradlew.bat' : './gradlew';
}

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
    + `处置：换短路径检出构建（如 D:\\npw），别在深层 .claude/worktrees/<长名> 里硬试。`;
}
