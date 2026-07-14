import { create } from 'zustand';
import type { SourceKey } from '@mplayer/core';

export type SourceOption = 'all' | SourceKey;

const SOURCE_LABELS: Record<SourceOption, string> = {
  all: '全部',
  netease: '网易云',
  qq: 'QQ音乐',
  kugou: '酷狗',
  migu: '咪咕',
  kuwo: '酷我',
  qianqian: '千千',
  soda: '汽水',
  local: '本地',
};

export { SOURCE_LABELS };

interface SourceState {
  selectedSource: SourceOption;
  setSelectedSource: (source: SourceOption) => void;
}

export const useSourceStore = create<SourceState>((set) => ({
  selectedSource: 'all',
  setSelectedSource: (source) => set({ selectedSource: source }),
}));
