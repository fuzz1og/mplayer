import React, { useState, useCallback, useMemo } from 'react';
import '@/renderer/styles/songlist.css';
import { Download, Trash2, Music2, CheckSquare, CirclePlus } from 'lucide-react';
import type { Song } from '@mplayer/core';
import AddToPlaylistModal from './AddToPlaylistModal';
import { usePlayerStore } from '@/renderer/store/playerStore';
import BatchAddToPlaylistModal from './BatchAddToPlaylistModal';
import SongRow from './SongRow';
import SongListSkeleton from './SongListSkeleton';
import VirtualRow from './VirtualRow';
import { useLatest, useStableCallback } from '@/renderer/hooks/useLatest';
import { useVirtualRows, stickyTopForContent, VIRTUALIZE_THRESHOLD } from '@/renderer/hooks/useVirtualRows';
import {
  COL_CHECKBOX,
  COL_ALBUM,
  COL_ACTIONS,
  COL_ACTIONS_COMPACT,
  COL_DURATION,
  COL_DURATION_LIBRARY,
  colWidth,
  songIndexWidth,
} from '@/renderer/components/songTableColumns';
import { songRowCoverSize, songRowHeight } from '@/renderer/components/songRowMetrics';

interface SongListProps {
  songs: Song[];
  currentSongId?: string;
  isPlaying?: boolean;
  favoriteIds?: string[];
  /** 点播契约（#697）：回传歌曲、当前展示队列与行下标；列表自身不碰 playerStore */
  onPlay: (song: Song, queue: Song[], index: number) => void;
  onToggleFavorite?: (song: Song) => void;
  /**
   * 列表密度。standard（默认）= 64px 通用行；library = 资料库密度（46px、30px 封面、
   * 无表头、行操作 hover/focus 才出现、行尾单个「更多」按钮）。
   */
  density?: 'standard' | 'library';
  /** 显式表头开关；缺省 standard 显示、library 不显示 */
  showHeader?: boolean;
  showIndex?: boolean;
  showCheckbox?: boolean;
  selectedIds?: string[];
  onSelectionChange?: (selectedIds: string[]) => void;
  emptyText?: string;
  loading?: boolean;
  enableBatchDownload?: boolean;
  onBatchDownload?: (songs: Song[]) => void;
  onDownload?: (song: Song) => void;
  enableBatchDelete?: boolean;
  onBatchDelete?: (songs: Song[]) => void;
  onAddToPlaylist?: (song: Song) => void;
  /**
   * 「下一首播放」（#491）：缺省直接用 playerStore.insertNext（所有列表统一获得该动作）。
   * 页面只有在需要自己的簿记时才传。
   */
  onPlayNext?: (song: Song) => void;
  /**
   * 批量加入歌单（#562）：**只开这一个开关就能用**——弹窗与写入都在本组件内部闭环
   * （`BatchAddToPlaylistModal` 自己走桌面 adapter 落盘）。此前点击还要求同时传
   * `onBatchAddToPlaylist`，于是只传开关的四个页面渲染出一个点了没反应的死按钮。
   */
  enableBatchAddToPlaylist?: boolean;
  /** 批量加入**成功**后的通知（可选）。页面别在这里再开一个弹窗——弹窗归本组件。 */
  onBatchAddToPlaylist?: (songs: Song[]) => void;
  showRemoveFromPlaylist?: boolean;
  onRemoveFromPlaylist?: (song: Song) => void;
  /** 换源成功回调：父组件用它更新自己的列表 state（收藏/歌单页同时持久化） */
  onSwap?: (original: Song, swapped: Song) => void;
  /** 封面加载失败时回调，由持有歌曲列表的层按 ID 重识别换新封面 */
  onCoverError?: (song: Song) => void;
  /** 是否显示时长列（固定 50px；资料库密度启用） */
  showDuration?: boolean;
  /** 专辑列：缺省按「列表里是否有专辑」自动决定；详情页传 false 收掉整列（不重复整行相同专辑名） */
  showAlbum?: boolean;
}

/**
 * 歌曲列表模块（桌面）。独占：虚拟滚动与滚动测量、选中/收藏的 O(1) 索引、
 * 行级交互（下拉菜单 / 换源 / 勾选 / 批量栏 / 加入歌单弹窗）。
 * 页面只提供数据与语义回调，不需要知道虚拟化与测量。
 */
const SongList: React.FC<SongListProps> = ({
  songs,
  currentSongId,
  isPlaying,
  favoriteIds = [],
  onPlay,
  onToggleFavorite,
  density = 'standard',
  showHeader: showHeaderProp,
  showIndex = true,
  showCheckbox = false,
  selectedIds: externalSelectedIds,
  onSelectionChange: externalOnSelectionChange,
  emptyText = '暂无歌曲',
  loading = false,
  enableBatchDownload = false,
  onBatchDownload,
  onDownload,
  enableBatchDelete = false,
  onBatchDelete,
  onAddToPlaylist,
  onPlayNext,
  enableBatchAddToPlaylist = false,
  onBatchAddToPlaylist,
  showRemoveFromPlaylist = false,
  onRemoveFromPlaylist,
  onSwap,
  onCoverError,
  showDuration = false,
  showAlbum,
}) => {
  // library 密度默认无表头；显式 showHeader 才渲染
  const showHeader = showHeaderProp ?? density !== 'library';
  const compactActions = density === 'library';
  // 表头 / 行 / 骨架共用的列宽：资料库密度按原型收窄（序号 28 / 时长 44 / 操作 56）
  const indexWidth = songIndexWidth(density);
  const durationWidth = density === 'library' ? COL_DURATION_LIBRARY : COL_DURATION;
  const actionWidth = compactActions ? COL_ACTIONS_COMPACT : COL_ACTIONS;
  // 内部状态管理（当外部没有提供时）
  const [internalSelectedIds, setInternalSelectedIds] = useState<string[]>([]);
  // 换源后的行替换覆盖：key 为旧 id，组件生命周期内生效，
  // 页面重新从存储加载（路由重挂载）后自然失效，避免旧行复活
  const [swapOverrides, setSwapOverrides] = useState<Map<string, Song>>(() => new Map());
  // 下拉菜单状态：模块内只留「哪一行开着」这一位，行内只拿布尔量
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  // 加入歌单弹窗状态
  const [showAddToPlaylistModal, setShowAddToPlaylistModal] = useState(false);
  const [selectedSongForPlaylist, setSelectedSongForPlaylist] = useState<Song | null>(null);
  // 批量加入歌单弹窗状态
  const [showBatchAddToPlaylistModal, setShowBatchAddToPlaylistModal] = useState(false);
  const [selectedSongsForPlaylist, setSelectedSongsForPlaylist] = useState<Song[]>([]);
  // 批量管理模式：常驻「批量管理」按钮进入，勾选框与批量操作栏随之显示，「完成」退出
  const [batchMode, setBatchMode] = useState(false);

  const displaySongs = useMemo(
    () => songs.map(song => swapOverrides.get(song.id) ?? song),
    [songs, swapOverrides],
  );
  // 专辑列整列按需塌缩：列表内没有任何歌曲有专辑时不显示专辑列（详情页由调用方显式收掉）
  const hasAlbum = useMemo(() => displaySongs.some(song => song.album), [displaySongs]);
  const showAlbumColumn = showAlbum ?? hasAlbum;
  // 使用外部或内部状态
  const selectedIds = externalSelectedIds !== undefined ? externalSelectedIds : internalSelectedIds;
  const onSelectionChange = externalOnSelectionChange || setInternalSelectedIds;
  // 归属判断 O(1)：行只拿布尔量，勾选/收藏不再每行 includes 扫描
  const favoriteIdSet = useMemo(() => new Set(favoriteIds), [favoriteIds]);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  // 稳定回调的「最新值」来源：行是 React.memo，回调身份一变整表 memo 即失效
  const latest = useLatest({ selectedIds, onSelectionChange, onSwap, onPlay });
  const stableOnToggleFavorite = useStableCallback(onToggleFavorite);
  const stableOnDownload = useStableCallback(onDownload);
  const stableOnRemoveFromPlaylist = useStableCallback(onRemoveFromPlaylist);
  const stableOnCoverError = useStableCallback(onCoverError);

  const handlePlaySong = useCallback((song: Song, queue: Song[], index: number) => {
    latest.current.onPlay(song, queue, index);
  }, [latest]);

  const handleSwap = useCallback((original: Song, swapped: Song) => {
    setSwapOverrides(prev => {
      const next = new Map(prev);
      next.set(original.id, swapped);
      return next;
    });
    latest.current.onSwap?.(original, swapped);
  }, [latest]);

  const handleToggleDropdown = useCallback((songId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setActiveDropdown(prev => prev === songId ? null : songId);
  }, []);

  const handleCloseDropdown = useCallback(() => {
    setActiveDropdown(null);
  }, []);

  const handleAddToPlaylistClick = useCallback((song: Song, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setSelectedSongForPlaylist(song);
    setShowAddToPlaylistModal(true);
    setActiveDropdown(null);
  }, []);

  const handleToggleSelect = useCallback((songId: string) => {
    const { selectedIds: current, onSelectionChange: change } = latest.current;
    change(current.includes(songId) ? current.filter(id => id !== songId) : [...current, songId]);
  }, [latest]);

  /**
   *「下一首播放」缺省实现：队列真相源在 playerStore，所有用 SongList 的页面共享同一动作，
   * 不需要 8 个页面各写一遍（页面传了 onPlayNext 则以其为准）。
   * 用 useMemo 固定身份：菜单项每次渲染新建数组，但处理器身份稳定，行 memo 不受影响。
   */
  const handlePlayNext = useMemo(
    () => onPlayNext ?? ((target: Song) => { void usePlayerStore.getState().insertNext(target); }),
    [onPlayNext],
  );

  const handleAddToPlaylistSuccess = useCallback(() => {
    if (onAddToPlaylist && selectedSongForPlaylist) {
      onAddToPlaylist(selectedSongForPlaylist);
    }
  }, [onAddToPlaylist, selectedSongForPlaylist]);

  const handleToggleSelectAll = () => {
    if (selectedIds.length === displaySongs.length) {
      onSelectionChange([]);
    } else {
      onSelectionChange(displaySongs.map(song => song.id));
    }
  };

  const handleBatchDownload = () => {
    if (!onBatchDownload || selectedIds.length === 0) return;
    const selectedSongs = displaySongs.filter(song => selectedIdSet.has(song.id));
    onBatchDownload(selectedSongs);
    // 清空选择
    onSelectionChange([]);
  };

  const handleBatchDelete = () => {
    if (!onBatchDelete || selectedIds.length === 0) return;
    const selectedSongs = songs.filter(song => selectedIdSet.has(song.id));
    onBatchDelete(selectedSongs);
    // 清空选择
    onSelectionChange([]);
  };

  const handleBatchAddToPlaylist = () => {
    // #562：不要求页面传回调——弹窗在本组件内部，开了开关就该能用（回调只是成功通知）。
    if (selectedIds.length === 0) return;
    const selectedSongs = displaySongs.filter(song => selectedIdSet.has(song.id));
    setSelectedSongsForPlaylist(selectedSongs);
    setShowBatchAddToPlaylistModal(true);
  };

  // 是否显示批量操作按钮栏：批量模式下常显（未勾选时按钮禁用），否则保持勾选后浮现的旧交互
  const showBatchActionBar = (enableBatchDownload || enableBatchDelete || enableBatchAddToPlaylist) && (batchMode || selectedIds.length > 0);
  const batchDisabled = selectedIds.length === 0;

  /** 退出选择模式：清空选择（完成与取消同一状态机出口）。 */
  const handleExitBatchMode = () => {
    setBatchMode(false);
    onSelectionChange([]);
    setActiveDropdown(null);
  };

  /** 进入选择模式：从干净选择集开始，普通浏览的复选框不常驻。 */
  const handleEnterBatchMode = () => {
    setBatchMode(true);
    onSelectionChange([]);
    setActiveDropdown(null);
  };

  // 滚动/测量归模块：够长才虚拟化，挂靠页面已有的滚动容器，页面不感知。
  // 行高来自 songRowMetrics（#699）——与 CSS 变量、骨架屏是同一份协议，不在此另写 magic。
  const estimateSongRow = useCallback(() => songRowHeight(density), [density]);
  const virtual = useVirtualRows({
    count: displaySongs.length,
    enabled: displaySongs.length >= VIRTUALIZE_THRESHOLD,
    estimateSize: estimateSongRow,
  });

  // 表头贴住**内容区**上边（而不是滚动视口上边）：两者差滚动容器的 padding-top。
  // 不补这一截，带内边距的页面（发现歌单详情页等）表头会浮到内容上方，
  // 上一行从表头上方的缝里露出半截。无内边距的页面为 0，行为与原先一致。
  const headerStickyTop = stickyTopForContent(virtual.scrollElement);

  if (displaySongs.length === 0) {
    if (loading) {
      // 骨架屏必须与真实表头同列：专辑列是否显示由同一份 hasAlbum 决定，
    // 否则加载态的行比加载后窄，列错位在数据到达前看不出来。
    return (
      <SongListSkeleton
        showCheckbox={showCheckbox}
        showIndex={showIndex}
        showAlbum={showAlbumColumn}
        density={density}
        showDuration={showDuration}
      />
    );
    }
    return (
      <div className="song-list__empty">
        <Music2 size={26} className="song-list__empty-icon" />
        <div className="song-list__empty-text">{emptyText}</div>
      </div>
    );
  }

  const renderRow = (song: Song, index: number) => (
    <SongRow
      key={song.id}
      song={song}
      index={index}
      isCurrentSong={currentSongId === song.id}
      isPlaying={isPlaying ?? false}
      isFavorite={favoriteIdSet.has(song.id)}
      showIndex={showIndex}
      showCheckbox={showCheckbox || batchMode}
      isSelected={selectedIdSet.has(song.id)}
      showRemoveFromPlaylist={showRemoveFromPlaylist}
      showAlbum={showAlbumColumn}
      variant={density === 'library' ? 'library' : 'standard'}
      compactActions={compactActions}
      showDuration={showDuration}
      fillTitle={density === 'library'}
      moreOpen={activeDropdown === song.id}
      queue={displaySongs}
      onPlay={handlePlaySong}
      onToggleFavorite={stableOnToggleFavorite}
      onDownload={stableOnDownload}
      onAddToPlaylist={handleAddToPlaylistClick}
      onPlayNext={handlePlayNext}
      onRemoveFromPlaylist={stableOnRemoveFromPlaylist}
      onSwap={handleSwap}
      onCoverError={stableOnCoverError}
      onToggleSelect={handleToggleSelect}
      onToggleDropdown={handleToggleDropdown}
      onCloseDropdown={handleCloseDropdown}
    />
  );

  return (
    <div
      className="song-list"
      data-density={density}
      style={{ '--song-row-height': `${songRowHeight(density)}px`,
        '--song-row-cover': `${songRowCoverSize(density)}px` } as React.CSSProperties}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && batchMode) handleExitBatchMode();
      }}
    >
      {/* 选择模式入口：普通浏览保持安静；显式「选择」后才出现复选框与批量工具栏。
          单一切换按钮（aria-pressed 表达状态）：进入/退出不换元素，焦点不会随卸载落到 body。 */}
      {(enableBatchDownload || enableBatchDelete || enableBatchAddToPlaylist) && (
        <div className="song-list__batch-entry">
          <button
            type="button"
            className={'song-list__batch-toggle' + (batchMode ? ' song-list__batch-toggle--primary' : '')}
            aria-pressed={batchMode}
            onClick={batchMode ? handleExitBatchMode : handleEnterBatchMode}
          >
            {batchMode ? '完成' : (
              <>
                <CheckSquare size={14} />
                选择
              </>
            )}
          </button>
        </div>
      )}

      {/* 批量操作工具栏：只随选择模式出现 */}
      {(enableBatchDownload || enableBatchDelete || enableBatchAddToPlaylist) && (
        <div className="song-list__batch-wrap" data-visible={showBatchActionBar || undefined}>
          <div className="song-list__batch-bar" role="toolbar" aria-label="批量操作">
            <span className="song-list__batch-count">已选择 {selectedIds.length} 首歌曲</span>
            <div className="song-list__batch-actions">
              {enableBatchDownload && (
                <button onClick={handleBatchDownload} disabled={batchDisabled} className="song-list__batch-btn">
                  <Download size={16} />
                  批量下载
                </button>
              )}
              {enableBatchAddToPlaylist && (
                <button onClick={handleBatchAddToPlaylist} disabled={batchDisabled} className="song-list__batch-btn">
                  <CirclePlus size={16} />
                  批量加入歌单
                </button>
              )}
              {enableBatchDelete && (
                <button
                  onClick={handleBatchDelete}
                  disabled={batchDisabled}
                  className="song-list__batch-btn song-list__batch-btn--danger"
                >
                  <Trash2 size={16} />
                  批量删除
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 表头 */}
      {showHeader && (
        <div className="song-list__head" style={{ '--sticky-top': `${headerStickyTop}px` } as React.CSSProperties}>
          {(showCheckbox || batchMode) && (
            <div className="song-list__head-check" style={colWidth(COL_CHECKBOX)}>
              <input
                type="checkbox"
                checked={displaySongs.length > 0 && selectedIds.length === displaySongs.length}
                onChange={handleToggleSelectAll}
              />
            </div>
          )}
          {showIndex && (
            <div className="song-list__head-index" style={colWidth(indexWidth)}>
              #
            </div>
          )}
          <div className="song-list__head-cover" aria-hidden="true" />
          <div className="song-list__head-title">标题</div>
          {showAlbumColumn && (
            <div className="song-list__head-col" style={colWidth(COL_ALBUM)}>
              专辑
            </div>
          )}
          {showDuration && (
            <div className="song-list__head-col" style={colWidth(durationWidth)}>
              时长
            </div>
          )}
          <div className="song-list__head-actions" style={colWidth(actionWidth)}>
            操作
          </div>
        </div>
      )}

      {/* 歌曲列表：够长时只挂窗口内的行（绝对定位在等高 spacer 上），否则整表渲染 */}
      <div
        ref={virtual.rowsRef}
        className="song-list__rows"
        data-virtual={virtual.mode === 'virtual' || undefined}
        style={{ '--total-size': `${virtual.totalSize}px` } as React.CSSProperties}
      >
        {virtual.mode === 'virtual'
            ? virtual.items.map((item) => {
                const song = displaySongs[item.index];
                if (!song) return null;
                return (
                  <VirtualRow
                    key={song.id}
                    start={item.start}
                    size={item.size}
                    scrollMargin={virtual.scrollMargin}
                  >
                    {renderRow(song, item.index)}
                  </VirtualRow>
                );
              })
            : displaySongs.map((song, index) => renderRow(song, index))}
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
          onSuccess={handleAddToPlaylistSuccess}
        />
      )}

      {/* 批量加入歌单弹窗 */}
      {selectedSongsForPlaylist.length > 0 && (
        <BatchAddToPlaylistModal
          songs={selectedSongsForPlaylist}
          isVisible={showBatchAddToPlaylistModal}
          onClose={() => {
            setShowBatchAddToPlaylistModal(false);
            setSelectedSongsForPlaylist([]);
            // 清空选择
            onSelectionChange([]);
          }}
          onSuccess={() => {
            if (onBatchAddToPlaylist) {
              onBatchAddToPlaylist(selectedSongsForPlaylist);
            }
          }}
        />
      )}
    </div>
  );
};

export default SongList;
