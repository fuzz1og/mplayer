import React, { useState, useEffect, useCallback } from 'react';
import { COVER_SIZE, coverThumbUrl } from '@mplayer/core';
import { useParams, useLocation } from 'react-router-dom';
import { Play, Disc3 } from 'lucide-react';
import SongList from '@/renderer/components/SongList';
import '@/renderer/styles/songlist.css';
import { usePlayerStore } from '@/renderer/store/playerStore';
import { useFavoriteStore } from '@/renderer/store/favoriteStore';
import { useDownload } from '@/renderer/hooks/useDownload';
import { callMusicApi } from '@/renderer/services/callMusicApi';
import { Button, PageHero } from '@/renderer/ui';
import type { Album, Song } from '@mplayer/core';

function formatDuration(sec?: number): string {
  if (!sec || sec <= 0) return '--:--';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return m + ':' + s;
}

const AlbumDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const albumId = id || '';
  // 路由 state 带来首屏信息(封面/名称/艺人),详情返回后补齐
  const stateName = (location.state as any)?.name as string | undefined;
  const statePic = (location.state as any)?.picUrl as string | undefined;
  const stateArtist = (location.state as any)?.artist as string | undefined;

  const [album, setAlbum] = useState<Album | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const play = usePlayerStore((s) => s.play);
  const currentSong = usePlayerStore((s) => s.currentSong);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const setCurrentPlaylist = usePlayerStore((s) => s.setCurrentPlaylist);
  const favoriteIds = useFavoriteStore((s) => s.favoriteIds);
  const toggleFavorite = useFavoriteStore((s) => s.toggleFavorite);
  const { download, downloadBatch } = useDownload();

  const displayName = album?.name || stateName || '';
  const displayPic = album?.picUrl || statePic || '';
  const displayArtist = album?.artist || stateArtist || '';

  useEffect(() => {
    const load = async () => {
      if (!albumId) return;
      setLoading(true);
      setError(null);
      try {
        // weapi 批量直链即可：无 URL 歌曲（无版权等）播放时由 playerStore 走
        // 路由解析（旧逐首搜索兜底已随自建 API 退役删除，#244/#275）
        const detail = await callMusicApi('getAlbumDetail', 'netease', albumId);
        if (detail) {
          setAlbum(detail.album);
          setSongs(detail.songs);
        } else {
          setError('专辑加载失败');
        }
      } catch (e: any) {
        console.error('加载专辑详情失败:', e);
        setError(e?.message || '专辑加载失败');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [albumId]);

  const handlePlay = useCallback((song: Song, queue: Song[], index: number) => {
    setCurrentPlaylist(queue, index);
    void play(song);
  }, [setCurrentPlaylist, play]);

  const handlePlayAll = useCallback(() => {
    if (songs.length === 0) return;
    setCurrentPlaylist(songs, 0);
    void play(songs[0]);
  }, [songs, setCurrentPlaylist, play]);

  const year = (() => {
    const t = Number(album?.publishTime || 0);
    return t > 0 ? String(new Date(t).getFullYear()) : '';
  })();
  const totalDuration = songs.reduce((sum, s) => sum + (s.duration || 0), 0);

  return (
    <div className="detail-page">
      {/* hero 与列表同一滚动上下文（#700）：整页一个滚动容器，hero 不再固定 */}
      <div className="detail-page__scroll">
        <PageHero
          className="album__hero"
          media={
            <div className="album__cover">
              {/* 占位层（无封面/加载失败时显示），img 成功后覆盖其上 */}
              <div className="album__cover-placeholder">
                <Disc3 size={56} />
              </div>
              {displayPic && (
                <img
                  key={displayPic}
                  src={coverThumbUrl(displayPic, COVER_SIZE.thumb)}
                  alt={displayName}
                  loading="lazy"
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  className="album__cover-img"
                />
              )}
            </div>
          }
          eyebrow="专辑"
          title={displayName || '专辑'}
          meta={
            <>
              {displayArtist && <span>{displayArtist}</span>}
              {year && <span>{year}</span>}
              {songs.length > 0 && <span>{songs.length} 首 · 总时长 {formatDuration(totalDuration)}</span>}
            </>
          }
          actions={
            <Button
              variant="primary"
              size="sm"
              icon={<Play size={15} aria-hidden="true" />}
              onClick={handlePlayAll}
              disabled={songs.length === 0 || loading}
            >
              播放全部
            </Button>
          }
        />

        <div className="album__list">
          {error && songs.length === 0 ? (
            <div className="album__error">{error}</div>
          ) : (
            <SongList
              songs={songs}
              currentSongId={currentSong?.id}
              isPlaying={isPlaying}
              favoriteIds={favoriteIds}
              onPlay={handlePlay}
              onSwap={(original, swapped) => setSongs(prev => prev.map(s => s.id === original.id ? swapped : s))}
              onToggleFavorite={toggleFavorite}
              onDownload={download}
              onBatchDownload={downloadBatch}
              showHeader={true}
              showIndex={true}
              enableBatchDownload={true}
              enableBatchAddToPlaylist={true}
              loading={loading && songs.length === 0}
              emptyText="暂无歌曲数据"
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default AlbumDetailPage;
