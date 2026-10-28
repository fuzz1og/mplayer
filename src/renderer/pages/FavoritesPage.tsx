import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Play } from 'lucide-react';
import { useFavoriteStore } from '@/renderer/store/favoriteStore';
import { usePlayerStore } from '@/renderer/store/playerStore';
import { useDownload } from '@/renderer/hooks/useDownload';
import SongList from '@/renderer/components/SongList';
import CollectionGrid from '@/renderer/components/CollectionGrid';
import { refreshSongCover } from '@/renderer/utils/songCoverRefresh';
import { Button, PageHeader, Segmented } from '@/renderer/ui';
import type { Song } from '@mplayer/core';
import '@/renderer/styles/songlist.css';

/** 内容库三视角（#694）：歌曲 / 专辑 / 歌手是同一批收藏的三种看法，不是三个内容库。 */
const VIEW_OPTIONS = ['歌曲', '专辑', '歌手'];

const FavoritesPage: React.FC = () => {
  const favorites = useFavoriteStore((s) => s.favorites);
  const loadFavorites = useFavoriteStore((s) => s.loadFavorites);
  const toggleFavorite = useFavoriteStore((s) => s.toggleFavorite);
  const currentSong = usePlayerStore((s) => s.currentSong);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const play = usePlayerStore((s) => s.play);
  const setCurrentPlaylist = usePlayerStore((s) => s.setCurrentPlaylist);
  const { download, downloadBatch } = useDownload();
  const [view, setView] = useState(VIEW_OPTIONS[0]);

  // 收藏页的歌曲就是收藏本身：id 列表跟着 favorites 走，别在每次渲染新建数组（行 memo 会被击穿）
  const favoriteIdList = useMemo(() => favorites.map(s => s.id), [favorites]);

  useEffect(() => {
    loadFavorites();
  }, [loadFavorites]);

  const handleToggleFavorite = useCallback(async (song: Song) => {
    try {
      await toggleFavorite(song);
    } catch (error) {
      console.error('收藏操作失败:', error);
    }
  }, [toggleFavorite]);

  const handlePlay = useCallback(async (song: Song, queue: Song[], index: number) => {
    // #697：建队列归调用方，列表只回传展示队列与索引
    setCurrentPlaylist(queue, index);
    await play(song);
  }, [play, setCurrentPlaylist]);

  // 封面加载失败 → 按 ID 重识别换新封面并更新收藏列表（收藏封面常为空/过期）
  const handleCoverError = useCallback((song: Song) => {
    void refreshSongCover(song).then((cover) => {
      if (!cover) return;
      useFavoriteStore.setState((state) => ({
        favorites: state.favorites.map((s) => (s.id === song.id ? { ...s, cover } : s)),
      }));
    });
  }, []);

  const handlePlayAll = useCallback(() => {
    if (favorites.length > 0) void handlePlay(favorites[0], favorites, 0);
  }, [favorites, handlePlay]);

  // SongList 行内「加入歌单」由组件内部单曲弹窗闭环，此 prop 仅作成功通知（勿在此开弹窗）
  const handleAddToPlaylist = useCallback((_song: Song) => {}, []);

  const handleSwap = useCallback((original: Song, swapped: Song) => {
    void useFavoriteStore.getState().replaceFavorite(original.id, swapped).catch((e) => {
      console.error('换源保存到收藏失败:', e);
    });
  }, []);

  const handlePlayCollection = useCallback((songs: Song[], index: number) => {
    const song = songs[index];
    if (song) void handlePlay(song, songs, index);
  }, [handlePlay]);

  return (
    <div className="list-page">
      <PageHeader
        title="我喜欢的音乐"
        lead={<span className="list-page__count">{favorites.length} 首歌曲</span>}
        actions={
          <Button
            variant="primary"
            size="sm"
            icon={<Play size={15} aria-hidden="true" />}
            onClick={handlePlayAll}
            disabled={favorites.length === 0}
          >
            播放全部
          </Button>
        }
      />

      <div className="list-page__tabs">
        <Segmented
          options={VIEW_OPTIONS}
          value={view}
          onChange={setView}
          ariaLabel="我喜欢的音乐视图"
        />
      </div>

      <div className="list-page__body">
        {view === '歌曲' ? (
          <SongList
            density="library"
            showDuration
            songs={favorites}
            currentSongId={currentSong?.id}
            isPlaying={isPlaying}
            favoriteIds={favoriteIdList}
            onPlay={handlePlay}
            onToggleFavorite={handleToggleFavorite}
            onDownload={download}
            onBatchDownload={downloadBatch}
            onAddToPlaylist={handleAddToPlaylist}
            onSwap={handleSwap}
            onCoverError={handleCoverError}
            enableBatchDownload={true}
            enableBatchAddToPlaylist={true}
            emptyText="还没有喜欢的歌曲，点歌曲行右侧的爱心收藏"
          />
        ) : (
          <CollectionGrid
            view={view === '专辑' ? 'albums' : 'artists'}
            songs={favorites}
            onPlayCollection={handlePlayCollection}
          />
        )}
      </div>
    </div>
  );
};

export default FavoritesPage;
