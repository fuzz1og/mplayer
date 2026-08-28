import React, { useState, useEffect, useCallback } from 'react';
import { Headphones, Trash2, GripVertical, ListMusic } from 'lucide-react';
import { Modal } from 'antd';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { usePlayerStore } from '@/renderer/store/playerStore';
import BatchAddToPlaylistModal from '@/renderer/components/BatchAddToPlaylistModal';
import AddToPlaylistModal from '@/renderer/components/AddToPlaylistModal';
import SourceBadge from '@/renderer/components/SourceBadge';
import { IpcClient } from '@/renderer/services/IpcClient';
import { callMusicApi } from '@/renderer/services/callMusicApi';
import { mapPacedWithConcurrency } from '@/renderer/utils/async';
import { refreshSongCover } from '@/renderer/utils/songCoverRefresh';
import type { Song } from '@mplayer/core';
import { findExactMatch } from '@mplayer/core';
import { isLegacyDeadUrl } from '@mplayer/core';

interface SortableItemProps {
  song: Song;
  index: number;
  isCurrentSong: boolean;
  isPlaying: boolean;
  onPlay: (song: Song) => void;
  onRemove: (index: number) => void;
  onAddToPlaylist: (song: Song) => void;
  onCoverError?: (song: Song) => void;
}

const SortableItem: React.FC<SortableItemProps> = React.memo(({ song, index, isCurrentSong, isPlaying, onPlay, onRemove, onAddToPlaylist, onCoverError }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: song.id });
  // 封面直链直渲：加载失败显示占位并走既有搜索式刷新（封面链已删，#273）
  const [coverFailed, setCoverFailed] = useState(false);

  // 封面刷新换新 URL 后重置失败态，否则新封面永远不会显示
  useEffect(() => {
    setCoverFailed(false);
  }, [song.cover]);

  const style: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    padding: '10px 16px',
    borderRadius: '6px',
    cursor: 'pointer',
    backgroundColor: isDragging ? 'var(--bg-hover)' : (isCurrentSong ? 'rgba(47, 95, 208, 0.10)' : 'transparent'),
    opacity: isDragging ? 0.7 : 1,
    transform: CSS.Transform.toString(transform),
    transition: transition || undefined,
  };

  return (
    <div ref={setNodeRef} style={style} onDoubleClick={() => onPlay(song)}>
      <div style={{ width: '50px', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
        <span {...attributes} {...listeners} style={{ cursor: 'grab', display: 'flex', alignItems: 'center', color: 'var(--text-tertiary)' }}>
          <GripVertical size={14} />
        </span>
        {isCurrentSong && isPlaying ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
            <span style={{ width: '3px', height: '12px', backgroundColor: 'var(--accent)', animation: 'soundBar 0.5s ease-in-out infinite', animationDelay: '0s' }} />
            <span style={{ width: '3px', height: '16px', backgroundColor: 'var(--accent)', animation: 'soundBar 0.5s ease-in-out infinite', animationDelay: '0.1s' }} />
            <span style={{ width: '3px', height: '10px', backgroundColor: 'var(--accent)', animation: 'soundBar 0.5s ease-in-out infinite', animationDelay: '0.2s' }} />
          </div>
        ) : (
          <span style={{ fontSize: 'var(--text-base)', color: isCurrentSong ? 'var(--accent)' : 'var(--text-tertiary)', fontWeight: isCurrentSong ? 600 : 400 }}>
            {index + 1}
          </span>
        )}
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
        <div style={{ width: '40px', height: '40px', borderRadius: '4px', overflow: 'hidden', backgroundColor: 'var(--bg-hover)', flexShrink: 0 }}>
          {song.cover && !coverFailed ? (
            <img
              src={song.cover}
              alt={song.name}
              loading="lazy"
              onError={() => { setCoverFailed(true); onCoverError?.(song); }}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, var(--border-default) 0%, var(--border-subtle) 100%)' }} />
          )}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 'var(--text-base)', fontWeight: isCurrentSong ? 600 : 400, color: isCurrentSong ? 'var(--accent)' : 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {song.name}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{song.artist}</span>
            <SourceBadge sourceType={song.sourceType} style={{ padding: '1px 4px', lineHeight: '1.4' }} />
          </div>
        </div>
      </div>
      <div style={{ width: '120px', fontSize: '13px', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {song.album}
      </div>
      <div style={{ width: '90px', display: 'flex', justifyContent: 'center', gap: '4px' }}>
        <button
          onClick={(e) => { e.stopPropagation(); onAddToPlaylist(song); }}
          aria-label="加入歌单"
          title="加入歌单"
          style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '6px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)' }}>
          <ListMusic size={14} />
        </button>
        <button onClick={(e) => { e.stopPropagation(); onRemove(index); }}
          style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '6px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)' }}>
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
});

const refreshQueueSongs = async (songs: Song[]): Promise<Song[]> => {
  // 分批刷新（每批 3 首 + 批间间隔 + 限流退避）：上游服务端对同 IP 有窗口配额
  const results = await mapPacedWithConcurrency(songs, 3, async (song) => {
    try {
      const cached = await IpcClient.invoke<{ url: string; cover: string; lrc: string } | null>('cache:getSongResources', song.id);
      if (
        cached &&
        !isLegacyDeadUrl(cached.url) &&
        !isLegacyDeadUrl(cached.cover) &&
        !isLegacyDeadUrl(cached.lrc)
      ) {
        return { ...song, url: cached.url, cover: cached.cover, lrc: cached.lrc };
      }
      // 「按 ID 识别」死腿已删（自建 API 退役后 searchSongById 恒 null，#273）：
      // 直接按歌名精确匹配（严格匹配防翻唱/Live 误配）
      let fresh: Song | null = null;
      if (song.name) {
        try {
          const searchResults = await callMusicApi(
            'searchSongsRouted',
            `${song.name} ${song.artist}`.trim(),
            1,
            song.sourceType,
          );
          fresh = (findExactMatch({ name: song.name, artist: song.artist }, searchResults) as Song | undefined) || null;
        } catch {
          fresh = null;
        }
      }
      if (!fresh) return song;
      await IpcClient.invoke<void>('cache:setSongResources', song.id, {
        url: fresh.url || '',
        cover: fresh.cover || '',
        lrc: fresh.lrc || '',
      });
      return {
        ...song,
        name: fresh.name || song.name,
        artist: fresh.artist || song.artist,
        album: fresh.album || song.album || '',
        duration: fresh.duration || song.duration || 0,
        url: fresh.url || '',
        cover: fresh.cover || '',
        lrc: fresh.lrc || '',
        sourceType: fresh.sourceType || song.sourceType,
      };
    } catch {
      return song;
    }
  });
  return results.map((r, i) => (r.status === 'fulfilled' ? r.value : songs[i]));
};

const QueuePage: React.FC = () => {
  const currentPlaylist = usePlayerStore((s) => s.currentPlaylist);
  const currentSong = usePlayerStore((s) => s.currentSong);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const play = usePlayerStore((s) => s.play);
  const removeFromQueue = usePlayerStore((s) => s.removeFromQueue);
  const reorderQueue = usePlayerStore((s) => s.reorderQueue);
  const clearQueue = usePlayerStore((s) => s.clearQueue);
  const setCurrentPlaylist = usePlayerStore((s) => s.setCurrentPlaylist);
  const [showBatchModal, setShowBatchModal] = useState(false);
  // 行内「加入歌单」单曲弹窗
  const [addToPlaylistSong, setAddToPlaylistSong] = useState<Song | null>(null);

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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  useEffect(() => {
    let cancelled = false;
    const doRefresh = async () => {
      if (currentPlaylist.length === 0) return;
      const refreshed = await refreshQueueSongs(currentPlaylist);
      if (cancelled) return;
      const hasChanges = refreshed.some((s, i) =>
        s.url !== currentPlaylist[i]?.url || s.cover !== currentPlaylist[i]?.cover
      );
      if (hasChanges) {
        const { currentPlaylistIndex } = usePlayerStore.getState();
        setCurrentPlaylist(refreshed, currentPlaylistIndex);
      }
    };
    doRefresh();
    return () => { cancelled = true; };
  }, []);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = currentPlaylist.findIndex(s => s.id === active.id);
    const newIndex = currentPlaylist.findIndex(s => s.id === over.id);
    if (oldIndex !== -1 && newIndex !== -1) {
      reorderQueue(oldIndex, newIndex);
    }
  };

  const handleClearQueue = () => {
    Modal.confirm({
      title: '清空队列',
      content: '确定要清空播放队列吗？',
      okText: '清空',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: () => clearQueue(),
    });
  };

  const handleSaveToPlaylist = () => {
    if (currentPlaylist.length === 0) return;
    setShowBatchModal(true);
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '24px 24px 16px', borderBottom: '1px solid var(--border-subtle)', backgroundColor: 'var(--bg-surface)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <Headphones size={24} color="var(--text-secondary)" />
            <h1 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>播放队列</h1>
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>· {currentPlaylist.length} 首歌曲</span>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={handleClearQueue} disabled={currentPlaylist.length === 0}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', backgroundColor: 'transparent', color: currentPlaylist.length > 0 ? 'var(--text-secondary)' : 'var(--text-tertiary)', border: '1px solid var(--border-subtle)', borderRadius: '20px', cursor: currentPlaylist.length > 0 ? 'pointer' : 'not-allowed', fontSize: 'var(--text-base)', fontWeight: 500 }}>
              <Trash2 size={16} /> 清空队列
            </button>
            <button onClick={handleSaveToPlaylist} disabled={currentPlaylist.length === 0}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', backgroundColor: currentPlaylist.length > 0 ? 'var(--accent)' : 'var(--bg-hover)', color: currentPlaylist.length > 0 ? 'white' : 'var(--text-tertiary)', border: 'none', borderRadius: '20px', cursor: currentPlaylist.length > 0 ? 'pointer' : 'not-allowed', fontSize: 'var(--text-base)', fontWeight: 500 }}>
              <ListMusic size={16} /> 保存为歌单
            </button>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {currentPlaylist.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 20px', color: 'var(--text-tertiary)' }}>
            <Headphones size={26} style={{ marginBottom: '12px', color: 'var(--text-tertiary)' }} />
            <div style={{ fontSize: 'var(--text-base)' }}>暂无歌曲，去发现音乐吧</div>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)', fontSize: '12px', color: 'var(--text-tertiary)', fontWeight: 500 }}>
              <div style={{ width: '50px', textAlign: 'center' }}>#</div>
              <div style={{ flex: 1 }}>标题</div>
              <div style={{ width: '120px' }}>专辑</div>
              <div style={{ width: '60px', textAlign: 'center' }}>操作</div>
            </div>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={currentPlaylist.map(s => s.id)} strategy={verticalListSortingStrategy}>
                {currentPlaylist.map((song, index) => (
                  <SortableItem
                    key={song.id}
                    song={song}
                    index={index}
                    isCurrentSong={currentSong?.id === song.id}
                    isPlaying={isPlaying}
                    onPlay={play}
                    onRemove={removeFromQueue}
                    onAddToPlaylist={setAddToPlaylistSong}
                    onCoverError={handleCoverError}
                  />
                ))}
              </SortableContext>
            </DndContext>
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
        songs={currentPlaylist}
        onClose={() => setShowBatchModal(false)}
      />
    </div>
  );
};

export default QueuePage;
