import React, { useEffect, useState } from 'react';
import { Play, ArrowLeft, Edit2, Music } from 'lucide-react';
import { usePlayerStore } from '@/renderer/store/playerStore';
import { playlistService } from '@/renderer/services/playlistService';
import SongList from '@/renderer/components/SongList';
import type { Song, Playlist } from '@/shared/types/song';

interface PlaylistDetailPageProps {
  playlistId?: number;
  onPlay: (song: Song) => void;
  onBack: () => void;
  onDownload?: (song: Song) => void;
  onBatchDownload?: (songs: Song[]) => void;
  onAddToPlaylist?: (song: Song) => void;
}

const PlaylistDetailPage: React.FC<PlaylistDetailPageProps> = ({
  playlistId,
  onPlay,
  onBack,
  onDownload,
  onBatchDownload,
  onAddToPlaylist
}) => {
  const [songs, setSongs] = useState<Song[]>([]);
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [loading, setLoading] = useState(false);
  const [isEditModalVisible, setIsEditModalVisible] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const { currentSong, isPlaying, setCurrentPlaylist } = usePlayerStore();

  const loadData = async () => {
    setLoading(true);
    try {
      if (playlistId !== undefined) {
        const [playlistData, songsData] = await Promise.all([
          playlistService.getPlaylist(playlistId),
          playlistService.getPlaylistSongs(playlistId)
        ]);
        setPlaylist(playlistData || null);
        setSongs(songsData);
        if (playlistData) {
          setEditName(playlistData.name);
          setEditDesc(playlistData.description || '');
        }
      }
    } catch (error) {
      console.error('加载歌单失败:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [playlistId]);

  const handlePlayAll = () => {
    if (songs.length > 0) {
      setCurrentPlaylist(songs, 0);
      onPlay(songs[0]);
    }
  };

  const handlePlaySong = (song: Song) => {
    const songIndex = songs.findIndex(s => s.id === song.id);
    setCurrentPlaylist(songs, songIndex >= 0 ? songIndex : 0);
    onPlay(song);
  };

  const handleBatchDelete = async (selectedSongs: Song[]) => {
    try {
      if (playlistId !== undefined) {
        for (const song of selectedSongs) {
          await playlistService.removeSongFromPlaylist(playlistId, song.id);
        }
      }
      setSongs(prev => prev.filter(s => !selectedSongs.find(sel => sel.id === s.id)));
    } catch (error) {
      console.error('批量删除失败:', error);
    }
  };

  const handleBatchAddToPlaylist = (selectedSongs: Song[]) => {
    console.log('批量加入歌单:', selectedSongs);
  };

  const handleSaveEdit = async () => {
    if (!editName.trim() || !playlistId) return;
    try {
      await playlistService.updatePlaylist(playlistId, {
        name: editName.trim(),
        description: editDesc.trim() || undefined
      });
      setIsEditModalVisible(false);
      loadData();
    } catch (error) {
      console.error('更新歌单失败:', error);
    }
  };



  return (
    <div style={{ padding: '24px', height: '100%', overflow: 'auto' }}>
      <button
        onClick={onBack}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '8px 12px',
          backgroundColor: 'transparent',
          border: 'none',
          color: 'var(--text-secondary)',
          fontSize: '14px',
          cursor: 'pointer',
          borderRadius: '6px',
          transition: 'all 0.15s ease',
          marginBottom: '16px',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = 'var(--hover-bg)';
          e.currentTarget.style.color = 'var(--text-primary)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'transparent';
          e.currentTarget.style.color = 'var(--text-secondary)';
        }}
      >
        <ArrowLeft size={18} />
        返回
      </button>

      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: '24px',
          marginBottom: '32px',
          paddingBottom: '24px',
          borderBottom: '1px solid var(--divider-color)',
        }}
      >
        <div
          style={{
            width: '180px',
            height: '180px',
            borderRadius: '8px',
            background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 8px 24px rgba(245, 87, 108, 0.3)',
            flexShrink: 0,
          }}
        >
          <Music size={64} color="white" />
        </div>

        <div style={{ flex: 1, paddingBottom: '8px' }}>
          <div
            style={{
              fontSize: '12px',
              color: 'var(--text-tertiary)',
              textTransform: 'uppercase',
              letterSpacing: '1px',
              marginBottom: '8px',
            }}
          >
            歌单
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
            <h1
              style={{
                fontSize: '32px',
                fontWeight: 700,
                color: 'var(--text-primary)',
                margin: 0,
              }}
            >
              {playlist?.name || '歌单'}
            </h1>
            {playlist && (
              <button
                onClick={() => setIsEditModalVisible(true)}
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  backgroundColor: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-tertiary)',
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--hover-bg)';
                  e.currentTarget.style.color = 'var(--text-primary)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                  e.currentTarget.style.color = 'var(--text-tertiary)';
                }}
              >
                <Edit2 size={18} />
              </button>
            )}
          </div>
          <div
            style={{
              fontSize: '14px',
              color: 'var(--text-secondary)',
              marginBottom: '16px',
            }}
          >
            {playlist?.description || `共 ${songs.length} 首歌曲`}
          </div>

          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={handlePlayAll}
              disabled={songs.length === 0}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '10px 24px',
                backgroundColor: songs.length > 0 ? 'var(--primary-color)' : 'var(--text-light)',
                color: 'white',
                border: 'none',
                borderRadius: '24px',
                fontSize: '14px',
                fontWeight: 600,
                cursor: songs.length > 0 ? 'pointer' : 'not-allowed',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                if (songs.length > 0) {
                  e.currentTarget.style.backgroundColor = 'var(--primary-hover)';
                  e.currentTarget.style.transform = 'scale(1.02)';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = songs.length > 0 ? 'var(--primary-color)' : 'var(--text-light)';
                e.currentTarget.style.transform = 'scale(1)';
              }}
            >
              <Play size={18} fill="white" />
              播放全部
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '60px 20px',
            color: 'var(--text-tertiary)',
          }}
        >
          <div style={{ fontSize: '14px' }}>加载中...</div>
        </div>
      ) : (
        <SongList
          songs={songs}
          currentSongId={currentSong?.id}
          isPlaying={isPlaying}
          favoriteIds={[]}
          onPlay={handlePlaySong}
          showCheckbox={true}
          enableBatchDownload={onDownload !== undefined && onBatchDownload !== undefined}
          onBatchDownload={onBatchDownload}
          onDownload={onDownload}
          enableBatchDelete={true}
          onBatchDelete={handleBatchDelete}
          enableBatchAddToPlaylist={true}
          onBatchAddToPlaylist={handleBatchAddToPlaylist}
          onAddToPlaylist={onAddToPlaylist}
          emptyText="暂无歌曲"
        />
      )}

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
            <h3
              style={{
                fontSize: '18px',
                fontWeight: 600,
                color: 'var(--text-primary)',
                marginBottom: '20px',
              }}
            >
              编辑歌单
            </h3>

            <div style={{ marginBottom: '16px' }}>
              <label
                style={{
                  display: 'block',
                  fontSize: '13px',
                  color: 'var(--text-secondary)',
                  marginBottom: '6px',
                }}
              >
                歌单名称
              </label>
              <input
                type="text"
                placeholder="请输入歌单名称"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  fontSize: '14px',
                  outline: 'none',
                  backgroundColor: 'var(--bg-color)',
                }}
              />
            </div>

            <div style={{ marginBottom: '24px' }}>
              <label
                style={{
                  display: 'block',
                  fontSize: '13px',
                  color: 'var(--text-secondary)',
                  marginBottom: '6px',
                }}
              >
                歌单描述（可选）
              </label>
              <textarea
                placeholder="请输入歌单描述"
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                rows={3}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  fontSize: '14px',
                  outline: 'none',
                  backgroundColor: 'var(--bg-color)',
                  resize: 'none',
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
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
                  transition: 'all 0.15s ease',
                }}
              >
                取消
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={!editName.trim()}
                style={{
                  padding: '8px 16px',
                  backgroundColor: editName.trim() ? 'var(--primary-color)' : 'var(--text-light)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '14px',
                  cursor: editName.trim() ? 'pointer' : 'not-allowed',
                  transition: 'all 0.15s ease',
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
