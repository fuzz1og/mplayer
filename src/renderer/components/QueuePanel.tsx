import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import { Headphones, ListMusic, Shuffle, Trash2, GripVertical, X } from 'lucide-react';
import { useConfirm, IconButton } from '@/renderer/ui';
import { usePlayerStore } from '@/renderer/store/playerStore';
import BatchAddToPlaylistModal from '@/renderer/components/BatchAddToPlaylistModal';
import AddToPlaylistModal from '@/renderer/components/AddToPlaylistModal';
import SongRow from '@/renderer/components/SongRow';
import SortableSongRow from '@/renderer/components/SortableSongRow';
import VirtualSortableList from '@/renderer/components/VirtualSortableList';
import { refreshSongCover } from '@/renderer/utils/songCoverRefresh';
import { colWidth, songIndexWidth } from '@/renderer/components/songTableColumns';
import { songRowHeight } from '@/renderer/components/songRowMetrics';
import { applyShuffleIndexes, applyShuffleOrder, type Song } from '@mplayer/core';
import '@/renderer/styles/songlist.css';
import '@/renderer/styles/queue-panel.css';

/** 面板行一律按资料库密度渲染：表头与行取同一个序号列宽（songIndexWidth），行高取同一份协议。 */
const QUEUE_ROW_DENSITY = 'library' as const;
const QUEUE_ACTIONS_W = 90;

interface QueuePanelStore {
  isOpen: boolean;
  returnFocus: HTMLElement | null;
  open: () => void;
  close: () => void;
}

/** 全局队列面板状态：从播放栏队列按钮打开，不改变当前路由。 */
export const useQueuePanelStore = create<QueuePanelStore>((set, get) => ({
  isOpen: false,
  returnFocus: null,
  open: () => set({
    isOpen: true,
    returnFocus: document.activeElement instanceof HTMLElement ? document.activeElement : null,
  }),
  close: () => {
    const target = get().returnFocus;
    set({ isOpen: false, returnFocus: null });
    if (target?.isConnected) target.focus();
  },
}));

export const openQueuePanel = (): void => useQueuePanelStore.getState().open();
export const closeQueuePanel = (): void => useQueuePanelStore.getState().close();

/** 队列行的行尾操作：加入歌单 + 从队列移除（沿用队列页原有图标按钮）。 */
const QueueRowActions: React.FC<{
  song: Song;
  index: number;
  onAddToPlaylist: (song: Song) => void;
  onRemove: (index: number) => void;
}> = ({ song, index, onAddToPlaylist, onRemove }) => (
  <div className="queue__row-actions" style={{ '--queue-actions-w': String(QUEUE_ACTIONS_W) + 'px' } as React.CSSProperties}>
    <button
      onClick={(e) => { e.stopPropagation(); onAddToPlaylist(song); }}
      aria-label="加入歌单"
      title="加入歌单"
      className="queue__icon-btn">
      <ListMusic size={14} />
    </button>
    <button onClick={(e) => { e.stopPropagation(); onRemove(index); }} aria-label="从队列移除" title="从队列移除" className="queue__icon-btn">
      <Trash2 size={14} />
    </button>
  </div>
);

const previewDragHandle = (
  <span aria-hidden className="queue__drag-handle">
    <GripVertical size={14} />
  </span>
);

export interface QueuePanelProps {
  /** 旧 /queue 路由兼容：直接把面板作为该路由内容渲染。 */
  standalone?: boolean;
  /** standalone 模式下的关闭动作（通常 navigate(-1)）。 */
  onClose?: () => void;
}

const QueuePanel: React.FC<QueuePanelProps> = ({ standalone = false, onClose }) => {
  const confirm = useConfirm();
  const storeOpen = useQueuePanelStore((s) => s.isOpen);
  const closePanel = useQueuePanelStore((s) => s.close);
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
  const setPlayMode = usePlayerStore((s) => s.setPlayMode);
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [addToPlaylistSong, setAddToPlaylistSong] = useState<Song | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const visible = standalone || storeOpen;

  const handleClose = useCallback(() => {
    if (standalone) onClose?.();
    else closePanel();
  }, [standalone, onClose, closePanel]);

  // 打开时把焦点送进关闭按钮；ESC 关闭并把焦点还给打开它的队列按钮（store.close）。
  useEffect(() => {
    if (!visible) return;
    const timer = window.setTimeout(() => closeButtonRef.current?.focus(), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      handleClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [visible, handleClose]);

  const displayPlaylist = useMemo(
    () => (playMode === '随机播放' ? applyShuffleOrder(currentPlaylist, shuffle) : currentPlaylist),
    [playMode, currentPlaylist, shuffle],
  );

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

  const handleReorder = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (playMode === '随机播放') reorderShuffle(fromIndex, toIndex);
      else reorderQueue(fromIndex, toIndex);
    },
    [playMode, reorderShuffle, reorderQueue],
  );

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

  const handleQueuePlay = useCallback((song: Song) => {
    void play(song);
  }, [play]);

  const renderQueueRow = useCallback(
    (song: Song, index: number) => (
      <SortableSongRow
        song={song}
        index={index}
        variant={QUEUE_ROW_DENSITY}
        showDuration
        fillTitle
        showAlbum={false}
        isCurrentSong={currentSongId === song.id}
        isPlaying={isPlaying}
        queue={displayPlaylist}
        onPlay={handleQueuePlay}
        onCoverError={handleCoverError}
        renderActions={renderQueueActions}
      />
    ),
    [currentSongId, isPlaying, displayPlaylist, handleQueuePlay, handleCoverError, renderQueueActions],
  );

  const renderQueueDragPreview = useCallback(
    (song: Song, index: number) => (
      <SongRow
        song={song}
        index={index}
        variant={QUEUE_ROW_DENSITY}
        showDuration
        fillTitle
        showAlbum={false}
        isCurrentSong={currentSongId === song.id}
        isPlaying={isPlaying}
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
    setShowBatchModal(true);
  };

  if (!visible) return null;

  return (
    <aside className="queue-panel" role="complementary" aria-label="播放队列" data-queue-panel>
      <header className="queue-panel__head">
        <div className="queue-panel__title-group">
          <Headphones size={16} aria-hidden="true" />
          <h2 className="queue-panel__title">播放队列</h2>
          <span className="queue-panel__count">{displayPlaylist.length} 首</span>
        </div>
        <div className="queue-panel__actions">
          <IconButton label="保存为歌单" icon={<ListMusic size={14} />} size="sm" disabled={displayPlaylist.length === 0} onClick={handleSaveToPlaylist} />
          <IconButton label="清空队列" icon={<Trash2 size={14} />} size="sm" disabled={currentPlaylist.length === 0} onClick={handleClearQueue} />
          <button ref={closeButtonRef} type="button" className="queue-panel__close" aria-label="关闭队列" onClick={handleClose}>
            <X size={15} />
          </button>
        </div>
      </header>

      <div className="queue-panel__body" data-scroll-container>
        {displayPlaylist.length === 0 ? (
          <div className="queue-panel__empty">
            <Headphones size={24} className="queue-panel__empty-icon" />
            <div>队列为空，去发现音乐吧</div>
          </div>
        ) : (
          <>
            <div className="queue-panel__thead">
              <div className="queue-panel__thead-index" style={colWidth(songIndexWidth(QUEUE_ROW_DENSITY))}>#</div>
              <div className="queue-panel__thead-title">标题</div>
              <div className="queue-panel__thead-actions" style={{ '--queue-actions-w': String(QUEUE_ACTIONS_W) + 'px' } as React.CSSProperties}>操作</div>
            </div>
            <VirtualSortableList
              items={displayPlaylist}
              renderRow={renderQueueRow}
              renderDragPreview={renderQueueDragPreview}
              onReorder={handleReorder}
              estimateSize={() => songRowHeight(QUEUE_ROW_DENSITY)}
            />
          </>
        )}
      </div>

      <footer className="queue-panel__foot">
        <span>{playMode === '随机播放' ? '随机播放' : '顺序播放'} · {displayPlaylist.length} 首</span>
        <button
          type="button"
          className="queue-panel__shuffle"
          aria-pressed={playMode === '随机播放'}
          onClick={() => setPlayMode(playMode === '随机播放' ? '列表循环' : '随机播放')}
        >
          <Shuffle size={12} />
          随机
        </button>
      </footer>

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
    </aside>
  );
};

export default QueuePanel;
