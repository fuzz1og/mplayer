import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * #405 守卫：曲末自动切歌**不得依赖 JS 定时器**。
 *
 * Android 后台（Activity 暂停）时 ReactHost 会挂起 JS 定时器——新架构下 timer 是宿主侧
 * 实现，onHostPause 暂停、onHostResume 才把逾期回调补跑。所以写在 setTimeout 里的
 * 「曲末推进 / 同曲 fresh 重试」在后台根本不执行，表现为**后台播完一首就停住、一回前台
 * 立刻接着播下一首**（2026-09-27 在 dev build 上实测）。
 *
 * 守卫：播放服务里推进/重试一律走微任务（deferMicrotask），全文不得出现定时器。
 */
const testDir = dirname(fileURLToPath(String(import.meta.url)));
/** 注释里会出现「setTimeout(…, 0)」这类说明文字，先剥注释再断言 */
const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const SRC = stripComments(readFileSync(join(testDir, '..', 'services', 'audioPlayer.ts'), 'utf8'));

describe('后台曲末推进不得依赖定时器（#405）', () => {
  it('播放服务里不出现 setTimeout / setInterval（后台会被宿主挂起）', () => {
    expect(SRC).not.toMatch(/\bsetTimeout\s*\(/);
    expect(SRC).not.toMatch(/\bsetInterval\s*\(/);
  });

  it('微任务实现不依赖宿主定时器', () => {
    expect(SRC).toMatch(/function deferMicrotask\(run: \(\) => void\): void \{[\s\S]{0,80}Promise\.resolve\(\)\.then\(run\)/);
  });

  it('曲末推进（didJustFinish → 下一首）走微任务', () => {
    expect(SRC).toMatch(/if \(nextSong\) deferMicrotask\(\(\) => \{/);
  });

  it('同曲 fresh 重试走微任务', () => {
    expect(SRC).toMatch(/deferMicrotask\(\(\) => \{ if \(ctx\.playId === currentPlayId\) void playSong\(song, retryCount, true\); \}\)/);
  });
});
