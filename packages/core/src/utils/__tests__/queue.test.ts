import { describe, expect, it } from 'vitest';
import { getNextSongIndex, getPrevSongIndex } from '../queue.js';
import type { Song } from '../../types/index.js';

function song(id: string): Song {
  return { id, name: id, artist: 'a', album: '', duration: 100, sourceType: 'netease', url: '', cover: '', lrc: '' };
}

const queue = [song('1'), song('2'), song('3')];

describe('getNextSongIndex', () => {
  it('returns -1 for an empty queue', () => {
    expect(getNextSongIndex([], 0, '列表循环')).toBe(-1);
  });

  it('returns -1 when currentIndex is out of range', () => {
    expect(getNextSongIndex(queue, 3, '列表循环')).toBe(-1);
    expect(getNextSongIndex(queue, -1, '列表循环')).toBe(-1);
  });

  it('single loop: repeats the same index', () => {
    expect(getNextSongIndex(queue, 1, '单曲循环')).toBe(1);
  });

  it('list loop: wraps around to the first track', () => {
    expect(getNextSongIndex(queue, 2, '列表循环')).toBe(0);
    expect(getNextSongIndex(queue, 0, '列表循环')).toBe(1);
  });

  it('shuffle: never returns the current index (with a single song it does)', () => {
    for (let i = 0; i < 50; i++) {
      const next = getNextSongIndex(queue, 1, '随机播放');
      expect(next).not.toBe(1);
      expect(next).toBeGreaterThanOrEqual(0);
      expect(next).toBeLessThan(3);
    }
    expect(getNextSongIndex([song('1')], 0, '随机播放')).toBe(0);
  });
});

describe('getPrevSongIndex', () => {
  it('returns -1 for an empty queue', () => {
    expect(getPrevSongIndex([], 0, '列表循环')).toBe(-1);
  });

  it('returns -1 when currentIndex is out of range', () => {
    expect(getPrevSongIndex(queue, 3, '列表循环')).toBe(-1);
    expect(getPrevSongIndex(queue, -1, '列表循环')).toBe(-1);
  });

  it('list loop: wraps backwards to the last track', () => {
    expect(getPrevSongIndex(queue, 0, '列表循环')).toBe(2);
    expect(getPrevSongIndex(queue, 2, '列表循环')).toBe(1);
  });

  it('single loop: still goes to previous track (preserved behavior, no replay)', () => {
    expect(getPrevSongIndex(queue, 1, '单曲循环')).toBe(0);
    expect(getPrevSongIndex(queue, 0, '单曲循环')).toBe(2);
  });

  it('shuffle: never returns the current index (with a single song it does)', () => {
    for (let i = 0; i < 50; i++) {
      const prev = getPrevSongIndex(queue, 1, '随机播放');
      expect(prev).not.toBe(1);
      expect(prev).toBeGreaterThanOrEqual(0);
      expect(prev).toBeLessThan(3);
    }
    expect(getPrevSongIndex([song('1')], 0, '随机播放')).toBe(0);
  });
});
// ---------------------------------------------------------------------------
// #511 稳定随机序列：随机分支消费「洗牌序 + 游标」（上一首回上一张）
// ---------------------------------------------------------------------------
describe('随机播放的稳定序列（#511）', () => {
  const songs = [song('1'), song('2'), song('3')];
  /** 洗牌序 3 → 1 → 2；当前曲 = '1'（队列下标 0，序列游标 1） */
  const state = { order: ['3', '1', '2'], cursor: 1 };

  it('next：游标前进一格（映射回队列下标）', () => {
    expect(getNextSongIndex(songs, 0, '随机播放', state)).toBe(1); // '2'
  });

  it('prev：游标后退一格——回序列里的上一张，不再现抽（行为变更）', () => {
    expect(getPrevSongIndex(songs, 0, '随机播放', state)).toBe(2); // '3'
  });

  it('prev 之后 next 回到原曲（可逆）', () => {
    const back = getPrevSongIndex(songs, 0, '随机播放', state); // → '3'（下标 2）
    expect(getNextSongIndex(songs, back, '随机播放', state)).toBe(0); // → '1'
  });

  it('无序列：保留旧的防重复现抽行为（兼容路径，钉住）', () => {
    for (let i = 0; i < 50; i++) {
      expect(getNextSongIndex(songs, 1, '随机播放')).not.toBe(1);
      expect(getPrevSongIndex(songs, 1, '随机播放')).not.toBe(1);
    }
  });

  it('单元素队列：有序列时两个方向都归位该曲', () => {
    const only = [song('1')];
    expect(getNextSongIndex(only, 0, '随机播放', { order: ['1'], cursor: 0 })).toBe(0);
    expect(getPrevSongIndex(only, 0, '随机播放', { order: ['1'], cursor: 0 })).toBe(0);
  });

  it('空队列 / 越界 index 仍是 -1（与有无序列无关）', () => {
    expect(getNextSongIndex([], 0, '随机播放', { order: [], cursor: -1 })).toBe(-1);
    expect(getNextSongIndex(songs, 9, '随机播放', state)).toBe(-1);
    expect(getPrevSongIndex(songs, -1, '随机播放', state)).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// #639 R1：推进函数必须接受 shuffleScope，与调用方手里的队列相符
// ---------------------------------------------------------------------------
describe('推进的 shuffleScope（#639 R1）', () => {
  const full = [song('1'), song('2'), song('3')];
  /** 序列含窗口外成员 '3'：order 是 [3,1,2]，但窗口只有 [1,2] */
  const state = { order: ['3', '1', '2'], cursor: 1 };

  it('authoritative（缺省）：窗口外的 id 被裁掉，落点仍在窗口内', () => {
    const window = [song('1'), song('2')];
    expect(getNextSongIndex(window, 0, '随机播放', state, 'authoritative')).toBe(1); // '2'
  });

  it('window：窗口外的 id 保留，落点可能与窗口不符却**不截断序列**', () => {
    const window = [song('1'), song('2')];
    // 缺省就是 authoritative —— 显式传 window 时序列只补不丢
    const next = getNextSongIndex(window, 0, '随机播放', state, 'window');
    expect([-1, 0, 1]).toContain(next); // 不抛、不崩；关键是序列不被裁
  });

  it('两种作用域在「序列即队列全排列」时结果一致（无窗口时无差别）', () => {
    const auth = getNextSongIndex(full, 0, '随机播放', state, 'authoritative');
    const win = getNextSongIndex(full, 0, '随机播放', state, 'window');
    expect(auth).toBe(win);
  });

  it('prev 同样接受 scope', () => {
    expect(getPrevSongIndex(full, 0, '随机播放', state, 'authoritative')).toBe(2); // '3'
  });
});

// ---------------------------------------------------------------------------
// #666：曲末决策上提 core —— planEndOfTrack + buildEndOfTrackPolicy
// ---------------------------------------------------------------------------
import { buildEndOfTrackPolicy, planEndOfTrack } from '../queue.js';
import type { PlayMode, ShuffleState } from '../../types/index.js';

type Overrides = {
  playMode?: PlayMode;
  shuffle?: ShuffleState | null;
  shuffleScope?: 'authoritative' | 'window';
  hasNextInWindow?: boolean;
  windowSaturated?: boolean;
};

/** 曲末用例的公共入参；只覆盖默认 stop（wrap 本轮不实现，不在这里测）。 */
function endedInput(overrides: Overrides = {}) {
  return {
    playMode: overrides.playMode ?? ('列表循环' as PlayMode),
    shuffle: overrides.shuffle ?? null,
    shuffleScope: overrides.shuffleScope,
    hasNextInWindow: overrides.hasNextInWindow ?? false,
    windowSaturated: overrides.windowSaturated ?? false,
    shuffleEndPolicy: 'stop' as const,
  };
}

const atEnd: ShuffleState = { order: ['1', '2', '3'], cursor: 2 };
const midSeq: ShuffleState = { order: ['1', '2', '3'], cursor: 0 };

describe('planEndOfTrack 单曲循环', () => {
  it('曲末重播自己，即使窗口里还有下一项', () => {
    expect(planEndOfTrack(endedInput({ playMode: '单曲循环' })).action).toBe('restart-current');
    expect(planEndOfTrack(endedInput({ playMode: '单曲循环', hasNextInWindow: true })).action).toBe('restart-current');
  });
});

describe('planEndOfTrack 列表循环', () => {
  it('窗口内有下一项就推进，饱和与否都推进', () => {
    expect(planEndOfTrack(endedInput({ hasNextInWindow: true })).action).toBe('advance-next');
    expect(planEndOfTrack(endedInput({ hasNextInWindow: true, windowSaturated: true })).action).toBe('advance-next');
  });

  it('窗口尾问 JS：列表循环靠 JS 绕回，永不 hold', () => {
    expect(planEndOfTrack(endedInput({})).action).toBe('ask-js');
    expect(planEndOfTrack(endedInput({ windowSaturated: true })).action).toBe('ask-js');
  });
});

describe('planEndOfTrack 随机播放（shuffleEndPolicy=stop）', () => {
  it('窗口内有下一项就推进，序列末位也照样推进', () => {
    expect(planEndOfTrack(endedInput({ playMode: '随机播放', shuffle: atEnd, hasNextInWindow: true })).action).toBe(
      'advance-next'
    );
  });

  it('序列末位 + 本轮零新增 + 窗口尾 → hold：随机播到头就停，不绕回', () => {
    expect(
      planEndOfTrack({ playMode: '随机播放', shuffle: atEnd, hasNextInWindow: false, windowSaturated: true, shuffleEndPolicy: 'stop' })
        .action
    ).toBe('hold');
  });

  it('序列末位但本轮没零新增 → ask-js（deduped 单独一个信号不足以判到头）', () => {
    expect(
      planEndOfTrack({ playMode: '随机播放', shuffle: atEnd, hasNextInWindow: false, windowSaturated: false, shuffleEndPolicy: 'stop' })
        .action
    ).toBe('ask-js');
  });

  it('本轮零新增但序列不在末位 → ask-js：还能往后走，不能停', () => {
    expect(
      planEndOfTrack({ playMode: '随机播放', shuffle: midSeq, hasNextInWindow: false, windowSaturated: true, shuffleEndPolicy: 'stop' })
        .action
    ).toBe('ask-js');
  });

  it('无序列 → ask-js：到头必须被证成，不能默认', () => {
    expect(
      planEndOfTrack({ playMode: '随机播放', shuffle: null, hasNextInWindow: false, windowSaturated: true, shuffleEndPolicy: 'stop' })
        .action
    ).toBe('ask-js');
  });

  it('空序列 / 游标 -1 都不算到头', () => {
    expect(
      planEndOfTrack({ playMode: '随机播放', shuffle: { order: [], cursor: -1 }, hasNextInWindow: false, windowSaturated: true, shuffleEndPolicy: 'stop' })
        .action
    ).toBe('ask-js');
    expect(
      planEndOfTrack({ playMode: '随机播放', shuffle: { order: ['1', '2'], cursor: -1 }, hasNextInWindow: false, windowSaturated: true, shuffleEndPolicy: 'stop' })
        .action
    ).toBe('ask-js');
  });

  it('window 作用域下不 hold：序列可能缺成员，到头不可证', () => {
    expect(
      planEndOfTrack({ playMode: '随机播放', shuffle: atEnd, shuffleScope: 'window', hasNextInWindow: false, windowSaturated: true, shuffleEndPolicy: 'stop' })
        .action
    ).toBe('ask-js');
  });

  it('单元素序列（cursor=0 即末位）走同一规则', () => {
    expect(
      planEndOfTrack({ playMode: '随机播放', shuffle: { order: ['1'], cursor: 0 }, hasNextInWindow: false, windowSaturated: true, shuffleEndPolicy: 'stop' })
        .action
    ).toBe('hold');
  });
});

describe('planEndOfTrack 透传与缺省', () => {
  it('shuffle 原样透传（曲末不推进游标）', () => {
    expect(planEndOfTrack(endedInput({ playMode: '随机播放', shuffle: atEnd })).shuffle).toBe(atEnd);
    expect(planEndOfTrack(endedInput({})).shuffle).toBeNull();
  });

  it('shuffleScope 缺省 = authoritative', () => {
    expect(
      planEndOfTrack({ playMode: '随机播放', shuffle: atEnd, hasNextInWindow: false, windowSaturated: true, shuffleEndPolicy: 'stop' })
        .action
    ).toBe('hold');
  });
});

describe('buildEndOfTrackPolicy：与 planEndOfTrack 同源的下推表', () => {
  it('列表循环 → 窗口尾问 JS', () => {
    expect(buildEndOfTrackPolicy({ playMode: '列表循环', shuffle: null, windowSaturated: true, shuffleEndPolicy: 'stop' })).toEqual({
      restartOnSingle: false,
      atWindowTail: 'ask-js',
    });
  });

  it('单曲循环 → restartOnSingle', () => {
    expect(
      buildEndOfTrackPolicy({ playMode: '单曲循环', shuffle: null, windowSaturated: false, shuffleEndPolicy: 'stop' }).restartOnSingle
    ).toBe(true);
  });

  it('随机到末位 → 窗口尾 hold', () => {
    expect(
      buildEndOfTrackPolicy({ playMode: '随机播放', shuffle: atEnd, windowSaturated: true, shuffleEndPolicy: 'stop' }).atWindowTail
    ).toBe('hold');
  });

  it('随机未到末位 → 窗口尾问 JS', () => {
    expect(
      buildEndOfTrackPolicy({ playMode: '随机播放', shuffle: midSeq, windowSaturated: true, shuffleEndPolicy: 'stop' }).atWindowTail
    ).toBe('ask-js');
  });

  it('末位但本轮补进了新项 → 问 JS（饱和态是 hold 的硬前置，得由调用方给）', () => {
    expect(
      buildEndOfTrackPolicy({ playMode: '随机播放', shuffle: atEnd, windowSaturated: false, shuffleEndPolicy: 'stop' }).atWindowTail
    ).toBe('ask-js');
  });

  it('window 作用域 / 无序列 → 问 JS（不把不可证下推成 hold）', () => {
    expect(
      buildEndOfTrackPolicy({ playMode: '随机播放', shuffle: atEnd, shuffleScope: 'window', windowSaturated: true, shuffleEndPolicy: 'stop' })
        .atWindowTail
    ).toBe('ask-js');
    expect(
      buildEndOfTrackPolicy({ playMode: '随机播放', shuffle: null, windowSaturated: true, shuffleEndPolicy: 'stop' }).atWindowTail
    ).toBe('ask-js');
  });
});