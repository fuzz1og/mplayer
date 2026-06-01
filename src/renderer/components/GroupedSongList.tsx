import React, { useState, useCallback, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Song, SongGroup } from '@/shared/types/song';
import GroupHeaderRow from '@/renderer/components/GroupHeaderRow';
import SongRow from '@/renderer/components/SongRow';
import SongListSkeleton from '@/renderer/components/SongListSkeleton';
import { useSearchStore } from '@/renderer/store/searchStore';
import { usePlayerStore } from '@/renderer/store/playerStore';
import { useFavoriteStore } from '@/renderer/store/favoriteStore';

type FlatItem =
  | { type: 'group'; group: SongGroup }
  | { type: 'song'; groupKey: string; song: Song; index: number };

interface GroupedSongListProps {
  onPlay: (song: Song) => void;
  onAddToPlaylist: (song: Song) => void;
  onToggleFavorite: (song: Song) => void;
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
  loading?: boolean;
}

const GroupedSongList: React.FC<GroupedSongListProps> = ({
  onPlay,
  onAddToPlaylist,
  onToggleFavorite,
  selectedIds,
  onSelectionChange,
  loading = false,
}) => {
  const groups = useSearchStore(s => s.groups);
  const expandedKeys = useSearchStore(s => s.expandedKeys);
  const toggleGroup = useSearchStore(s => s.toggleGroup);
  const expandAll = useSearchStore(s => s.expandAll);
  const collapseAll = useSearchStore(s => s.collapseAll);

  const currentSong = usePlayerStore(s => s.currentSong);
  const isPlaying = usePlayerStore(s => s.isPlaying);
  const favoriteIds = useFavoriteStore(s => s.favoriteIds);

  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const flatItems = useMemo(() => {
    const items: FlatItem[] = [];
    for (const group of groups) {
      items.push({ type: 'group', group });
      if (expandedKeys.includes(group.key)) {
        for (let i = 0; i < group.songs.length; i++) {
          items.push({ type: 'song', groupKey: group.key, song: group.songs[i], index: i });
        }
      }
    }
    return items;
  }, [groups, expandedKeys]);

  const rowVirtualizer = useVirtualizer({
    count: flatItems.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => {
      const item = flatItems[index];
      return item.type === 'group' ? 44 : 52;
    },
    overscan: 5,
  });

  const handleToggleDropdown = useCallback((songId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setActiveDropdown(prev => prev === songId ? null : songId);
  }, []);

  const handleCloseDropdown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setActiveDropdown(null);
  }, []);

  const handlePlayFirst = useCallback((group: SongGroup) => {
    if (group.songs.length > 0) {
      onPlay(group.songs[0]);
    }
  }, [onPlay]);

  const handleSongPlay = useCallback((song: Song) => {
    onPlay(song);
  }, [onPlay]);

  const handleToggleSelect = useCallback((songId: string) => {
    if (selectedIds.includes(songId)) {
      onSelectionChange(selectedIds.filter(id => id !== songId));
    } else {
      onSelectionChange([...selectedIds, songId]);
    }
  }, [selectedIds, onSelectionChange]);

  const allExpanded = groups.length > 0 && expandedKeys.length === groups.length;

  const toggleAll = useCallback(() => {
    if (allExpanded) {
      collapseAll();
    } else {
      expandAll();
    }
  }, [allExpanded, expandAll, collapseAll]);

  const favoriteSet = useMemo(() => new Set(favoriteIds), [favoriteIds]);

  if (loading && groups.length === 0) {
    return <SongListSkeleton showCheckbox={true} showIndex={false} />;
  }

  if (!loading && groups.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 20px', color: 'var(--text-tertiary)' }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>🎵</div>
        <div style={{ fontSize: '14px' }}>暂无搜索结果</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '4px 16px 8px' }}>
        <button
          onClick={toggleAll}
          style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '12px', color: 'var(--accent-color)', fontWeight: 500 }}
        >
          {allExpanded ? '全部折叠' : '全部展开'}
        </button>
      </div>
      <div ref={scrollRef} style={{ overflow: 'auto', flex: 1 }}>
        <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
          {rowVirtualizer.getVirtualItems().map(virtualItem => {
            const item = flatItems[virtualItem.index];
            if (item.type === 'group') {
              return (
                <GroupHeaderRow
                  key={item.group.key}
                  group={item.group}
                  isExpanded={expandedKeys.includes(item.group.key)}
                  onToggle={() => toggleGroup(item.group.key)}
                  onPlayFirst={() => handlePlayFirst(item.group)}
                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: `${virtualItem.size}px`, transform: `translateY(${virtualItem.start}px)` }}
                />
              );
            }
            return (
              <SongRow
                key={`${item.groupKey}-${item.index}`}
                song={item.song}
                index={item.index}
                isCurrentSong={currentSong?.id === item.song.id}
                isPlaying={currentSong?.id === item.song.id && isPlaying}
                isFavorite={favoriteSet.has(item.song.id)}
                showIndex={false}
                showCheckbox={true}
                isSelected={selectedIds.includes(item.song.id)}
                showRemoveFromPlaylist={false}
                activeDropdown={activeDropdown}
                onPlay={handleSongPlay}
                onToggleFavorite={onToggleFavorite}
                onDownload={undefined}
                onAddToPlaylist={onAddToPlaylist}
                onToggleSelect={handleToggleSelect}
                onToggleDropdown={handleToggleDropdown}
                onCloseDropdown={handleCloseDropdown}
                compact={true}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: `${virtualItem.size}px`, transform: `translateY(${virtualItem.start}px)` }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default GroupedSongList;
