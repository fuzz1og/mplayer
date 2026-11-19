import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 终局转移的源码契约守卫（CODING_STANDARDS「必须处处接线」的配套）：终局只能经 `settlePlayback`，
 * 浮窗 end 只能经 `hideOverlay`。Vitest 跑不了 Android Service，行为验证见 Kotlin JUnit 与真机。
 */

const MODULE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const NATIVE = 'modules/native-player/android/src/main/java/expo/modules/mplayerplayer';

function read(rel: string): string {
  return readFileSync(join(MODULE_ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
}

/** 源码断言去掉注释：注释里引用旧写法很常见，否则守卫会误伤自己。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const service = stripComments(read(`${NATIVE}/PlayerService.kt`));

function functionBody(signature: string): string {
  const start = service.indexOf(signature);
  expect(start, `找不到 ${signature}`).toBeGreaterThanOrEqual(0);
  const open = service.indexOf('{', start + signature.length);
  expect(open, `${signature} 没有函数体`).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let i = open; i < service.length; i += 1) {
    if (service[i] === '{') depth += 1;
    else if (service[i] === '}') {
      depth -= 1;
      if (depth === 0) return service.slice(open, i + 1);
    }
  }
  throw new Error(`${signature} 函数体未闭合`);
}

describe('#775 终局转移单一落点：源码契约守卫（不替代 Kotlin 编译/设备验证）', () => {
  const terminalPaths: [string, string][] = [
    ['诚实结束（队尾 / shuffle 到头）', '  private fun finishAtTail('],
    ['用户 stop', '  fun stop()'],
    ['用户 next 踩空', '  fun next()'],
    ['曲末问 JS', '  private fun handleEnded()'],
    ['补窗窗口耗尽', '  fun onPrefetchWindowExhausted()'],
    ['离线停止（播放错误终态）', '  private fun handlePlayerError('],
    ['跳过失败项 / 跳过上限 / 仅剩一首', '  private fun skipFailedItem('],
  ];

  it('每条终局路径都经 settlePlayback 收口（新增终局路径漏接即红）', () => {
    for (const [name, signature] of terminalPaths) {
      expect(functionBody(signature), `${name} 必须经 settlePlayback 收口`).toContain('settlePlayback(');
    }
  });

  it('settlePlayback 同时做三件事：收浮窗 + 暂停 + 发事件', () => {
    const settle = functionBody('  private fun settlePlayback(');
    expect(settle).toContain('hideOverlay()');
    expect(settle).toContain('controller?.player?.pause()');
    expect(settle).toContain('emit(');
  });

  it('浮窗 onPlaybackEnded 只经 hideOverlay 调用（终局路径不得再直接接浮窗）', () => {
    const hide = functionBody('  private fun hideOverlay()');
    expect(hide).toContain('onPlaybackEnded()');
    expect(service.replace(hide, '')).not.toContain('onPlaybackEnded');
  });

  it('hideOverlay 自会落到主线程（stop 的调用线程是 JS 线程，不能直接 removeView）', () => {
    const hide = functionBody('  private fun hideOverlay()');
    expect(hide).toMatch(/Looper\.myLooper\(\)/);
    expect(hide).toContain('main.post');
  });

  it('onPlayerError 的错误收窗走 hideOverlay，不自行 pause / 发终点事件', () => {
    const body = functionBody('  override fun onPlayerError(');
    expect(body).toContain('hideOverlay()');
    expect(body).not.toContain('settlePlayback(');
    expect(body).not.toContain('player.pause()');
  });
});
