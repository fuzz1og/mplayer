import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Song } from '@mplayer/core';
import { filterSongsByQuery } from '@/renderer/utils/songFilter';

export interface DetailSelection {
  filterQuery: string;
  setFilterQuery: (query: string) => void;
  isFiltering: boolean;
  /** 展示集合：过滤结果与全量都保持源顺序（清空关键词即逐项还原）。 */
  visibleSongs: Song[];
  batchMode: boolean;
  toggleBatchMode: () => void;
  selectedIds: string[];
  /** 列表组件（SongList）的受控选择集回写通道。 */
  setSelectedIds: (ids: string[]) => void;
  selectedIdSet: Set<string>;
  /** 批量动作的作用域：只认**可见**的已选项（过滤态被藏起来的选中项原样留着）。 */
  selectedSongs: Song[];
  visibleSelectedIds: string[];
  visibleSelectedCount: number;
  allVisibleSelected: boolean;
  toggleSelect: (songId: string) => void;
  selectAllVisible: () => void;
}

/**
 * 详情页的过滤 + 按需选择状态机（#694）：五个详情页共用一套语义，
 * 页面只负责把返回值交给 DetailToolbar 与列表，不再各写一份。
 */
export function useDetailSelection(songs: Song[], resetKey?: string | number): DetailSelection {
  const [filterQuery, setFilterQuery] = useState('');
  const [batchMode, setBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // 换详情对象即退出选择模式：旧选择不属于新对象，也不该拖进批量动作
  useEffect(() => {
    setSelectedIds([]);
    setBatchMode(false);
    setFilterQuery('');
  }, [resetKey]);

  const isFiltering = filterQuery.trim().length > 0;
  const visibleSongs = useMemo<Song[]>(
    () => filterSongsByQuery(songs, filterQuery) as Song[],
    [songs, filterQuery],
  );
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const visibleSelectedIds = useMemo(() => {
    if (!isFiltering) return selectedIds;
    const visibleIdSet = new Set(visibleSongs.map((song) => song.id));
    return selectedIds.filter((songId) => visibleIdSet.has(songId));
  }, [isFiltering, visibleSongs, selectedIds]);
  const selectedSongs = useMemo(
    () => visibleSongs.filter((song) => selectedIdSet.has(song.id)),
    [visibleSongs, selectedIdSet],
  );
  const allVisibleSelected = visibleSongs.length > 0 && visibleSelectedIds.length === visibleSongs.length;

  /** 选择模式单一入口：进出都从干净选择集开始。 */
  const toggleBatchMode = useCallback(() => {
    setBatchMode((prev) => !prev);
    setSelectedIds([]);
  }, []);

  const toggleSelect = useCallback((songId: string) => {
    setSelectedIds((prev) => (
      prev.includes(songId) ? prev.filter((id) => id !== songId) : [...prev, songId]
    ));
  }, []);

  /** 全选只作用于**当前可见**集合：过滤态不碰被过滤掉的项。 */
  const selectAllVisible = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const song of visibleSongs) next.delete(song.id);
      } else {
        for (const song of visibleSongs) next.add(song.id);
      }
      return [...next];
    });
  }, [allVisibleSelected, visibleSongs]);

  return {
    filterQuery,
    setFilterQuery,
    isFiltering,
    visibleSongs,
    batchMode,
    toggleBatchMode,
    selectedIds,
    setSelectedIds,
    selectedIdSet,
    selectedSongs,
    visibleSelectedIds,
    visibleSelectedCount: visibleSelectedIds.length,
    allVisibleSelected,
    toggleSelect,
    selectAllVisible,
  };
}
