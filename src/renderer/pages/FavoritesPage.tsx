import React, { useEffect, useState } from 'react';
import { Heart, Play } from 'lucide-react';
import { useFavoriteStore } from '@/renderer/store/favoriteStore';
import { usePlayerStore } from '@/renderer/store/playerStore';
import { useDownload } from '@/renderer/hooks/useDownload';
import SongList from '@/renderer/components/SongList';
import BatchAddToPlaylistModal from '@/renderer/components/BatchAddToPlaylistModal';
import type { Song } from '@/shared/types/song';

const FavoritesPage: React.FC = () => {
  const { favorites, loadFavorites, toggleFavorite } = useFavoriteStore();
  const { currentSong, isPlaying, play, setCurrentPlaylist } = usePlayerStore();
  const { download, downloadBatch } = useDownload();

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

  const handlePlay = async (song: Song) => {
    await play(song);
  };

  const handlePlayAll = async () => {
    if (favorites.length > 0) {
      setCurrentPlaylist(favorites, 0);
      await handlePlay(favorites[0]);
    }
  };

  const handleAddToPlaylist = (song: Song) => {
    setSelectedSongsForPlaylist([song]);
    setBatchModalVisible(true);
  };

  const handleBatchAddToPlaylist = (selectedSongs: Song[]) => {
    setSelectedSongsForPlaylist(selectedSongs);
    setBatchModalVisible(true);
  };

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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <Heart size={24} color="var(--accent-color)" />
            <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
              我的收藏
            </h1>
            <span style={{ fontSize: 'var(--text-base)', color: 'var(--text-tertiary)', marginLeft: '8px' }}>
              {favorites.length} 首歌曲
            </span>
          </div>
          <button
            onClick={handlePlayAll}
            disabled={favorites.length === 0}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 16px',
              backgroundColor: 'var(--accent-color)',
              color: 'white',
              border: 'none',
              borderRadius: '20px',
              cursor: favorites.length > 0 ? 'pointer' : 'not-allowed',
              opacity: favorites.length > 0 ? 1 : 0.5,
              fontSize: 'var(--text-base)',
              fontWeight: 500,
            }}
          >
            <Play size={16} />
            播放全部
          </button>
        </div>
      </div>

      {/* 歌曲列表 */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <SongList
          songs={favorites}
          currentSongId={currentSong?.id}
          isPlaying={isPlaying}
          favoriteIds={favorites.map(s => s.id)}
          onPlay={handlePlay}
          onToggleFavorite={handleToggleFavorite}
          onDownload={download}
          onBatchDownload={downloadBatch}
          onAddToPlaylist={handleAddToPlaylist}
          onBatchAddToPlaylist={handleBatchAddToPlaylist}
          showCheckbox={true}
          enableBatchDownload={true}
          enableBatchAddToPlaylist={true}
          emptyText="暂无收藏歌曲"
        />
      </div>

      {/* 批量添加到歌单弹窗 */}
      <BatchAddToPlaylistModal
        isVisible={batchModalVisible}
        songs={selectedSongsForPlaylist}
        onClose={() => {
          setBatchModalVisible(false);
          setSelectedSongsForPlaylist([]);
        }}
      />
    </div>
  );
};

export default FavoritesPage;
