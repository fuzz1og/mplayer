import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * I6 守卫（PR #436 的不变量，规格 §11.1 在方案 C 下语义升级）：
 *
 * 原 4 条断言 = 「剥注释后 `services/audioPlayer.ts` 不得出现 setTimeout/setInterval」。
 * C 下**推进不再在 JS**（原生 ExoPlayer 播放列表接管 #405），所以断言升级为：
 *   1. 原生引擎的推进/补窗链路（`nativePlayer.ts` + `queuePrefetch.ts`）不得用计时器；
 *   2. `audioPlayer.ts` 的原生播放流程 `nativePlaySongFlow` 不得用计时器；
 *   3. 补窗只由「原生事件 / `getState()` 对账 / headless 任务」触发（静态断言入口存在）。
 *
 * 反面对照（C 下已作废）：PR #436 的「微任务替代 setTimeout」不再需要——推进根本不在 JS。
 */

/** `__tests__/` 的上一级 = packages/mobile */
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function readSource(relativePath: string): string {
  // 注意：这里刻意拼字符串路径而不是 new URL —— mobile 的 tsconfig 里
  // Node 的 URL 类型与 DOM 的 URL 类型冲突，readFileSync(URL) 过不了类型检查。
  return readFileSync(join(ROOT, relativePath), 'utf8').replace(/\r\n/g, '\n');
}

/** 剥掉块注释与行注释，避免注释里的 `setTimeout` 字样误报。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
}

function timersIn(source: string): string[] {
  const matches = stripComments(source).match(/\b(setTimeout|setInterval|requestAnimationFrame)\s*\(/g);
  return matches ?? [];
}

function extractFunction(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  expect(start, `找不到 ${startMarker}`).toBeGreaterThanOrEqual(0);
  const end = source.indexOf(endMarker, start);
  expect(end, `找不到 ${endMarker}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('I6：播放推进不得依赖 JS 定时器', () => {
  it('原生引擎 nativePlayer.ts 无计时器（补窗是事件/对账驱动）', () => {
    const source = readSource('services/nativePlayer.ts');
    expect(timersIn(source)).toEqual([]);
  });

  it('窗口规划 queuePrefetch.ts 是纯同步逻辑，无计时器', () => {
    const source = readSource('services/queuePrefetch.ts');
    expect(timersIn(source)).toEqual([]);
  });

  it('audioPlayer.ts 的原生播放流程 nativePlaySongFlow 无计时器', () => {
    const source = readSource('services/audioPlayer.ts');
    const body = extractFunction(source, 'async function nativePlaySongFlow(', '\nexport async function playSong(');
    expect(timersIn(body)).toEqual([]);
  });

  it('原生引擎只通过 loadQueue / patchQueue 投喂队列（不自己产生推进定时器）', () => {
    const source = stripComments(readSource('services/nativePlayer.ts'));
    expect(source).toMatch(/\.loadQueue\(/);
    expect(source).toMatch(/\.patchQueue\(/);
    // 推进由原生事件驱动：必须订阅 trackChanged / queueEnded / needTracks
    expect(source).toMatch(/addListener\('trackChanged'/);
    expect(source).toMatch(/addListener\('queueEnded'/);
    expect(source).toMatch(/addListener\('needTracks'/);
  });

  it('后台补窗走 headless 任务（与前台同一条 feedWindow），不靠 JS 常驻定时器', () => {
    const source = stripComments(readSource('services/nativePlayer.ts'));
    expect(source).toMatch(/registerHeadlessTask\(/);
    expect(source).toMatch(/registerHeadlessHost\(\)/);
    // headless 任务体内部必须调用同一个 feedWindow
    const task = extractFunction(source, 'AppRegistry.registerHeadlessTask(', '});');
    expect(task).toContain('feedWindow');
  });

  it('ROOT 解析可用（防止路径漂移导致上面的断言静默失效）', () => {
    expect(readSource('services/audioPlayer.ts').length).toBeGreaterThan(1000);
  });
});
