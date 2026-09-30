import React, { useCallback, useMemo, useState } from 'react';
import { Music2 } from 'lucide-react';
import type { Song, SongGroup } from '@mplayer/core';
import GroupHeaderRow from '@/renderer/components/GroupHeaderRow';
import SongRow from '@/renderer/components/SongRow';
import VirtualRow from '@/renderer/components/VirtualRow';
import SongListSkeleton from '@/renderer/components/SongListSkeleton';
import AddToPlaylistModal from '@/renderer/components/AddToPlaylistModal';
import { usePlayerStore } from '@/renderer/store/playerStore';
import { useInfiniteScroll } from '@/renderer/hooks/useInfiniteScroll';
import { useLatest, useStableCallback } from '@/renderer/hooks/useLatest';
import { useVirtualRows, SONG_ROW_HEIGHT } from '@/renderer/hooks/useVirtualRows';

type FlatItem =
  | { type: 'group'; group: SongGroup }
  | { type: 'song'; groupKey: string; song: Song; index: number };

const GROUP_HEADER_HEIGHT = 44;
const noop = () => {};

interface GroupedSongListProps {
  /** 分组数据经 props 提供（页面做 searchStore 的适配器），组件不再自己订阅数据源 */
  groups: SongGroup[];
  expandedKeys: string[];
  onToggleGroup: (key: string) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  currentSongId?: string;
  isPlaying?: boolean;
  favoriteIds?: string[];
  onPlay: (song: Song) => void;
  /** 「下一首播放」（#491）：缺省直接用 playerStore.insertNext（与 SongList 同一缺省） */
  onPlayNext?: (song: Song) => void;
  onToggleFavorite: (song: Song) => void;
  onDownload?: (song: Song) => void;
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
  loading?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
}

/**
 * 分组歌曲列表：与 SongList 共用同一套滚动/测量（useVirtualRows）与行实现（SongRow），
 * 只多一层「组头 + 组内歌曲」的扁平化数据。
 */
const GroupedSongList: React.FC<GroupedSongListProps> = ({
  groups,
  expandedKeys,
  onToggleGroup,
  onExpandAll,
  onCollapseAll,
  currentSongId,
  isPlaying = false,
  favoriteIds = [],
  onPlay,
  onPlayNext,
  onToggleFavorite,
  onDownload,
  selectedIds,
  onSelectionChange,
  loading = false,
  hasMore = false,
  onLoadMore,
}) => {
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  /** 与 SongList 同一缺省：队列真相源在 playerStore，不要求每个页面各写一遍 */
  const handlePlayNext = useMemo(
    () => onPlayNext ?? ((target: Song) => { void usePlayerStore.getState().insertNext(target); }),
    [onPlayNext],
  );
  const [selectedSongForPlaylist, setSelectedSongForPlaylist] = useState<Song | null>(null);
  const [showAddToPlaylistModal, setShowAddToPlaylistModal] = useState(false);

  const expandedSet = useMemo(() => new Set(expandedKeys), [expandedKeys]);
  const favoriteSet = useMemo(() => new Set(favoriteIds), [favoriteIds]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const flatItems = useMemo(() => {
    const items: FlatItem[] = [];
    for (const group of groups) {
      items.push({ type: 'group', group });
      if (expandedSet.has(group.key)) {
        for (let i = 0; i < group.songs.length; i++) {
          items.push({ type: 'song', groupKey: group.key, song: group.songs[i], index: i });
        }
      }
    }
    return items;
  }, [groups, expandedSet]);

  const latest = useLatest({ selectedIds, onSelectionChange, onPlay });

  const stableOnToggleGroup = useStableCallback(onToggleGroup);
  const stableOnExpandAll = useStableCallback(onExpandAll);
  const stableOnCollapseAll = useStableCallback(onCollapseAll);
  const stableOnToggleFavorite = useStableCallback(onToggleFavorite);
  const stableOnDownload = useStableCallback(onDownload);

  const handleToggleDropdown = useCallback((songId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setActiveDropdown(prev => prev === songId ? null : songId);
  }, []);

  const handleCloseDropdown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setActiveDropdown(null);
  }, []);

  const handleAddToPlaylistClick = useCallback((song: Song) => {
    setSelectedSongForPlaylist(song);
    setShowAddToPlaylistModal(true);
    setActiveDropdown(null);
  }, []);

  const handlePlayFirst = useCallback((group: SongGroup) => {
    if (group.songs.length > 0) {
      latest.current.onPlay(group.songs[0]);
    }
  }, [latest]);

  const handleToggleSelect = useCallback((songId: string) => {
    const { selectedIds: current, onSelectionChange: change } = latest.current;
    change(current.includes(songId) ? current.filter(id => id !== songId) : [...current, songId]);
  }, [latest]);

  const allExpanded = groups.length > 0 && expandedKeys.length === groups.length;

  const toggleAll = useCallback(() => {
    if (allExpanded) {
      stableOnCollapseAll?.();
    } else {
      stableOnExpandAll?.();
    }
  }, [allExpanded, stableOnExpandAll, stableOnCollapseAll]);

  // 滚动/测量归模块：挂靠页面已有的滚动容器（本组件的 overflow:auto 容器），并按组头/歌曲高度虚拟化
  const virtual = useVirtualRows({
    count: flatItems.length,
    enabled: flatItems.length > 0,
    estimateSize: useCallback(
      (index: number) => (flatItems[index]?.type === 'group' ? GROUP_HEADER_HEIGHT : SONG_ROW_HEIGHT),
      [flatItems],
    ),
    overscan: 5,
  });

  useInfiniteScroll(virtual.scrollElement, { onLoadMore: onLoadMore ?? noop, loading, hasMore });

  if (loading && groups.length === 0) {
    return <SongListSkeleton showCheckbox={true} showIndex={false} />;
  }

  if (!loading && groups.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 20px', color: 'var(--text-tertiary)' }}>
        <Music2 size={26} style={{ marginBottom: '12px', color: 'var(--text-tertiary)' }} />
        <div style={{ fontSize: '14px' }}>暂无搜索结果</div>
      </div>
    );
  }

  /**
   * 虚拟化行的**定位**不再当 `style` prop 传给行组件（#412）。`SongRow`/`GroupHeaderRow`
   * 都是 `React.memo`，而每行每帧都新建一个 style 对象等于给它们塞一个永远不相等的 prop，
   * memo 形同虚设。这里把定位收进一个只吃**数字**的 memo 包裹层，行组件拿到的 props
   * 就只剩它自己的数据。
   */
  const renderItem = (item: FlatItem) => {
    if (item.type === 'group') {
      return (
        <GroupHeaderRow
          key={item.group.key}
          group={item.group}
          isExpanded={expandedSet.has(item.group.key)}
          onToggle={stableOnToggleGroup ?? noop}
          onPlayFirst={handlePlayFirst}
        />
      );
    }
    return (
      <SongRow
        key={`${item.groupKey}-${item.song.id}`}
        song={item.song}
        index={item.index}
        isCurrentSong={currentSongId === item.song.id}
        isPlaying={currentSongId === item.song.id && isPlaying}
        isFavorite={favoriteSet.has(item.song.id)}
        showIndex={false}
        isSelected={selectedSet.has(item.song.id)}
        moreOpen={activeDropdown === item.song.id}
        onPlay={onPlay}
        onToggleFavorite={stableOnToggleFavorite}
        onDownload={stableOnDownload}
        onAddToPlaylist={handleAddToPlaylistClick}
        onPlayNext={handlePlayNext}
        onToggleSelect={handleToggleSelect}
        onToggleDropdown={handleToggleDropdown}
        onCloseDropdown={handleCloseDropdown}
        compact={false}
      />
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px 10px' }}>
        <span style={{ fontSize: '13px', color: 'var(--text-tertiary)' }}>{groups.length} 组结果</span>
        <button
          onClick={toggleAll}
          style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 12px', borderRadius: '999px', border: '1px solid var(--border-default)', background: 'transparent', color: 'var(--text-secondary)', fontSize: '13px', fontWeight: 500, cursor: 'pointer', transition: 'background 0.15s ease' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          {allExpanded ? '全部折叠' : '全部展开'}
        </button>
      </div>
      <div style={{ overflow: 'auto', flex: 1 }}>
        <div
          ref={virtual.rowsRef}
          style={virtual.mode === 'virtual' ? { position: 'relative', height: `${virtual.totalSize}px`, width: '100%' } : undefined}
        >
          {virtual.mode === 'pending'
            ? null
            : virtual.mode === 'virtual'
              ? virtual.items.map((virtualItem) => {
                  const item = flatItems[virtualItem.index];
                  if (!item) return null;
                  return (
                    <VirtualRow
                      key={item.type === 'group' ? item.group.key : `${item.groupKey}-${item.song.id}`}
                      start={virtualItem.start}
                      size={virtualItem.size}
                      scrollMargin={virtual.scrollMargin}
                    >
                      {renderItem(item)}
                    </VirtualRow>
                  );
                })
              : flatItems.map((item) => renderItem(item))}
        </div>
        {hasMore && loading && (
          <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '13px' }}>
            加载中...
          </div>
        )}
        {!hasMore && groups.length > 0 && (
          <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '13px' }}>
            没有更多歌曲了
          </div>
        )}
      </div>

      {/* 加入歌单弹窗 */}
      {selectedSongForPlaylist && (
        <AddToPlaylistModal
          song={selectedSongForPlaylist}
          isVisible={showAddToPlaylistModal}
          onClose={() => {
            setShowAddToPlaylistModal(false);
            setSelectedSongForPlaylist(null);
          }}
          onSuccess={() => {}}
        />
      )}
    </div>
  );
};

export default GroupedSongList;
