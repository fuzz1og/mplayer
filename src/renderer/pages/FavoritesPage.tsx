import React, { useEffect, useState } from 'react';
import { Heart, Play } from 'lucide-react';
import { ipcRenderer } from 'electron';
import { message } from 'antd';
import { useFavoriteStore } from '@/renderer/store/favoriteStore';
import { usePlayerStore } from '@/renderer/store/playerStore';
import { useDownloadStore } from '@/renderer/store/downloadStore';
import SongList from '@/renderer/components/SongList';
import BatchAddToPlaylistModal from '@/renderer/components/BatchAddToPlaylistModal';
import type { Song } from '@/shared/types/song';

interface FavoritesPageProps {
  onPlay: (song: Song) => void;
  onAddToPlaylist?: (song: Song) => void;
}

const FavoritesPage: React.FC<FavoritesPageProps> = ({ onPlay, onAddToPlaylist }) => {
  const { favorites, loadFavorites, toggleFavorite } = useFavoriteStore();
  const { currentSong, isPlaying } = usePlayerStore();
  const { addSingleDownload, addBatchDownload } = useDownloadStore();

  const [batchModalVisible, setBatchModalVisible] = useState(false);
  const [selectedSongsForPlaylist, setSelectedSongsForPlaylist] = useState<Song[]>([]);

  useEffect(() => {
    loadFavorites();
  }, [loadFavorites]);

  const handleToggleFavorite = async (song: Song) => {
    try {
      await toggleFavorite(song);
    } catch (error) {
      console.error('收藏操作失败:', error);
    }
  };

  const handlePlayAll = () => {
    if (favorites.length > 0) {
      onPlay(favorites[0]);
    }
  };

  const handleBatchDownload = async (selectedSongs: Song[]) => {
    try {
      const tasks = await ipcRenderer.invoke('download:startBatch', selectedSongs);
      if (tasks && Array.isArray(tasks)) {
        addBatchDownload(tasks);
      }
    } catch (error) {
      console.error('批量下载失败:', error);
      message.error('批量下载失败，请重试');
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

  const handleBatchDelete = async (selectedSongs: Song[]) => {
    try {
      await Promise.all(selectedSongs.map(song => toggleFavorite(song)));
      message.success(`已成功取消 ${selectedSongs.length} 首歌曲的收藏`);
    } catch (error) {
      console.error('批量删除失败:', error);
      message.error('批量删除失败，请重试');
    }
  };

  const handleBatchAddToPlaylist = (selectedSongs: Song[]) => {
    setSelectedSongsForPlaylist(selectedSongs);
    setBatchModalVisible(true);
  };

  const handleBatchAddSuccess = () => {
    message.success(`已添加到歌单`);
    setBatchModalVisible(false);
  };

  return (
    <div style={{ padding: '24px', height: '100%', overflow: 'auto' }}>
      {/* 页面头部 */}
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
        {/* 封面 */}
        <div
          style={{
            width: '180px',
            height: '180px',
            borderRadius: '8px',
            background: 'linear-gradient(135deg, #FF6B6B 0%, #EE5A6F 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 8px 24px rgba(238, 90, 111, 0.3)',
            flexShrink: 0,
          }}
        >
          <Heart size={64} color="white" fill="white" />
        </div>

        {/* 信息 */}
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
          <h1
            style={{
              fontSize: '32px',
              fontWeight: 700,
              color: 'var(--text-primary)',
              marginBottom: '12px',
            }}
          >
            我的收藏
          </h1>
          <div
            style={{
              fontSize: '14px',
              color: 'var(--text-secondary)',
              marginBottom: '16px',
            }}
          >
            共 {favorites.length} 首歌曲
          </div>

          {/* 操作按钮 */}
          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={handlePlayAll}
              disabled={favorites.length === 0}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '10px 24px',
                backgroundColor: favorites.length > 0 ? 'var(--primary-color)' : 'var(--text-light)',
                color: 'white',
                border: 'none',
                borderRadius: '24px',
                fontSize: '14px',
                fontWeight: 600,
                cursor: favorites.length > 0 ? 'pointer' : 'not-allowed',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                if (favorites.length > 0) {
                  e.currentTarget.style.backgroundColor = 'var(--primary-hover)';
                  e.currentTarget.style.transform = 'scale(1.02)';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = favorites.length > 0 ? 'var(--primary-color)' : 'var(--text-light)';
                e.currentTarget.style.transform = 'scale(1)';
              }}
            >
              <Play size={18} fill="white" />
              播放全部
            </button>
          </div>
        </div>
      </div>

      {/* 歌曲列表 */}
      <SongList
        songs={favorites}
        currentSongId={currentSong?.id}
        isPlaying={isPlaying}
        favoriteIds={favorites.map(s => s.id)}
        onPlay={onPlay}
        onToggleFavorite={handleToggleFavorite}
        showCheckbox={true}
        enableBatchDownload={true}
        onBatchDownload={handleBatchDownload}
        onDownload={handleDownload}
        enableBatchDelete={true}
        onBatchDelete={handleBatchDelete}
        enableBatchAddToPlaylist={true}
        onBatchAddToPlaylist={handleBatchAddToPlaylist}
        onAddToPlaylist={onAddToPlaylist}
        emptyText="暂无收藏歌曲，去发现音乐吧"
      />

      <BatchAddToPlaylistModal
        songs={selectedSongsForPlaylist}
        isVisible={batchModalVisible}
        onClose={() => setBatchModalVisible(false)}
        onSuccess={handleBatchAddSuccess}
      />
    </div>
  );
};

export default FavoritesPage;
