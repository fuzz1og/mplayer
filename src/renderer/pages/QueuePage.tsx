import React, { useState, useEffect } from 'react';
import { Headphones, Trash2, GripVertical, ListMusic } from 'lucide-react';
import { Modal } from 'antd';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { usePlayerStore } from '@/renderer/store/playerStore';
import BatchAddToPlaylistModal from '@/renderer/components/BatchAddToPlaylistModal';
import { useCachedCover } from '@/renderer/services/coverCacheService';
import SourceBadge from '@/renderer/components/SourceBadge';
import { IpcClient } from '@/renderer/services/IpcClient';
import type { Song } from '@mplayer/core';
const { ipcRenderer } = window.require('electron');

interface SortableItemProps {
  song: Song;
  index: number;
  isCurrentSong: boolean;
  isPlaying: boolean;
  onPlay: (song: Song) => void;
  onRemove: (index: number) => void;
}

const SortableItem: React.FC<SortableItemProps> = React.memo(({ song, index, isCurrentSong, isPlaying, onPlay, onRemove }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: song.id });
  const coverSrc = useCachedCover(song.cover);

  const style: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    padding: '10px 16px',
    borderRadius: '6px',
    cursor: 'pointer',
    backgroundColor: isDragging ? 'var(--hover-bg)' : (isCurrentSong ? 'rgba(116, 185, 255, 0.1)' : 'transparent'),
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
            <span style={{ width: '3px', height: '12px', backgroundColor: 'var(--accent-color)', animation: 'soundBar 0.5s ease-in-out infinite', animationDelay: '0s' }} />
            <span style={{ width: '3px', height: '16px', backgroundColor: 'var(--accent-color)', animation: 'soundBar 0.5s ease-in-out infinite', animationDelay: '0.1s' }} />
            <span style={{ width: '3px', height: '10px', backgroundColor: 'var(--accent-color)', animation: 'soundBar 0.5s ease-in-out infinite', animationDelay: '0.2s' }} />
          </div>
        ) : (
          <span style={{ fontSize: 'var(--text-base)', color: isCurrentSong ? 'var(--accent-color)' : 'var(--text-tertiary)', fontWeight: isCurrentSong ? 600 : 400 }}>
            {index + 1}
          </span>
        )}
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
        <div style={{ width: '40px', height: '40px', borderRadius: '4px', overflow: 'hidden', backgroundColor: 'var(--hover-bg)', flexShrink: 0 }}>
          {song.cover ? <img src={coverSrc} alt={song.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" />
            : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #E8E8E8 0%, #F0F0F0 100%)' }} />}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 'var(--text-base)', fontWeight: isCurrentSong ? 600 : 400, color: isCurrentSong ? 'var(--accent-color)' : 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
      <div style={{ width: '60px', display: 'flex', justifyContent: 'center' }}>
        <button onClick={(e) => { e.stopPropagation(); onRemove(index); }}
          style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '6px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)' }}>
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
});

const refreshQueueSongs = async (songs: Song[]): Promise<Song[]> => {
  const results = await Promise.allSettled(
    songs.map(async (song) => {
      try {
        const cached = await IpcClient.invoke<{ url: string; cover: string; lrc: string } | null>('cache:getUrl', song.id);
        if (cached) {
          return { ...song, url: cached.url, cover: cached.cover, lrc: cached.lrc };
        }
        const keyword = `${song.name} ${song.artist}`;
        const result = await ipcRenderer.invoke('musicApi:searchSongs', keyword, 1, song.sourceType);
        if (!result.success || !result.data.length) return song;
        const fresh = result.data.find((s: Song) => s.id === song.id) || result.data[0];
        await IpcClient.invoke<void>('cache:setUrl', song.id, {
          url: fresh.url,
          cover: fresh.cover,
          lrc: fresh.lrc,
        });
        return { ...song, url: fresh.url, cover: fresh.cover, lrc: fresh.lrc };
      } catch {
        return song;
      }
    })
  );
  return results.map((r, i) => (r.status === 'fulfilled' ? r.value : songs[i]));
};

const QueuePage: React.FC = () => {
  const { currentPlaylist, currentSong, isPlaying, play, removeFromQueue, reorderQueue, clearQueue, setCurrentPlaylist } = usePlayerStore();
  const [showBatchModal, setShowBatchModal] = useState(false);

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
      content: '确定要清空试听列表吗？',
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
      <div style={{ padding: '24px 24px 16px', borderBottom: '1px solid var(--divider-color)', backgroundColor: 'var(--content-bg)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <Headphones size={24} color="var(--accent-color)" />
            <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>试听列表</h1>
            <span style={{ fontSize: 'var(--text-base)', color: 'var(--text-tertiary)', marginLeft: '8px' }}>{currentPlaylist.length} 首歌曲</span>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={handleClearQueue} disabled={currentPlaylist.length === 0}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', backgroundColor: 'transparent', color: currentPlaylist.length > 0 ? 'var(--text-secondary)' : 'var(--text-tertiary)', border: '1px solid var(--divider-color)', borderRadius: '20px', cursor: currentPlaylist.length > 0 ? 'pointer' : 'not-allowed', fontSize: 'var(--text-base)', fontWeight: 500 }}>
              <Trash2 size={16} /> 清空队列
            </button>
            <button onClick={handleSaveToPlaylist} disabled={currentPlaylist.length === 0}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', backgroundColor: currentPlaylist.length > 0 ? '#4ECDC4' : 'var(--hover-bg)', color: currentPlaylist.length > 0 ? 'white' : 'var(--text-tertiary)', border: 'none', borderRadius: '20px', cursor: currentPlaylist.length > 0 ? 'pointer' : 'not-allowed', fontSize: 'var(--text-base)', fontWeight: 500 }}>
              <ListMusic size={16} /> 保存为歌单
            </button>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {currentPlaylist.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 20px', color: 'var(--text-tertiary)' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>🎧</div>
            <div style={{ fontSize: 'var(--text-base)' }}>暂无歌曲，去发现音乐吧</div>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--divider-color)', fontSize: '12px', color: 'var(--text-tertiary)', fontWeight: 500 }}>
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
                  />
                ))}
              </SortableContext>
            </DndContext>
          </>
        )}
      </div>

      <BatchAddToPlaylistModal
        isVisible={showBatchModal}
        songs={currentPlaylist}
        onClose={() => setShowBatchModal(false)}
      />
    </div>
  );
};

export default QueuePage;
