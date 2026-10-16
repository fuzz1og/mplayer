import { describe, expect, it } from 'vitest';
import type { Song } from '@mplayer/core';
import { planQueueState, type QueueState } from '../store/queueState';

function song(id: string): Song {
  return { id, name: id, artist: 'a', album: '', duration: 100, sourceType: 'netease', url: '', cover: '', lrc: '' };
}

const ids = (songs: readonly Song[]) => songs.map((s) => s.id);
const q = (...list: string[]) => list.map(song);

function state(over: Partial<QueueState> = {}): QueueState {
  return { playlist: q('A', 'B', 'C'), index: 0, shuffle: null, playMode: '列表循环', ...over };
}

describe('planQueueState（#639 C1：队列状态转移的唯一入口）', () => {
  it('align：没有序列就保持 null（纯成员增删不凭空造序列）', () => {
    const next = planQueueState(state(), { playlist: q('A', 'B'), index: 0, policy: 'align' });

    expect(next.shuffle).toBeNull();
    expect(ids(next.playlist)).toEqual(['A', 'B']);
    expect(next.index).toBe(0);
  });

  it('align：有序列则游标对到当前曲，**不重洗**', () => {
    const s = state({ shuffle: { order: ['C', 'A', 'B'], cursor: 0 }, index: 1 }); // 当前 B
    const next = planQueueState(s, { playlist: q('A', 'B', 'C'), index: 1, policy: 'align' });

    expect(next.shuffle?.order).toEqual(['C', 'A', 'B']); // 顺序不变
    expect(next.shuffle?.cursor).toBe(2); // 对到 B
  });

  it('locate：随机模式下没有序列 → 现洗一份且游标落当前曲', () => {
    const s = state({ playMode: '随机播放', index: 1 });
    const next = planQueueState(s, { playlist: q('A', 'B', 'C'), index: 1, policy: 'locate' });

    expect(next.shuffle).not.toBeNull();
    expect(next.shuffle?.order).toHaveLength(3);
    expect(next.shuffle?.order[next.shuffle!.cursor]).toBe('B');
  });

  it('locate：非随机模式没有序列 → 保持 null（列表循环不需要序列）', () => {
    const s = state({ playMode: '列表循环' });
    const next = planQueueState(s, { playlist: q('A', 'B', 'C'), index: 1, policy: 'locate' });

    expect(next.shuffle).toBeNull();
  });

  it('settle：原样接受调用方给的权威序列（游标值归 core，不再推导）', () => {
    const settled = { order: ['B', 'C', 'A'], cursor: 1 };
    const next = planQueueState(state({ playMode: '随机播放' }), {
      playlist: q('A', 'B', 'C'), index: 2, policy: 'settle', settled,
    });

    expect(next.shuffle).toBe(settled); // 同一个对象引用，未被改写
    expect(next.index).toBe(2);
  });

  it('reseed：同一批歌 → 不重洗，只对齐', () => {
    const s = state({ shuffle: { order: ['C', 'A', 'B'], cursor: 0 }, playMode: '随机播放' });
    const next = planQueueState(s, { playlist: q('C', 'A', 'B'), index: 0, policy: 'reseed' });

    expect(next.shuffle?.order).toEqual(['C', 'A', 'B']);
  });

  it('reseed：整批换歌单 → 重洗一份', () => {
    const s = state({ shuffle: { order: ['C', 'A', 'B'], cursor: 0 }, playMode: '随机播放' });
    const next = planQueueState(s, { playlist: q('X', 'Y', 'Z'), index: 0, policy: 'reseed' });

    expect(next.shuffle?.order).toHaveLength(3);
    expect([...next.shuffle!.order].sort()).toEqual(['X', 'Y', 'Z']);
  });

  it('replace-id：序列里就地换 id，顺序与格位不变、游标仍对当前曲', () => {
    const s = state({ shuffle: { order: ['C', 'A', 'B'], cursor: 2 }, playMode: '随机播放' }); // 当前 B
    const next = planQueueState(s, {
      playlist: q('A', 'B2', 'C'), index: 1, policy: 'replace-id', replaceId: { from: 'B', to: 'B2' },
    });

    expect(next.shuffle?.order).toEqual(['C', 'A', 'B2']); // 同一格换 id
    expect(next.shuffle?.order[next.shuffle!.cursor]).toBe('B2');
  });

  it('mode：进随机 → 确保有序列且游标落当前曲', () => {
    const next = planQueueState(state({ playMode: '列表循环' }), {
      playlist: q('A', 'B', 'C'), index: 2, policy: 'mode', playMode: '随机播放',
    });

    expect(next.playMode).toBe('随机播放');
    expect(next.shuffle).not.toBeNull();
    expect(next.shuffle?.order[next.shuffle!.cursor]).toBe('C');
  });

  it('mode：换回列表循环 → 序列保留但不参与（不删）', () => {
    const held = { order: ['C', 'A', 'B'], cursor: 0 };
    const next = planQueueState(state({ shuffle: held, playMode: '随机播放' }), {
      playlist: q('A', 'B', 'C'), index: 0, policy: 'mode', playMode: '列表循环',
    });

    expect(next.shuffle).toBe(held);
  });

  it('三元组一定自洽：`index` 与 `shuffle.cursor` 指向同一首歌', () => {
    const s = state({ shuffle: { order: ['C', 'A', 'B'], cursor: 0 }, playMode: '随机播放' });
    // 这是本模块存在的理由：调用方拿到的 index 与 shuffle 不可能指向两首不同的歌
    for (const [idx, pl] of [[0, q('A', 'B', 'C')], [1, q('B', 'C', 'A')], [2, q('C', 'A', 'B')]] as const) {
      const next = planQueueState(s, { playlist: pl, index: idx, policy: 'align' });
      const cursorSongId = next.shuffle?.order[next.shuffle.cursor];
      expect(cursorSongId).toBe(next.playlist[next.index]?.id);
    }
  });
});
