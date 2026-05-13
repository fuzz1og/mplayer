import React, { useEffect, useState } from 'react';
import { Play, ArrowLeft, Edit2, Music } from 'lucide-react';
import { useParams, useNavigate } from 'react-router-dom';
import { usePlayerStore } from '@/renderer/store/playerStore';
import { playlistService } from '@/renderer/services/playlistService';
import SongList from '@/renderer/components/SongList';
import type { Song, Playlist } from '@/shared/types/song';
import { cacheService } from '@/renderer/services/cacheService';

const { ipcRenderer } = window.require('electron');

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

  const refreshPlaylistSongs = async (songs: Song[]): Promise<Song[]> => {
    const results = await Promise.allSettled(
      songs.map(async (song) => {
        const cached = await cacheService.getUrlCache(song.id);
        if (cached) {
          return { ...song, url: cached.url, cover: cached.cover, lrc: cached.lrc };
        }

        const keyword = `${song.name} ${song.artist}`;
        const result = await ipcRenderer.invoke('musicApi:searchSongs', keyword, 1, song.sourceType);
        if (!result.success || !result.data.length) return song;

        const fresh = result.data.find((s: Song) => s.id === song.id) || result.data[0];

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
        </div>
        <div style={{ fontSize: '14px', color: 'var(--text-tertiary)' }}>
          {songs.length} 首歌曲
        </div>
      </div>

      {/* 歌曲列表 */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <SongList
          songs={songs}
          currentSongId={currentSong?.id}
          isPlaying={isPlaying}
          onPlay={handlePlay}
          showCheckbox={false}
          emptyText="歌单暂无歌曲"
        />
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
