import React, { useEffect, useState } from 'react';
import { Play, ArrowLeft, Edit2, Music, Download, GripVertical, Trash2 } from 'lucide-react';
import { useParams, useNavigate } from 'react-router-dom';
const { ipcRenderer } = window.require('electron');
import { message } from 'antd';
import { usePlayerStore } from '@/renderer/store/playerStore';
import { useDownloadStore } from '@/renderer/store/downloadStore';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useCachedCover } from '@/renderer/services/coverCacheService';
import { playlistService } from '@/renderer/services/playlistService';
import type { Song, Playlist } from '@/shared/types/song';
import { cacheService } from '@/renderer/services/cacheService';

const SortableSongRow: React.FC<{
  song: Song; index: number; isCurrentSong: boolean; isPlaying: boolean;
  onPlay: (song: Song) => void; onRemove: (song: Song) => void; onDownload: (song: Song) => void;
}> = React.memo(({ song, index, isCurrentSong, isPlaying, onPlay, onRemove, onDownload }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: song.id });
  const coverSrc = useCachedCover(song.cover);

  return (
    <div ref={setNodeRef}
      style={{
        display: 'flex', alignItems: 'center', padding: '10px 16px', borderRadius: '6px', cursor: 'pointer',
        backgroundColor: isDragging ? 'var(--hover-bg)' : (isCurrentSong ? 'rgba(116, 185, 255, 0.1)' : 'transparent'),
        opacity: isDragging ? 0.7 : 1,
        transform: CSS.Transform.toString(transform),
        transition: transition || undefined,
      }}
      onDoubleClick={() => onPlay(song)}
    >
      <div style={{ width: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span {...attributes} {...listeners} style={{ cursor: 'grab', display: 'flex', color: 'var(--text-tertiary)' }}>
          <GripVertical size={14} />
        </span>
      </div>
      <div style={{ width: '30px', textAlign: 'center' }}>
        {isCurrentSong && isPlaying ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '2px' }}>
            <span style={{ width: '3px', height: '12px', backgroundColor: 'var(--accent-color)', animation: 'soundBar 0.5s ease-in-out infinite' }} />
            <span style={{ width: '3px', height: '16px', backgroundColor: 'var(--accent-color)', animation: 'soundBar 0.5s ease-in-out infinite', animationDelay: '0.1s' }} />
            <span style={{ width: '3px', height: '10px', backgroundColor: 'var(--accent-color)', animation: 'soundBar 0.5s ease-in-out infinite', animationDelay: '0.2s' }} />
          </div>
        ) : (
          <span style={{ fontSize: '13px', color: isCurrentSong ? 'var(--accent-color)' : 'var(--text-tertiary)' }}>{index + 1}</span>
        )}
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
        <div style={{ width: '40px', height: '40px', borderRadius: '4px', overflow: 'hidden', backgroundColor: 'var(--hover-bg)', flexShrink: 0 }}>
          {song.cover ? <img src={coverSrc} alt={song.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: '14px', fontWeight: isCurrentSong ? 600 : 400, color: isCurrentSong ? 'var(--accent-color)' : 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {song.name}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {song.artist}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: '4px' }}>
        <button onClick={(e) => { e.stopPropagation(); onDownload(song); }}
          style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '6px', borderRadius: '50%', color: 'var(--text-tertiary)' }}>
          <Download size={14} />
        </button>
        <button onClick={(e) => { e.stopPropagation(); onRemove(song); }}
          style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '6px', borderRadius: '50%', color: 'var(--text-tertiary)' }}>
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
});

const PlaylistDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const playlistId = id ? parseInt(id, 10) : undefined;

  const [songs, setSongs] = useState<Song[]>([]);
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [loading, setLoading] = useState(false);
  const [isEditModalVisible, setIsEditModalVisible] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');

  const { currentSong, isPlaying, play, setCurrentPlaylist } = usePlayerStore();
  const { addSingleDownload, addBatchDownload } = useDownloadStore();
  const [isReordering, setIsReordering] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const refreshPlaylistSongs = async (songs: Song[]): Promise<Song[]> => {
    const results = await Promise.allSettled(
      songs.map(async (song) => {
        const cached: { url: string; cover: string; lrc: string } | null = await cacheService.getUrlCache(song.id);
        if (cached) {
          return { ...song, url: cached.url, cover: cached.cover, lrc: cached.lrc };
        }

        const keyword = `${song.name} ${song.artist}`;
        const result = await ipcRenderer.invoke('musicApi:searchSongs', keyword, 1, song.sourceType);
        if (!result.success || !result.data.length) return song;

        const fresh = result.data.find((s: Song) => s.id === song.id) || song;

        await cacheService.setUrlCache(song.id, {
          url: fresh.url,
          cover: fresh.cover,
          lrc: fresh.lrc,
        });

        return { ...song, url: fresh.url, cover: fresh.cover, lrc: fresh.lrc };
      })
    );

    return results.map((r, i) => (r.status === 'fulfilled' ? r.value : songs[i]));
  };

  const loadData = async () => {
    if (!playlistId) return;

    setLoading(true);
    try {
      const playlistData = await playlistService.getPlaylist(playlistId);
      setPlaylist(playlistData || null);

      const songsData = await playlistService.getPlaylistSongs(playlistId);
      const refreshedSongs = await refreshPlaylistSongs(songsData);
      setSongs(refreshedSongs);
    } catch (error) {
      console.error('加载歌单详情失败:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [playlistId]);

  const handlePlay = async (song: Song) => {
    await play(song);
  };

  const handlePlayAll = async () => {
    if (songs.length > 0) {
      setCurrentPlaylist(songs, 0);
      await handlePlay(songs[0]);
    }
  };

  const handleDownload = async (song: Song) => {
    try {
      const task = await ipcRenderer.invoke('download:start', song);
      if (task) {
        addSingleDownload(task);
      }
    } catch (error) {
      console.error('下载失败:', error);
      message.error('下载失败，请重试');
    }
  };

  const handleDownloadAll = async () => {
    if (songs.length === 0) return;
    try {
      const tasks = await ipcRenderer.invoke('download:startBatch', songs);
      if (tasks && Array.isArray(tasks)) {
        addBatchDownload(tasks);
      }
    } catch (error) {
      console.error('下载全部失败:', error);
      message.error('下载全部失败，请重试');
    }
  };

  const handleRemoveFromPlaylist = async (song: Song) => {
    if (!playlistId) return;
    try {
      await playlistService.removeSongFromPlaylist(playlistId, song.id);
      loadData();
      message.success(`已从歌单移除「${song.name}」`);
    } catch (error) {
      console.error('从歌单移除失败:', error);
      message.error('移除失败，请重试');
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !playlistId) return;

    const songIds = songs.map(s => s.id);
    const oldIndex = songIds.indexOf(String(active.id));
    const newIndex = songIds.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;

    const newSongIds = [...songIds];
    const [moved] = newSongIds.splice(oldIndex, 1);
    newSongIds.splice(newIndex, 0, moved);

    // Optimistically update UI
    const newSongs = [...songs];
    const [movedSong] = newSongs.splice(oldIndex, 1);
    newSongs.splice(newIndex, 0, movedSong);
    setSongs(newSongs);

    setIsReordering(true);
    try {
      await playlistService.bulkReorderPlaylistSongs(playlistId, newSongIds);
    } catch (error) {
      console.error('Reorder failed:', error);
      loadData();
    } finally {
      setIsReordering(false);
    }
  };

  const handleEditPlaylist = async () => {
    if (!playlistId || !editName.trim()) return;

    try {
      await playlistService.updatePlaylist(playlistId, {
        name: editName.trim(),
        description: editDesc.trim()
      });
      setIsEditModalVisible(false);
      loadData();
    } catch (error) {
      console.error('更新歌单失败:', error);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <div style={{ color: 'var(--text-tertiary)' }}>加载中...</div>
      </div>
    );
  }

  if (!playlist) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <div style={{ fontSize: '18px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
          歌单不存在
        </div>
        <button
          onClick={() => navigate('/playlists')}
          style={{
            padding: '8px 16px',
            backgroundColor: 'var(--accent-color)',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
          }}
        >
          返回歌单列表
        </button>
      </div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 页面标题 */}
      <div
        style={{
          padding: '24px 24px 16px',
          borderBottom: '1px solid var(--divider-color)',
          backgroundColor: 'var(--content-bg)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '16px' }}>
          <button
            onClick={() => navigate('/playlists')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 12px',
              backgroundColor: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-secondary)',
              fontSize: '14px',
            }}
          >
            <ArrowLeft size={16} />
            返回
          </button>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <Music size={24} color="var(--accent-color)" />
              <h1 style={{ fontSize: '24px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                {playlist.name}
              </h1>
              <button
                onClick={() => {
                  setEditName(playlist.name);
                  setEditDesc(playlist.description || '');
                  setIsEditModalVisible(true);
                }}
                style={{
                  padding: '4px 8px',
                  backgroundColor: 'transparent',
                  border: '1px solid var(--border-color)',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  color: 'var(--text-secondary)',
                }}
              >
                <Edit2 size={14} />
              </button>
            </div>
            {playlist.description && (
              <p style={{ fontSize: '14px', color: 'var(--text-tertiary)', margin: '8px 0 0 36px' }}>
                {playlist.description}
              </p>
            )}
          </div>
          <button
            onClick={handlePlayAll}
            disabled={songs.length === 0}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 16px',
              backgroundColor: 'var(--accent-color)',
              color: 'white',
              border: 'none',
              borderRadius: '20px',
              cursor: songs.length > 0 ? 'pointer' : 'not-allowed',
              opacity: songs.length > 0 ? 1 : 0.5,
              fontSize: '14px',
              fontWeight: 500,
            }}
          >
            <Play size={16} />
            播放全部
          </button>
          <button
            onClick={handleDownloadAll}
            disabled={songs.length === 0}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 16px',
              backgroundColor: 'transparent',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: '20px',
              cursor: songs.length > 0 ? 'pointer' : 'not-allowed',
              opacity: songs.length > 0 ? 1 : 0.5,
              fontSize: '14px',
              fontWeight: 500,
            }}
          >
            <Download size={16} />
            下载全部
          </button>
        </div>
        <div style={{ fontSize: '14px', color: 'var(--text-tertiary)' }}>
          {songs.length} 首歌曲
        </div>
      </div>

      {/* 歌曲列表 */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {isReordering && (
          <div style={{ padding: '8px 16px', fontSize: '12px', color: 'var(--text-tertiary)' }}>
            正在保存排序...
          </div>
        )}
        {/* Table header */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--divider-color)', fontSize: '12px', color: 'var(--text-tertiary)', fontWeight: 500 }}>
          <div style={{ width: '40px', textAlign: 'center' }}></div>
          <div style={{ width: '30px', textAlign: 'center' }}>#</div>
          <div style={{ flex: 1 }}>标题</div>
          <div style={{ width: '100px', textAlign: 'center' }}>操作</div>
        </div>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={songs.map(s => s.id)} strategy={verticalListSortingStrategy}>
            {songs.map((song, index) => (
              <SortableSongRow
                key={song.id}
                song={song}
                index={index}
                isCurrentSong={currentSong?.id === song.id}
                isPlaying={isPlaying}
                onPlay={handlePlay}
                onRemove={handleRemoveFromPlaylist}
                onDownload={handleDownload}
              />
            ))}
          </SortableContext>
        </DndContext>
      </div>

      {/* 编辑歌单弹窗 */}
      {isEditModalVisible && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setIsEditModalVisible(false)}
        >
          <div
            style={{
              width: '400px',
              backgroundColor: 'var(--content-bg)',
              borderRadius: '12px',
              padding: '24px',
              boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '16px' }}>
              编辑歌单
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '6px', fontSize: '14px', color: 'var(--text-secondary)' }}>
                  歌单名称
                </label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    fontSize: '14px',
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '6px', fontSize: '14px', color: 'var(--text-secondary)' }}>
                  歌单描述
                </label>
                <textarea
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  rows={3}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    fontSize: '14px',
                    resize: 'vertical',
                  }}
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '20px' }}>
              <button
                onClick={() => setIsEditModalVisible(false)}
                style={{
                  padding: '8px 16px',
                  backgroundColor: 'transparent',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  fontSize: '14px',
                  cursor: 'pointer',
                }}
              >
                取消
              </button>
              <button
                onClick={handleEditPlaylist}
                style={{
                  padding: '8px 16px',
                  backgroundColor: 'var(--accent-color)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '14px',
                  cursor: 'pointer',
                }}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PlaylistDetailPage;
