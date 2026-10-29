import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Music2 } from 'lucide-react';
import type { Song, SongGroup } from '@mplayer/core';
import SongRow from '@/renderer/components/SongRow';
import SongListSkeleton from '@/renderer/components/SongListSkeleton';
import AddToPlaylistModal from '@/renderer/components/AddToPlaylistModal';
import { usePlayerStore } from '@/renderer/store/playerStore';
import { useInfiniteScroll } from '@/renderer/hooks/useInfiniteScroll';
import { useLatest, useStableCallback } from '@/renderer/hooks/useLatest';
import { COL_VERSIONS, colWidth } from '@/renderer/components/songTableColumns';
import '@/renderer/styles/songlist.css';

const noop = () => {};

interface GroupedSongListProps {
  /** 分组数据经 props 提供（页面做 searchStore 的适配器），组件不再自己订阅数据源 */
  groups: SongGroup[];
  /** 已展开其余版本的组 key：默认扁平，一组只占一行 */
  expandedKeys: string[];
  onToggleGroup: (key: string) => void;
  currentSongId?: string;
  isPlaying?: boolean;
  favoriteIds?: string[];
  /** 点播契约（#697/D1）：回传歌曲、该组歌曲（组内队列）与组内下标；列表自身不碰 playerStore */
  onPlay: (song: Song, queue: Song[], index: number) => void;
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
 * 分组搜索结果（#694）：默认扁平——每组只渲染最相关的一版（46px 行，双击/封面播放），
 * 行尾「N 个版本」就地展开其余版本（缩进 16px）；组内点播队列 = 该组版本（D1）。
 */
const GroupedSongList: React.FC<GroupedSongListProps> = ({
  groups,
  expandedKeys,
  onToggleGroup,
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
  const [selectedSongForPlaylist, setSelectedSongForPlaylist] = useState<Song | null>(null);
  const [showAddToPlaylistModal, setShowAddToPlaylistModal] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  /** 与 SongList 同一缺省：队列真相源在 playerStore，不要求每个页面各写一遍 */
  const handlePlayNext = useMemo(
    () => onPlayNext ?? ((target: Song) => { void usePlayerStore.getState().insertNext(target); }),
    [onPlayNext],
  );

  const expandedSet = useMemo(() => new Set(expandedKeys), [expandedKeys]);
  const favoriteSet = useMemo(() => new Set(favoriteIds), [favoriteIds]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  /** 首版歌曲 id → 所属分组：行尾「N 个版本」按钮按首版行定位自己的组 */
  const primaryGroupBySongId = useMemo(() => {
    const map = new Map<string, SongGroup>();
    for (const group of groups) {
      const first = group.songs[0];
      if (first) map.set(first.id, group);
    }
    return map;
  }, [groups]);

  const latest = useLatest({ selectedIds, onSelectionChange, onPlay });
  const stableOnToggleFavorite = useStableCallback(onToggleFavorite);
  const stableOnDownload = useStableCallback(onDownload);
  const stableOnToggleGroup = useStableCallback(onToggleGroup);

  /**
   * 行尾「N 个版本」走渲染函数（元素每帧新建会击穿行 memo）；函数身份随 expandedSet 变，
   * 于是展开态一变，带按钮的首版行跟着重渲染，aria-expanded 不会停在旧值。
   * 槽位**每行都占**同一列宽：按钮有无、文案「3 个版本」还是「10 个版本」都不能挪动专辑列。
   */
  const renderActionsLead = useCallback((song: Song) => {
    const group = primaryGroupBySongId.get(song.id);
    const isExpanded = group ? expandedSet.has(group.key) : false;
    return (
      <div className="sgroup__versions-slot" style={colWidth(COL_VERSIONS)}>
        {group && group.songs.length > 1 && (
          <button
            type="button"
            className="sgroup__versions"
            aria-expanded={isExpanded}
            aria-label={`${isExpanded ? '收起' : '展开'} ${group.songs.length} 个版本`}
            onClick={(e) => { e.stopPropagation(); stableOnToggleGroup?.(group.key); }}
          >
            {group.songs.length} 个版本
          </button>
        )}
      </div>
    );
  }, [primaryGroupBySongId, expandedSet, stableOnToggleGroup]);

  const handleToggleDropdown = useCallback((songId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setActiveDropdown((prev) => (prev === songId ? null : songId));
  }, []);
  const handleCloseDropdown = useCallback(() => setActiveDropdown(null), []);
  const handleAddToPlaylistClick = useCallback((song: Song) => {
    setSelectedSongForPlaylist(song);
    setShowAddToPlaylistModal(true);
    setActiveDropdown(null);
  }, []);
  const handleToggleSelect = useCallback((songId: string) => {
    const { selectedIds: current, onSelectionChange: change } = latest.current;
    change(current.includes(songId) ? current.filter((id) => id !== songId) : [...current, songId]);
  }, [latest]);

  useInfiniteScroll(scrollRef, { onLoadMore: onLoadMore ?? noop, loading, hasMore });

  const renderRow = (group: SongGroup, song: Song, index: number) => (
    <SongRow
      key={`${group.key}:${song.id}`}
      song={song}
      index={index}
      isCurrentSong={currentSongId === song.id}
      isPlaying={currentSongId === song.id && isPlaying}
      isFavorite={favoriteSet.has(song.id)}
      showIndex={false}
      isSelected={selectedSet.has(song.id)}
      variant="library"
      fillTitle
      compactActions
      moreOpen={activeDropdown === song.id}
      queue={group.songs}
      onPlay={onPlay}
      onToggleFavorite={stableOnToggleFavorite}
      onDownload={stableOnDownload}
      onAddToPlaylist={handleAddToPlaylistClick}
      onPlayNext={handlePlayNext}
      onToggleSelect={handleToggleSelect}
      onToggleDropdown={handleToggleDropdown}
      onCloseDropdown={handleCloseDropdown}
      renderActionsLead={renderActionsLead}
    />
  );

  if (loading && groups.length === 0) {
    return <SongListSkeleton density="library" showIndex={false} />;
  }

  if (!loading && groups.length === 0) {
    return (
      <div className="grouped__empty">
        <Music2 size={26} className="grouped__empty-icon" />
        <div>暂无搜索结果</div>
      </div>
    );
  }

  return (
    <div className="grouped">
      {/* 结果区顶部只留一行轻说明：不做标题级分隔，也不再有「全部展开」大按钮 */}
      <div className="grouped__meta">{groups.length} 首 · 已按相关度排序</div>
      <div ref={scrollRef} className="grouped__scroll" data-scroll-container>
        {groups.map((group) => {
          const [primary, ...rest] = group.songs;
          if (!primary) return null;
          const expanded = expandedSet.has(group.key);
          return (
            <div className="sgroup" key={group.key}>
              {renderRow(group, primary, 0)}
              {expanded && rest.length > 0 && (
                <div className="sgroup__rest">
                  {rest.map((song, i) => renderRow(group, song, i + 1))}
                </div>
              )}
            </div>
          );
        })}
        {hasMore && loading && <div className="grouped__loading">加载中...</div>}
        {!hasMore && groups.length > 0 && <div className="grouped__loading">没有更多歌曲了</div>}
      </div>

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
