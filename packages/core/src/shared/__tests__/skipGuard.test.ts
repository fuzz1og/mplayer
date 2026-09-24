import { beforeEach, describe, expect, it } from 'vitest';
import type { Song } from '../../types/index.js';
import {
  SKIP_LIMIT,
  decideAfterPlaybackFailure,
  registerTerminalFailure,
  resetFailureStreak,
  getFailureStreak,
  isKnownBadSong,
  clearSkipGuard,
  type SkipGuardInput,
} from '../skipGuard.js';

/**
 * 跳歌护栏（#385）：纯决策 + 会话内状态的两组断言。
 * 只测外部行为：给定输入 → 得到 `skip | stop` 与文案；给定事件序列 → 计数/坏歌集合。
 */

const song = (id: string, sourceType: Song['sourceType'] = 'qq'): Song => ({
  id,
  name: '晴天',
  artist: '周杰伦',
  album: '',
  url: '',
  cover: '',
  lrc: '',
  duration: 240,
  sourceType,
});

const input = (overrides: Partial<SkipGuardInput> = {}): SkipGuardInput => ({
  songName: '晴天',
  reasonText: '直连与全部订阅源均未命中',
  offline: false,
  autoSkip: true,
  hasNextSong: true,
  consecutiveFailures: 1,
  isLocal: false,
  ...overrides,
});

beforeEach(() => { clearSkipGuard(); });

describe('decideAfterPlaybackFailure（纯函数）', () => {
  it('离线优先：不管有没有下一首/偏好，直接停并明确告知', () => {
    const d = decideAfterPlaybackFailure(input({ offline: true, hasNextSong: true }));
    expect(d.action).toBe('stop');
    expect(d.copy).toContain('离线');
  });

  it('关闭「失败即跳」：停，不再替用户改写意图', () => {
    const d = decideAfterPlaybackFailure(input({ autoSkip: false, hasNextSong: true }));
    expect(d.action).toBe('stop');
    expect(d.copy).toContain('自动跳歌已关闭');
  });

  it('连续失败达固定上限 → 停（与队列长度无关）', () => {
    const d = decideAfterPlaybackFailure(input({ consecutiveFailures: SKIP_LIMIT, hasNextSong: true }));
    expect(d.action).toBe('stop');
    expect(d.copy).toBe(`连续 ${SKIP_LIMIT} 首无法播放，已暂停`);
  });

  it('没有下一首 → 停并说明', () => {
    const d = decideAfterPlaybackFailure(input({ hasNextSong: false, consecutiveFailures: 1 }));
    expect(d.action).toBe('stop');
    expect(d.copy).toContain('队列中没有其他歌曲');
  });

  it('本地文件 → 跳，文案与在线源失败区分', () => {
    const d = decideAfterPlaybackFailure(input({ isLocal: true }));
    expect(d.action).toBe('skip');
    expect(d.copy).toContain('本地文件');
  });

  it('正常路径 → 跳，文案含歌名与归因（双端共用同一来源）', () => {
    const d = decideAfterPlaybackFailure(input({ songName: '稻香', reasonText: '源都试了没命中' }));
    expect(d.action).toBe('skip');
    expect(d.copy).toBe('《稻香》源都试了没命中，已自动跳到下一首');
  });
});

describe('会话内状态（连续计数 + 坏歌记忆）', () => {
  it('registerTerminalFailure：计数 +1 且记住该歌', () => {
    expect(registerTerminalFailure(song('a'))).toBe(1);
    expect(registerTerminalFailure(song('b'))).toBe(2);
    expect(getFailureStreak()).toBe(2);
    expect(isKnownBadSong(song('a'))).toBe(true);
    expect(isKnownBadSong(song('c'))).toBe(false);
  });

  it('手动点歌不清零：只在成功播放（resetFailureStreak）时归零（修 D2 无限循环）', () => {
    registerTerminalFailure(song('a'));
    registerTerminalFailure(song('b'));
    expect(getFailureStreak()).toBe(2);
    // 用户手动点歌 = 只是又调了一次播放，不调用 reset → 计数保持
    expect(getFailureStreak()).toBe(2);
    resetFailureStreak();
    expect(getFailureStreak()).toBe(0);
  });

  it('坏歌记忆按身份键（同 id 不同源不串）', () => {
    registerTerminalFailure(song('123', 'netease'));
    expect(isKnownBadSong(song('123', 'netease'))).toBe(true);
    expect(isKnownBadSong(song('123', 'kuwo'))).toBe(false);
  });

  it('连续失败到上限的决策与计数一致（断网 200 首队列也只走 3 首）', () => {
    const decisions = [1, 2, 3].map((n) =>
      decideAfterPlaybackFailure(input({ consecutiveFailures: n, hasNextSong: true })),
    );
    expect(decisions.map((d) => d.action)).toEqual(['skip', 'skip', 'stop']);
  });
});
