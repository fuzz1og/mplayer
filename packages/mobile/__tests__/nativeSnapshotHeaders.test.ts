import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * #606：服务从快照 restore 的队列**必须带上** per-item 请求头（关掉 #592/ADR 的已知边界 3b）。
 *
 * `PlayerService.persist()` 落盘前曾对每条 track 写 `put("headers", JSONObject())` ——
 * 快照里的头被显式清空。进程被杀 / `MediaLibraryService` 重启后，原生按快照 restore 出来的
 * 队列没有 UA/Referer，而这一段请求正是「原生自己推进、JS 还没重新投喂」的那一段：
 * 酷狗/QQ 的 CDN 校验 Referer 域名 → 403 → 触发跳歌护栏。
 *
 * 本模块没有 Kotlin 测试框架，PR/push 也不编译原生（ADR
 * `2026-09-29-ci-verification-boundary.md`），所以这里的守卫是**源码契约**：
 * ① `persist()` 不再清空 headers，落盘的就是 `TrackRecord.toJson()` 那份带头的序列化；
 * ② restore 路径真的把它读回来（`restoreSnapshot` → `QueueStore.restoreFrom` → `fromJson`）；
 * ③ 旧版本快照没有 `headers` 键 —— 读回一律走 `optJSONObject`（缺键 = 空 map，不抛），
 *    空 map 在 `ExpiryGuard` 仍命中「不自定义头」那条分支，与改前行为一致。
 *
 * **它不替代 Kotlin 编译与真机验收**：杀进程续播的抓包证据仍要在设备到位时补
 * （`npm run mobile:e2e` / `runtime-verification` skill）。
 */

/** `__tests__/` 的上一级 = packages/mobile */
const MODULE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const NATIVE = 'modules/native-player/android/src/main/java/expo/modules/mplayerplayer';

// 路径刻意拼字符串而不是 new URL —— mobile 的 tsconfig 里 Node 的 URL 类型与 DOM 的 URL 类型冲突。
function read(rel: string): string {
  return readFileSync(join(MODULE_ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
}

const service = read(`${NATIVE}/PlayerService.kt`);
const store = read(`${NATIVE}/QueueStore.kt`);
const guard = read(`${NATIVE}/ExpiryGuard.kt`);

function body(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  expect(from, `找不到 ${start}`).toBeGreaterThanOrEqual(0);
  const to = source.indexOf(end, from + start.length);
  expect(to, `找不到 ${end}`).toBeGreaterThan(from);
  return source.slice(from, to);
}

const PERSIST = body(service, '  private fun persist()', '  /** 点击通知回 App');

describe('#606 快照保留 per-item 请求头：源码契约守卫（不替代 Kotlin 编译/设备验证）', () => {
  it('persist() 不再把 headers 写成空对象，落盘取 store.snapshot() 的那份带头序列化', () => {
    expect(service).not.toContain('put("headers", JSONObject())');
    expect(PERSIST, 'persist() 里不应再出现任何对 headers 的改写').not.toMatch(/put\(\s*"headers"/);
    expect(PERSIST).toContain('store.snapshot()');
    expect(PERSIST).toContain('json.put("tracks", tracks)');
  });

  it('头的序列化在 TrackRecord.toJson，反序列化在 fromJson，且 restore 路径真的经过它们', () => {
    expect(store).toMatch(/put\("headers", JSONObject\(headers/);
    expect(store).toMatch(/val headersJson = json\.optJSONObject\("headers"\)/);
    expect(store).toContain('headers = headers,');

    // restore 的两个入口：服务启动的快照恢复 + 补窗时的落盘，都读同一份 JSON 形状
    expect(service).toContain('store.restoreFrom(json)');
    expect(store).toContain('tracks.add(TrackRecord.fromJson(item))');
  });

  it('旧快照没有 headers 键时容错读回（缺键 = 空 map，不抛），空 map 维持 ExpiryGuard 的原分支', () => {
    // 收紧成「不许用会抛的 getJSONObject」： released 版本写的快照没有这个键。
    expect(store).not.toMatch(/getJSONObject\(\s*"headers"/);

    // 空 map 仍走「不加自定义头」，非空才 withRequestHeaders —— 改前改后同一条判定
    expect(guard).toContain('if (record.headers.isEmpty()) dataSpec else dataSpec.withRequestHeaders(record.headers)');
  });
});
