import { create } from 'zustand';
import { SOURCE_DISPLAY_NAMES } from '@mplayer/core';
import type { SourceKey } from '@mplayer/core';

export type SourceOption = 'all' | SourceKey;

/**
 * 来源中文名（SongRow 换源菜单 / AddToPlaylistModal / 搜索结果分组共用）。
 *
 * #556 评审 C 续：这里不再维护第二份字面量，直接引用 core 的 `SOURCE_DISPLAY_NAMES`
 * （同一对象）。保留 `SOURCE_LABELS` 这个名字只是既有消费者的导入面，不再是数据副本。
 */
export const SOURCE_LABELS: Record<SourceKey, string> = SOURCE_DISPLAY_NAMES;

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
