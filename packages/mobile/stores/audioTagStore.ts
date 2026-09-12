import { create } from 'zustand';
import { identityKey } from '@mplayer/core';
import type { AudioTag, Song } from '@mplayer/core';

// 探测标签按歌曲身份键存储（utils/songIdentity：源 + 去前缀真实 ID），
// 避免跨源 id 冲突；裸 id 与换源后的带前缀 id 收敛为同一行，播放侧写、列表按需订阅。
// SongRow 按 tagKey 精确订阅,每批探测完成只重渲染标签变化的那几行,
// 渐进式显示标签,不等全部探测完成
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
      return { tags: { ...s.tags, [k]: tag } };
    }),
}));
