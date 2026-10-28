import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { COVER_SIZE, coverThumbUrl } from '@mplayer/core';
import { useParams, useLocation } from 'react-router-dom';
import { Play, Disc3, Download, CirclePlus } from 'lucide-react';
import SongList from '@/renderer/components/SongList';
import DetailToolbar from '@/renderer/components/DetailToolbar';
import BatchAddToPlaylistModal from '@/renderer/components/BatchAddToPlaylistModal';
import '@/renderer/styles/songlist.css';
import '@/renderer/styles/detail-page.css';
import { usePlayerStore } from '@/renderer/store/playerStore';
import { useFavoriteStore } from '@/renderer/store/favoriteStore';
import { useDownload } from '@/renderer/hooks/useDownload';
import { useDetailSelection } from '@/renderer/hooks/useDetailSelection';
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
  const [addToPlaylistOpen, setAddToPlaylistOpen] = useState(false);

  const play = usePlayerStore((s) => s.play);
  const currentSong = usePlayerStore((s) => s.currentSong);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const setCurrentPlaylist = usePlayerStore((s) => s.setCurrentPlaylist);
  const favoriteIds = useFavoriteStore((s) => s.favoriteIds);
  const toggleFavorite = useFavoriteStore((s) => s.toggleFavorite);
  const { download, downloadBatch } = useDownload();
  const selection = useDetailSelection(songs, albumId);
  const { visibleSongs, batchMode, selectedIds, setSelectedIds, selectedSongs, visibleSelectedCount } = selection;

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

  const handleDownloadAll = useCallback(() => {
    if (songs.length === 0) return;
    void downloadBatch(songs);
  }, [songs, downloadBatch]);

  const handleBatchDownload = useCallback(() => {
    if (selectedSongs.length === 0) return;
    void downloadBatch(selectedSongs);
  }, [selectedSongs, downloadBatch]);

  const handleBatchAddToPlaylist = useCallback(() => {
    if (selectedSongs.length > 0) setAddToPlaylistOpen(true);
  }, [selectedSongs]);

  const year = (() => {
    const t = Number(album?.publishTime || 0);
    return t > 0 ? String(new Date(t).getFullYear()) : '';
  })();
  const totalDuration = useMemo(
    () => songs.reduce((sum, s) => sum + (s.duration || 0), 0),
    [songs],
  );

  const batchActions = useMemo(() => [
    { key: 'download', label: '批量下载', icon: <Download size={12} />, onClick: handleBatchDownload },
    { key: 'playlist', label: '加入歌单', icon: <CirclePlus size={12} />, onClick: handleBatchAddToPlaylist },
  ], [handleBatchDownload, handleBatchAddToPlaylist]);

  return (
    <div className="detail-page">
      {/* hero 与列表同一滚动上下文（#700）：整页一个滚动容器，hero 不再固定 */}
      <div className="detail-page__scroll" data-scroll-container>
        <PageHero
          className="detail-page__hero"
          media={
            <div className="detail-page__cover">
              {/* 占位层（无封面/加载失败时显示），img 成功后覆盖其上 */}
              <div className="detail-page__cover-placeholder">
                <Disc3 size={56} />
              </div>
              {displayPic && (
                <img
                  key={displayPic}
                  src={coverThumbUrl(displayPic, COVER_SIZE.thumb)}
                  alt={displayName}
                  loading="lazy"
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  className="detail-page__cover-img"
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
            <>
              <Button
                variant="primary"
                size="sm"
                icon={<Play size={15} aria-hidden="true" />}
                onClick={handlePlayAll}
                disabled={songs.length === 0 || loading}
              >
                播放全部
              </Button>
              <Button
                size="sm"
                icon={<Download size={15} aria-hidden="true" />}
                onClick={handleDownloadAll}
                disabled={songs.length === 0 || loading}
              >
                下载全部
              </Button>
            </>
          }
        />

        <div className="detail-page__list">
          {error && songs.length === 0 ? (
            <div className="detail-page__error">{error}</div>
          ) : (
            <>
              <DetailToolbar
                filterValue={selection.filterQuery}
                onFilterChange={selection.setFilterQuery}
                matchedCount={visibleSongs.length}
                totalCount={songs.length}
                selecting={batchMode}
                onToggleSelecting={selection.toggleBatchMode}
                onSelectAll={selection.selectAllVisible}
                allSelected={selection.allVisibleSelected}
                selectedCount={visibleSelectedCount}
                batchActions={batchActions}
              />
              <SongList
                songs={songs}
                currentSongId={currentSong?.id}
                isPlaying={isPlaying}
                favoriteIds={favoriteIds}
                onPlay={handlePlay}
                onSwap={(original, swapped) => setSongs(prev => prev.map(s => s.id === original.id ? swapped : s))}
                onToggleFavorite={toggleFavorite}
                onDownload={download}
                density="library"
                showDuration
                showCheckbox={batchMode}
                selectedIds={selectedIds}
                onSelectionChange={setSelectedIds}
                loading={loading && songs.length === 0}
                emptyText={selection.isFiltering ? `没有匹配「${selection.filterQuery.trim()}」的歌曲` : '暂无歌曲数据'}
              />
            </>
          )}
        </div>
      </div>
      {/* 批量加入歌单：只在有可见已选项时挂载，弹窗按需加载歌单列表 */}
      {batchMode && selectedSongs.length > 0 && (
        <BatchAddToPlaylistModal
          songs={selectedSongs}
          isVisible={addToPlaylistOpen}
          onClose={() => setAddToPlaylistOpen(false)}
        />
      )}
    </div>
  );
};

export default AlbumDetailPage;
