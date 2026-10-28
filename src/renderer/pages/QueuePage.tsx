import React, { useState, useCallback, useMemo } from 'react';
import { Headphones, Trash2, ListMusic, GripVertical } from 'lucide-react';
import { useConfirm } from '@/renderer/ui';
import { usePlayerStore } from '@/renderer/store/playerStore';
import BatchAddToPlaylistModal from '@/renderer/components/BatchAddToPlaylistModal';
import AddToPlaylistModal from '@/renderer/components/AddToPlaylistModal';
import SongRow from '@/renderer/components/SongRow';
import SortableSongRow from '@/renderer/components/SortableSongRow';
import VirtualSortableList from '@/renderer/components/VirtualSortableList';
import { refreshSongCover } from '@/renderer/utils/songCoverRefresh';
import { COL_INDEX, colWidth } from '@/renderer/components/songTableColumns';
import '@/renderer/styles/songlist.css';
import { applyShuffleIndexes, applyShuffleOrder, type Song } from '@mplayer/core';

/** 队列行的行尾操作：加入歌单 + 从队列移除（沿用队列页原有的常驻图标按钮） */
/**
 * 队列页操作列宽。表头与行必须同为这个值——此前表头写 60px、行写 90px，
 * 两处各自写死，于是「操作」标签比下面的图标偏了 30px 且不报错。
 */
const QUEUE_ACTIONS_W = 90;

/** 队列页专辑列宽；行的 albumWidth 也取这个值 */
const QUEUE_ALBUM_W = 120;

const QueueRowActions: React.FC<{
  song: Song;
  index: number;
  onAddToPlaylist: (song: Song) => void;
  onRemove: (index: number) => void;
}> = ({ song, index, onAddToPlaylist, onRemove }) => (
  <div className="queue__row-actions" style={{ '--queue-actions-w': `${QUEUE_ACTIONS_W}px` } as React.CSSProperties}>
    <button
      onClick={(e) => { e.stopPropagation(); onAddToPlaylist(song); }}
      aria-label="加入歌单"
      title="加入歌单"
      className="queue__icon-btn">
      <ListMusic size={14} />
    </button>
    <button onClick={(e) => { e.stopPropagation(); onRemove(index); }} className="queue__icon-btn">
      <Trash2 size={14} />
    </button>
  </div>
);

/** overlay 里的静态拖拽把手：只是视觉延续，不接 dnd（overlay 内容整体 pointer-events: none） */
const previewDragHandle = (
  <span aria-hidden className="queue__drag-handle">
    <GripVertical size={14} />
  </span>
);

const QueuePage: React.FC = () => {
  const confirm = useConfirm();
  const currentPlaylist = usePlayerStore((s) => s.currentPlaylist);
  const currentSong = usePlayerStore((s) => s.currentSong);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const playMode = usePlayerStore((s) => s.playMode);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const play = usePlayerStore((s) => s.play);
  const removeFromQueue = usePlayerStore((s) => s.removeFromQueue);
  const reorderQueue = usePlayerStore((s) => s.reorderQueue);
  const reorderShuffle = usePlayerStore((s) => s.reorderShuffle);
  const clearQueue = usePlayerStore((s) => s.clearQueue);
  const setCurrentPlaylist = usePlayerStore((s) => s.setCurrentPlaylist);
  const [showBatchModal, setShowBatchModal] = useState(false);
  // 行内「加入歌单」单曲弹窗
  const [addToPlaylistSong, setAddToPlaylistSong] = useState<Song | null>(null);

  /**
   * 随机模式（#511）下显示的是**随机序**——用户因此「看得到随机」，且显示顺序与实际推进顺序一致。
   * 非随机模式仍是 currentPlaylist 原顺序。两者等长、同一批歌曲对象。
   */
  const displayPlaylist = useMemo(
    () => (playMode === '随机播放' ? applyShuffleOrder(currentPlaylist, shuffle) : currentPlaylist),
    [playMode, currentPlaylist, shuffle],
  );

  /**
   * 显示序 → 成员下标（#639 R2）：必须走 core `applyShuffleIndexes` 的 **FIFO 位置化**匹配。
   * 按 id 反查（`findIndex`）在重复 id 队列下恒命中第一个成员 → 删错歌。
   */
  const displayToMemberIndex = useMemo(() => {
    const order = playMode === '随机播放' && shuffle ? shuffle.order : [];
    return applyShuffleIndexes(order, currentPlaylist);
  }, [playMode, shuffle, currentPlaylist]);

  const handleRemoveByDisplayIndex = useCallback(
    (displayIndex: number) => {
      const playlistIndex = displayToMemberIndex[displayIndex];
      if (playlistIndex === undefined) return;
      removeFromQueue(playlistIndex);
    },
    [displayToMemberIndex, removeFromQueue],
  );

  /** 拖拽松手：随机模式改的是随机序本身，其余模式改成员顺序 */
  const handleReorder = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (playMode === '随机播放') reorderShuffle(fromIndex, toIndex);
      else reorderQueue(fromIndex, toIndex);
    },
    [playMode, reorderShuffle, reorderQueue],
  );

  /**
   * 行尾操作用**渲染函数**（#412）：此前 `actions={<QueueRowActions .../>}` 每帧新建元素，
   * `SortableSongRow` 的 memo 永远失效 → 播放状态一变整个队列全部重渲染。
   */
  const renderQueueActions = useCallback(
    (song: Song, index: number) => (
      <QueueRowActions
        song={song}
        index={index}
        onAddToPlaylist={setAddToPlaylistSong}
        onRemove={handleRemoveByDisplayIndex}
      />
    ),
    [handleRemoveByDisplayIndex],
  );

  // 封面加载失败 → 按 ID 重识别换新封面并更新队列/当前歌曲（旧签名封面永远失败）
  const handleCoverError = useCallback((song: Song) => {
    void refreshSongCover(song).then((cover) => {
      if (!cover) return;
      const { currentPlaylist: pl, currentPlaylistIndex, currentSong: cur } = usePlayerStore.getState();
      setCurrentPlaylist(
        pl.map((s) => (s.id === song.id ? { ...s, cover } : s)),
        currentPlaylistIndex,
      );
      if (cur?.id === song.id) {
        usePlayerStore.setState({ currentSong: { ...cur, cover } });
      }
    });
  }, [setCurrentPlaylist]);

  const currentSongId = currentSong?.id;

  /**
   * 队列页的行点播：队列本来就是 playerStore 的 currentPlaylist，无需再 setQueue
   * （随机模式下 displayPlaylist 是随机序，写回成员序反而会毁掉稳定随机序列）。
   */
  const handleQueuePlay = useCallback((song: Song) => {
    void play(song);
  }, [play]);

  /** 窗口内可排序行：内部用 useSortable 注册，index 由列表给的是**全量下标** */
  const renderQueueRow = useCallback(
    (song: Song, index: number) => (
      <SortableSongRow
        song={song}
        index={index}
        isCurrentSong={currentSongId === song.id}
        isPlaying={isPlaying}
        fillTitle
        albumWidth={QUEUE_ALBUM_W}
        queue={displayPlaylist}
        onPlay={handleQueuePlay}
        onCoverError={handleCoverError}
        renderActions={renderQueueActions}
      />
    ),
    [currentSongId, isPlaying, displayPlaylist, handleQueuePlay, handleCoverError, renderQueueActions],
  );

  /** 拖拽 overlay 里的同一行：**非 sortable**（同一 id 二次注册会冲突） */
  const renderQueueDragPreview = useCallback(
    (song: Song, index: number) => (
      <SongRow
        song={song}
        index={index}
        isCurrentSong={currentSongId === song.id}
        isPlaying={isPlaying}
        fillTitle
        albumWidth={QUEUE_ALBUM_W}
        dragHandle={previewDragHandle}
        queue={displayPlaylist}
        onPlay={handleQueuePlay}
        onCoverError={handleCoverError}
        actions={renderQueueActions(song, index)}
      />
    ),
    [currentSongId, isPlaying, displayPlaylist, handleQueuePlay, handleCoverError, renderQueueActions],
  );

  const handleClearQueue = () => {
    confirm({
      title: '清空队列',
      message: '确定要清空播放队列吗？',
      okText: '清空',
      cancelText: '取消',
      danger: true,
      onOk: () => clearQueue(),
    });
  };

  const handleSaveToPlaylist = () => {
    if (displayPlaylist.length === 0) return;
    // 保存的是用户**看到的顺序**（随机模式下即随机序）
    setShowBatchModal(true);
  };

  return (
    <div className="list-page">
      <div className="list-page__head">
        <div className="list-page__head-row">
          <div className="list-page__title-group">
            <Headphones size={20} color="var(--text-secondary)" />
            <h1 className="list-page__title">播放队列</h1>
            <span className="list-page__count">{displayPlaylist.length} 首歌曲</span>
          </div>
          <div className="queue__head-actions">
            <button onClick={handleClearQueue} disabled={currentPlaylist.length === 0} className="list-page__action">
              <Trash2 size={15} /> 清空队列
            </button>
            <button
              onClick={handleSaveToPlaylist}
              disabled={currentPlaylist.length === 0}
              className="list-page__action list-page__action--primary"
            >
              <ListMusic size={15} /> 保存为歌单
            </button>
          </div>
        </div>
      </div>

      <div className="list-page__body">
        {displayPlaylist.length === 0 ? (
          <div className="queue__empty">
            <Headphones size={26} className="queue__empty-icon" />
            <div>暂无歌曲，去发现音乐吧</div>
          </div>
        ) : (
          <>
            <div className="queue__thead">
              <div className="queue__thead-index" style={colWidth(COL_INDEX)}>#</div>
              <div className="queue__thead-title">标题</div>
              <div className="queue__thead-col" style={colWidth(QUEUE_ALBUM_W)}>专辑</div>
              <div className="queue__thead-actions" style={{ '--queue-actions-w': `${QUEUE_ACTIONS_W}px` } as React.CSSProperties}>操作</div>
            </div>
            {/* 窗口化 + 可排序：挂载行数与视口成正比（#428 / ADR 2026-09-29-queue-virtualized-sortable-list） */}
            <VirtualSortableList
              items={displayPlaylist}
              renderRow={renderQueueRow}
              renderDragPreview={renderQueueDragPreview}
              onReorder={handleReorder}
            />
          </>
        )}
      </div>

      {addToPlaylistSong && (
        <AddToPlaylistModal
          song={addToPlaylistSong}
          isVisible
          onClose={() => setAddToPlaylistSong(null)}
        />
      )}

      <BatchAddToPlaylistModal
        isVisible={showBatchModal}
        songs={displayPlaylist}
        onClose={() => setShowBatchModal(false)}
      />
    </div>
  );
};

export default QueuePage;
