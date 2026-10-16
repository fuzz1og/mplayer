import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * #606：服务从快照 restore 的队列**必须带上** per-item 请求头（关掉 #592/ADR 的已知边界 3b）。
 * `PlayerService.persist()` 落盘前曾对每条 track 写 `put("headers", JSONObject())` ——快照里的头被
 * 显式清空。
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
