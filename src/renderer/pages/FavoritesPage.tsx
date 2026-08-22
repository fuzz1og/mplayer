import React, { useEffect, useState } from 'react';
import { Heart, Play } from 'lucide-react';
import { useFavoriteStore } from '@/renderer/store/favoriteStore';
import { usePlayerStore } from '@/renderer/store/playerStore';
import { useDownload } from '@/renderer/hooks/useDownload';
import SongList from '@/renderer/components/SongList';
import BatchAddToPlaylistModal from '@/renderer/components/BatchAddToPlaylistModal';
import { refreshSongCover } from '@/renderer/utils/songCoverRefresh';
import type { Song } from '@mplayer/core';

const FavoritesPage: React.FC = () => {
  const favorites = useFavoriteStore((s) => s.favorites);
  const loadFavorites = useFavoriteStore((s) => s.loadFavorites);
  const toggleFavorite = useFavoriteStore((s) => s.toggleFavorite);
  const currentSong = usePlayerStore((s) => s.currentSong);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const play = usePlayerStore((s) => s.play);
  const setCurrentPlaylist = usePlayerStore((s) => s.setCurrentPlaylist);
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

  // 封面加载失败 → 按 ID 重识别换新封面并更新收藏列表（收藏封面常为空/过期）
  const handleCoverError = (song: Song) => {
    void refreshSongCover(song).then((cover) => {
      if (!cover) return;
      useFavoriteStore.setState((state) => ({
        favorites: state.favorites.map((s) => (s.id === song.id ? { ...s, cover } : s)),
      }));
    });
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
          borderBottom: '1px solid var(--border-subtle)',
          backgroundColor: 'var(--bg-surface)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <Heart size={24} color="var(--text-secondary)" />
            <h1 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
              我的收藏
            </h1>
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>
              · {favorites.length} 首歌曲
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
              backgroundColor: 'var(--accent)',
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
          onSwap={(original, swapped) => {
            void useFavoriteStore.getState().replaceFavorite(original.id, swapped).catch((e) => {
              console.error('换源保存到收藏失败:', e);
            });
          }}
          onCoverError={handleCoverError}
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
