import React, { useCallback, useEffect, useRef, useState } from 'react';
import '@/renderer/styles/page-discover.css';
import '@/renderer/styles/detail-page.css';
import { COVER_SIZE, coverThumbUrl } from '@mplayer/core';
import { useParams, useNavigate } from 'react-router-dom';
import { CirclePlus, Download, Music2, Play } from 'lucide-react';
import { toast } from '@/renderer/services/toastStore';
import { Button, PageHero, useConfirm } from '@/renderer/ui';
import SongList from '@/renderer/components/SongList';
import DetailToolbar from '@/renderer/components/DetailToolbar';
import BatchAddToPlaylistModal from '@/renderer/components/BatchAddToPlaylistModal';
import { useDetailSelection } from '@/renderer/hooks/useDetailSelection';
import { usePlayerStore } from '@/renderer/store/playerStore';
import { useFavoriteStore } from '@/renderer/store/favoriteStore';
import { useDownload } from '@/renderer/hooks/useDownload';
import { createDesktopPlaylistWriter } from '@/renderer/services/playlistWriteAdapter';
import type { DesktopPlaylistWriter } from '@/renderer/services/playlistWriteAdapter';
import { useInfiniteScroll } from '@/renderer/hooks/useInfiniteScroll';
import { callMusicApi } from '@/renderer/services/callMusicApi';
import type { Song, DiscoverPlaylist } from '@mplayer/core';
import { formatPlayCount } from '@mplayer/core';

const PAGE_SIZE = 20;

/** 桌面唯一的写入 adapter（#552）：新建/整批写入/失败回滚全在它后面。 */
const desktopWriter: DesktopPlaylistWriter = createDesktopPlaylistWriter();

const DiscoverPlaylistDetailPage: React.FC = () => {
  const confirm = useConfirm();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const play = usePlayerStore((s) => s.play);
  const currentSong = usePlayerStore((s) => s.currentSong);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const setCurrentPlaylist = usePlayerStore((s) => s.setCurrentPlaylist);
  const favoriteIds = useFavoriteStore((s) => s.favoriteIds);
  const toggleFavorite = useFavoriteStore((s) => s.toggleFavorite);
  const { download, downloadBatch } = useDownload();

  const [playlist, setPlaylist] = useState<DiscoverPlaylist | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [songsLoading, setSongsLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [saving, setSaving] = useState(false);
  const [songsError, setSongsError] = useState<string | null>(null);
  const [addToPlaylistOpen, setAddToPlaylistOpen] = useState(false);
  const loadingMoreRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const selection = useDetailSelection(songs, id);
  const { visibleSongs, batchMode, selectedIds, setSelectedIds, selectedSongs, visibleSelectedCount } = selection;

  useEffect(() => {
    if (!id) return;
    const loadPlaylist = async () => {
      try {
        setLoading(true);
        const data = await callMusicApi('getPlaylistDetail', 'netease', parseInt(id));
        if (data) {
          setPlaylist(data);
        }
      } catch (error) {
        console.error('加载歌单详情失败:', error);
      } finally {
        setLoading(false);
      }
    };
    loadPlaylist();
  }, [id]);

  // 分页加载歌曲:首屏第一页,滚动到底加载更多
  const loadSongsPage = useCallback(async (reset: boolean) => {
    if (!id || loadingMoreRef.current) return;
    if (!reset && !hasMore) return;
    loadingMoreRef.current = true;
    try {
      if (reset) {
        setSongsLoading(true);
        setSongsError(null);
      } else {
        setLoadingMore(true);
      }
      const offset = reset ? 0 : songs.length;
      const page = await callMusicApi('getPlaylistSongs', 'netease', parseInt(id), offset, PAGE_SIZE);

      if (!page || page.songs.length === 0) {
        if (reset) {
          setSongsError('加载歌曲失败，请稍后重试');
        }
        return;
      }

      setSongs(prev => reset ? page.songs : [...prev, ...page.songs]);
      setTotal(page.total);
      setHasMore(offset + page.songs.length < page.total);
    } catch (error) {
      console.error('加载歌单歌曲失败:', error);
      if (reset) setSongsError('加载歌曲失败，请稍后重试');
    } finally {
      setSongsLoading(false);
      setLoadingMore(false);
      loadingMoreRef.current = false;
    }
  }, [id, songs.length, hasMore]);

  useEffect(() => {
    if (id) loadSongsPage(true);
  }, [id]);

  useInfiniteScroll(scrollRef, {
    onLoadMore: () => loadSongsPage(false),
    loading: songsLoading || loadingMore,
    hasMore,
  });

  const handlePlay = useCallback(async (song: Song, queue: Song[], index: number) => {
    // #697：列表只回传展示队列与索引，建队列归页面
    setCurrentPlaylist(queue, index);
    await play(song);
  }, [play, setCurrentPlaylist]);

  const handlePlayAll = useCallback(async () => {
    if (songs.length === 0) return;
    setCurrentPlaylist(songs, 0);
    await play(songs[0]);
  }, [songs, play, setCurrentPlaylist]);

  const handleDownloadAll = useCallback(() => {
    if (songs.length === 0) return;
    void downloadBatch(songs);
  }, [songs, downloadBatch]);

  const handleBatchDownload = useCallback(() => {
    if (selectedSongs.length === 0) return;
    void downloadBatch(selectedSongs);
    toast.success(`已添加 ${selectedSongs.length} 首歌曲到下载队列`);
  }, [selectedSongs, downloadBatch]);

  const handleBatchAddToPlaylist = useCallback(() => {
    if (selectedSongs.length > 0) setAddToPlaylistOpen(true);
  }, [selectedSongs]);

  const handleSaveToLocal = useCallback(() => {
    if (!playlist) return;
    confirm({
      title: '保存全部到新歌单',
      message: `确定要将歌单"${playlist.name}"（${total > songs.length ? `${songs.length}/${total}` : songs.length}首歌曲）保存到本地吗？`,
      okText: '保存',
      cancelText: '取消',
      onOk: async () => {
        try {
          setSaving(true);
          // 分页模式下已加载的歌曲可能不全,保存前拉取全量
          let songsToSave = songs;
          if (songsToSave.length < total) {
            // limit <= 0 = 全量（getPlaylistSongs 合一语义，#278）
            const full = await callMusicApi('getPlaylistSongs', 'netease', parseInt(id!), 0, 0);
            if (full.songs && full.songs.length > 0) {
              songsToSave = full.songs;
            }
          }
          // #552：新建 + 整批写入 + 失败回滚交给 adapter 背后的 core 编排。
          // 成败如实回报：失败会把刚建的空歌单删掉，不再谎报成功。
          const result = await desktopWriter.createAndAdd({
            name: playlist.name,
            songs: songsToSave,
            description: playlist.description || `来自网易云歌单: ${playlist.name}`,
          });
          if (!result.ok) throw new Error(result.error || '保存失败');
          toast.success(`成功保存 ${result.added} 首歌曲到本地歌单`);
          navigate('/playlists');
        } catch (error) {
          console.error('保存到本地失败:', error);
          toast.error('保存失败，请稍后重试');
        } finally {
          setSaving(false);
        }
      },
    });
  }, [playlist, total, songs, id, confirm, navigate]);

  const batchActions = React.useMemo(() => [
    { key: 'download', label: '批量下载', icon: <Download size={12} />, onClick: handleBatchDownload },
    { key: 'playlist', label: '加入歌单', icon: <CirclePlus size={12} />, onClick: handleBatchAddToPlaylist },
  ], [handleBatchDownload, handleBatchAddToPlaylist]);

  if (loading) {
    return (
      <div className="discover-page">
        <div className="discover-state-center">加载中...</div>
      </div>
    );
  }

  if (!playlist) {
    return (
      <div className="discover-page">
        <div className="discover-state-center">歌单不存在或加载失败</div>
      </div>
    );
  }

  return (
    <div className="detail-page">
      <div ref={scrollRef} className="detail-page__scroll" data-scroll-container>
        <PageHero
          className="detail-page__hero"
          media={
            <div className="detail-page__cover">
              {/* 占位层（无封面/加载失败时显示），img 成功后覆盖其上 */}
              <div className="detail-page__cover-placeholder">
                <Music2 size={56} />
              </div>
              {playlist.coverImgUrl && (
                <img
                  key={playlist.coverImgUrl}
                  src={coverThumbUrl(playlist.coverImgUrl, COVER_SIZE.thumb)}
                  alt={playlist.name}
                  loading="lazy"
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  className="detail-page__cover-img"
                />
              )}
            </div>
          }
          eyebrow="歌单"
          title={playlist.name}
          meta={
            <>
              <span>创建者 {playlist.creator.nickname}</span>
              <span> · {formatPlayCount(playlist.playCount)} 次播放</span>
              <span> · {total || playlist.trackCount} 首</span>
              {playlist.description && (
                <p className="detail-page__hero-desc">{playlist.description}</p>
              )}
            </>
          }
          actions={
            <>
              <Button
                variant="primary"
                size="sm"
                icon={<Play size={15} aria-hidden="true" />}
                onClick={() => { void handlePlayAll(); }}
                disabled={songs.length === 0 || songsLoading}
              >
                播放全部
              </Button>
              <Button
                size="sm"
                icon={<Download size={15} aria-hidden="true" />}
                onClick={handleDownloadAll}
                disabled={songs.length === 0 || songsLoading}
              >
                下载全部
              </Button>
              <Button
                size="sm"
                onClick={handleSaveToLocal}
                disabled={songs.length === 0 || saving}
              >
                {saving ? '保存中...' : '保存全部到新歌单'}
              </Button>
            </>
          }
        />

        <div className="detail-page__list">
          {songsError && songs.length === 0 ? (
            <div className="detail-page__error">{songsError}</div>
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
                onToggleFavorite={toggleFavorite}
                onDownload={download}
                onSwap={(original, swapped) => setSongs(prev => prev.map(s => s.id === original.id ? swapped : s))}
                density="library"
                showDuration
                showCheckbox={batchMode}
                selectedIds={selectedIds}
                onSelectionChange={setSelectedIds}
                loading={songsLoading && songs.length === 0}
                emptyText={selection.isFiltering ? `没有匹配「${selection.filterQuery.trim()}」的歌曲` : '暂无歌曲数据'}
              />
              {loadingMore && <div className="detail-page__note">加载中...</div>}
              {!hasMore && songs.length > 0 && (
                <div className="detail-page__note">
                  已加载全部 {songs.length}{total > songs.length ? ` / ${total}` : ''} 首歌曲
                </div>
              )}
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

export default DiscoverPlaylistDetailPage;
