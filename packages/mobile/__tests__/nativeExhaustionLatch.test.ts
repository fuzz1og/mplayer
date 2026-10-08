import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * #609 终局闩（#563）的**单一落点**守卫。
 *
 * 背景：闩在 #591 落地后散出 7 个手动 clear 点
 * （`PlayerService.kt:306 / 417 / 427 / 663 / 688 / 709 / 768`），而坐标是服务自己的两个
 * 并列字段 `exhaustedAtRevision` / `exhaustedAtIndex` —— 任何一处只写一个，
 * `isExhaustedAtCurrent()` 就退化成永假/永真，且**不会有任何编译错误**。
 *
 * Vitest 是 Node 环境 + 假原生桥，跑不了 Kotlin（也断言不了 private 字段），所以这里的守卫是
 * **源码契约**：坐标只能存在于 `ExhaustionLatch`，`PlayerService` 只能经
 * `exhaustion.mark/clear/isLatchedAt` 读写。**它不替代 Kotlin 编译与真机验收** ——
 * #609 的行为证据是 PR 正文里 #591 两个场景 + 阳性对照的 logcat 原文。
 */

/** `__tests__/` 的上一级 = packages/mobile */
const MODULE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const NATIVE = 'modules/native-player/android/src/main/java/expo/modules/mplayerplayer';

// 路径刻意拼字符串而不是 new URL —— mobile 的 tsconfig 里 Node 的 URL 类型与 DOM 的 URL 类型冲突。
function read(rel: string): string {
  return readFileSync(join(MODULE_ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
}

/** 闩文件是先于实现存在的守卫目标：缺失时返回空串，让断言给出「找不到」而不是 ENOENT。 */
function readIfExists(rel: string): string {
  const abs = join(MODULE_ROOT, rel);
  return existsSync(abs) ? readFileSync(abs, 'utf8').replace(/\r\n/g, '\n') : '';
}

const service = read(`${NATIVE}/PlayerService.kt`);

function body(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  expect(from, `找不到 ${start}`).toBeGreaterThanOrEqual(0);
  const to = source.indexOf(end, from + start.length);
  expect(to, `找不到 ${end}`).toBeGreaterThan(from);
  return source.slice(from, to);
}

const countOf = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

describe('#609 终局闩单一落点：源码契约守卫（不替代 Kotlin 编译/设备验证）', () => {
  const latch = readIfExists(`${NATIVE}/ExhaustionLatch.kt`);

  it('闩坐标只存在于 ExhaustionLatch，PlayerService 不再持有 exhaustedAt* 字段', () => {
    expect(latch.length, '缺少 ExhaustionLatch.kt').toBeGreaterThan(0);
    // 坐标是 private：服务拿不到，也就不可能「只清一半」
    expect(latch).toMatch(/private var latched/);
    // 置位 / 清除 / 查询的单一落点
    expect(latch).toMatch(/fun mark\(/);
    expect(latch).toMatch(/fun clear\(/);
    expect(latch).toMatch(/fun isLatchedAt\(/);

    // 服务侧不得再出现坐标字段（含 `exhaustedAtRevision = -1L` 这类直写）
    expect(service).not.toMatch(/exhaustedAtRevision/);
    expect(service).not.toMatch(/exhaustedAtIndex/);
    expect(service).not.toContain('clearExhausted()');
    expect(service).not.toContain('markExhausted()');
    expect(service).not.toContain('isExhaustedAtCurrent()');
  });

  it('服务只经 exhaustion.mark / isLatchedAt 读写闩', () => {
    expect(service).toContain('private val exhaustion = ExhaustionLatch()');
    expect(service).toContain('exhaustion.mark(');
    expect(service).toContain('exhaustion.isLatchedAt(');

    // 置位：诚实结束（finishAtTail）与 #574 稳态水位分支各一处
    const finish = body(service, '  private fun finishAtTail(', '  /**\n   * 「下一首播放」（#494）');
    expect(finish).toContain('exhaustion.mark(store.currentRevision(), store.currentIndex())');
    // 查询：LOW_WATER 只读闩，且必须在真正要歌之前
    const maybe = body(service, '  private fun maybeRequestTracks(', '  /** 发 needTracks');
    const query = 'exhaustion.isLatchedAt(store.currentRevision(), store.currentIndex())';
    expect(maybe).toContain(query);
    expect(maybe.indexOf(query)).toBeLessThan(maybe.indexOf('requestTracks(reason)'));
  });

  it('7 处清扫点全部改调 exhaustion.clear()，数量钉死为 7（新增即红，逼一次显式评审）', () => {
    expect(countOf(service, 'exhaustion.clear()')).toBe(7);

    // 逐处点名：新队列 / 补窗推进 / 补窗绕回 / play / next / prev / 曲目切换
    const sites: [string, string, string][] = [
      ['新队列落盘', '  fun loadQueue(', '  fun patchQueue('],
      ['补窗推进（pendingUserNext）', '  fun patchQueue(', '  /**\n   * #591：结算入参的'],
      ['play()', '  fun play(', '  fun pause('],
      ['next()', '  fun next(', '  fun prev('],
      ['prev()', '  fun prev(', '  fun seek('],
      ['曲目切换', '  override fun onMediaItemTransition(', '  override fun onPlaybackStateChanged('],
    ];
    for (const [name, start, end] of sites) {
      expect(body(service, start, end), name).toContain('exhaustion.clear()');
    }
    // patchQueue 里是两处（推进 / 绕回），其余各一处 → 6 个函数体共 7 次
    expect(countOf(body(service, '  fun patchQueue(', '  /**\n   * #591：结算入参的'), 'exhaustion.clear()')).toBe(2);
  });
});
