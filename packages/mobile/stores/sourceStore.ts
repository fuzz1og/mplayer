import { create } from 'zustand';
import type { SourceKey } from '@mplayer/core';

export type SourceOption = 'all' | SourceKey;

// 全项目唯一的来源中文名（SongRow 换源菜单 / AddToPlaylistModal / 搜索结果分组共用）
export const SOURCE_LABELS: Record<SourceKey, string> = {
  netease: '网易云',
  qq: 'QQ音乐',
  kugou: '酷狗',
  kuwo: '酷我',
  migu: '咪咕',
  qianqian: '千千',
  soda: '汽水',
  local: '本地',
};

/** 含「全部」选项的标签（搜索页源选择器用） */
export const SOURCE_OPTION_LABELS: Record<SourceOption, string> = { all: '全部', ...SOURCE_LABELS };

interface SourceState {
  selectedSource: SourceOption;
  setSelectedSource: (source: SourceOption) => void;
}

export const useSourceStore = create<SourceState>((set) => ({
  selectedSource: 'all',
  setSelectedSource: (source) => set({ selectedSource: source }),
}));
