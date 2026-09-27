import { create } from 'zustand';
import { identityKey } from '@mplayer/core';
import type { AudioTag, Song } from '@mplayer/core';

// 标签按歌曲身份键存储（utils/songIdentity：源 + 去前缀真实 ID），避免跨源 id 冲突；
// 裸 id 与换源后的带前缀 id 收敛为同一行。**写入方只有播放链路**
// （services/audioPlayer：试听版标 preview、探活失败标 invalid），所以没播放过的歌
// 永远没有徽标——#391 已退役旧的「批量探测」链路，注释曾停留在那个形态。
// SongRow 按 tagKey 精确订阅，标签变化只重渲染对应的那一行。
//
// 容量：长会话里播过的歌会一直累积，加上限 + 按写入顺序淘汰最旧（#411）。
// 标签是播放副产物，丢掉最旧的只影响「很早播过的歌不再显示徽标」，不影响任何决策。
const MAX_TAGS = 2000;
export function tagKey(song: Song): string {
  return identityKey(song);
}

interface AudioTagState {
  tags: Record<string, AudioTag>;
  setTag: (song: Song, tag: AudioTag) => void;
}

export const useAudioTagStore = create<AudioTagState>((set) => ({
  tags: {},
  setTag: (song, tag) =>
    set((s) => {
      const k = tagKey(song);
      if (s.tags[k] === tag) return s; // 无变化不触发重渲染
      const next = { ...s.tags, [k]: tag };
      // 对象字符串键保持插入顺序 → keys()[0] 就是最旧的一条
      const keys = Object.keys(next);
      if (keys.length > MAX_TAGS) {
        for (const stale of keys.slice(0, keys.length - MAX_TAGS)) delete next[stale];
      }
      return { tags: next };
    }),
}));
