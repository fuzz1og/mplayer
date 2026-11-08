import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Download, ListPlus, Play, Radio as RadioIcon } from 'lucide-react';
import {
  describeDjRadioFailure,
  fetchAllDjRadioPrograms,
  formatPlayCount,
  type DjRadio,
  type DjRadioProgram,
  type DjRadioDetailOutcome,
  type DjRadioProgramsOutcome,
  type Song,
} from '@mplayer/core';
import '@/renderer/styles/detail-page.css';
import '@/renderer/styles/songlist.css';
import { Button, InfoHint, PageHero } from '@/renderer/ui';
import SongList from '@/renderer/components/SongList';
import { useInfiniteScroll } from '@/renderer/hooks/useInfiniteScroll';
import { useDownload } from '@/renderer/hooks/useDownload';
import { usePlayerStore } from '@/renderer/store/playerStore';
import { useFavoriteStore } from '@/renderer/store/favoriteStore';
import { callMusicApi } from '@/renderer/services/callMusicApi';
import { createDesktopPlaylistWriter } from '@/renderer/services/playlistWriteAdapter';
import { toast } from '@/renderer/services/toastStore';

const PAGE_SIZE = 30;
const desktopWriter = createDesktopPlaylistWriter();

const formatDate = (epochMs: number): string => {
  if (!epochMs) return '';
  return new Date(epochMs).toLocaleDateString('zh-CN');
};

const DjRadioDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const radioId = id || '';
  const play = usePlayerStore((s) => s.play);
  const currentSong = usePlayerStore((s) => s.currentSong);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const setCurrentPlaylist = usePlayerStore((s) => s.setCurrentPlaylist);
  const favoriteIds = useFavoriteStore((s) => s.favoriteIds);
  const toggleFavorite = useFavoriteStore((s) => s.toggleFavorite);
  const { download, downloadBatch } = useDownload();

  const [radio, setRadio] = useState<DjRadio | null>(null);
  const [programs, setPrograms] = useState<DjRadioProgram[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [programsLoading, setProgramsLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [programsError, setProgramsError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [playingAll, setPlayingAll] = useState(false);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [detailError, setDetailError] = useState<DjRadioDetailOutcome | null>(null);
  const [programsFailure, setProgramsFailure] = useState<DjRadioProgramsOutcome | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const loadingMoreRef = useRef(false);
  const allFetchRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const fetchProgramPage = useCallback(async (targetId: string, offset: number, limit: number) => {
    const outcome = await callMusicApi('getDjRadioProgramsRouted', 'netease', targetId, offset, limit);
    if (!outcome.ok) throw new Error(outcome.message);
    return outcome.page;
  }, []);

  const fetchAllPrograms = useCallback(
    () => fetchAllDjRadioPrograms(radioId, fetchProgramPage),
    [fetchProgramPage, radioId],
  );

  const guardAllFetch = useCallback(() => {
    if (allFetchRef.current) return false;
    allFetchRef.current = true;
    return true;
  }, []);

  const releaseAllFetch = useCallback(() => { allFetchRef.current = false; }, []);

  useEffect(() => {
    if (!radioId) {
      setLoading(false);
      setProgramsLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setRadio(null);
    setDetailError(null);
    setProgramsFailure(null);
    setPrograms([]);
    setTotal(0);
    setHasMore(false);
    setProgramsError(null);
    setProgramsLoading(false);
    callMusicApi('getDjRadioDetailRouted', 'netease', radioId)
      .then((outcome) => {
        if (cancelled) return;
        if (!outcome.ok) {
          setDetailError(outcome);
          setError(describeDjRadioFailure(outcome.reason, outcome.message));
          setProgramsLoading(false);
          return;
        }
        setRadio(outcome.radio);
        setLoading(false);
        setProgramsLoading(true);
        return callMusicApi('getDjRadioProgramsRouted', 'netease', radioId, 0, PAGE_SIZE)
          .then((outcome) => {
            if (cancelled) return;
            if (!outcome.ok) {
              setProgramsFailure(outcome);
              setProgramsError(describeDjRadioFailure(outcome.reason, outcome.message));
              return;
            }
            const page = outcome.page;
            setPrograms(page.programs);
            setTotal(page.total);
            setHasMore(page.more);
          })
          .catch((e: unknown) => {
            if (cancelled) return;
            console.error('加载电台节目失败:', e);
            setProgramsFailure({ ok: false, reason: 'failed', message: e instanceof Error ? e.message : '' });
            setProgramsError('加载失败');
          })
          .finally(() => {
            if (!cancelled) setProgramsLoading(false);
          });
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : '电台加载失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [radioId, reloadKey]);

  const loadMorePrograms = useCallback(async () => {
    if (!radioId || loadingMoreRef.current || !hasMore) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const outcome = await callMusicApi('getDjRadioProgramsRouted', 'netease', radioId, programs.length, PAGE_SIZE);
      if (!outcome.ok) {
        setProgramsFailure(outcome);
        setProgramsError(describeDjRadioFailure(outcome.reason, outcome.message));
        return;
      }
      const page = outcome.page;
      setPrograms((prev) => [...prev, ...page.programs]);
      setTotal(page.total);
      setHasMore(page.more);
    } catch (e: unknown) {
      console.error('加载更多电台节目失败:', e);
      setProgramsError('加载失败');
    } finally {
      setLoadingMore(false);
      loadingMoreRef.current = false;
    }
  }, [hasMore, programs.length, radioId]);

  useInfiniteScroll(scrollRef, {
    onLoadMore: () => void loadMorePrograms(),
    loading: programsLoading || loadingMore,
    hasMore,
  });

  const handlePlay = useCallback((program: Song, queue: Song[], index: number) => {
    setCurrentPlaylist(queue, index);
    void play(program);
  }, [play, setCurrentPlaylist]);

  const handleToggleFavorite = useCallback((program: Song) => {
    void toggleFavorite(program);
  }, [toggleFavorite]);

  const handlePlayAll = useCallback(async () => {
    if (playingAll || !guardAllFetch()) return;
    setPlayingAll(true);
    try {
      const all = await fetchAllPrograms();
      if (all.length === 0) {
        toast.error('这个电台还没有节目');
        return;
      }
      setCurrentPlaylist(all, 0);
      void play(all[0]);
    } catch (e: unknown) {
      console.error('播放电台全部节目失败:', e);
      toast.error('播放全部失败，请稍后重试');
    } finally {
      setPlayingAll(false);
      releaseAllFetch();
    }
  }, [fetchAllPrograms, guardAllFetch, play, playingAll, releaseAllFetch, setCurrentPlaylist]);

  const handleDownloadAll = useCallback(async () => {
    if (downloadingAll || !guardAllFetch()) return;
    setDownloadingAll(true);
    try {
      const all = await fetchAllPrograms();
      if (all.length === 0) {
        toast.error('这个电台还没有节目');
        return;
      }
      await downloadBatch(all);
    } catch (e: unknown) {
      console.error('下载电台全部节目失败:', e);
      toast.error('下载全部失败，请稍后重试');
    } finally {
      setDownloadingAll(false);
      releaseAllFetch();
    }
  }, [downloadBatch, downloadingAll, fetchAllPrograms, guardAllFetch, releaseAllFetch]);

  const handleSaveAll = useCallback(async () => {
    if (!radio || saving || !guardAllFetch()) return;
    setSaving(true);
    try {
      const all = await fetchAllPrograms();
      if (all.length === 0) {
        toast.error('这个电台还没有节目');
        return;
      }
      const result = await desktopWriter.createAndAdd({
        name: radio.name,
        songs: all,
        description: radio.desc || `来自网易云电台: ${radio.name}`,
      });
      if (!result.ok) throw new Error(result.error || '保存失败');
      toast.success(`已保存 ${result.added} 期节目到本地歌单`);
      navigate('/playlists');
    } catch (e: unknown) {
      console.error('保存电台失败:', e);
      toast.error('保存失败，请稍后重试');
    } finally {
      setSaving(false);
      releaseAllFetch();
    }
  }, [fetchAllPrograms, guardAllFetch, navigate, radio, releaseAllFetch, saving]);

  const meta = radio
    ? [
        radio.dj.nickname,
        radio.category,
        total > 0 ? `${total} 期` : '',
        radio.subCount > 0 ? `${formatPlayCount(radio.subCount)} 订阅` : '',
        radio.lastProgramCreateTime ? `更新于 ${formatDate(radio.lastProgramCreateTime)}` : '',
      ].filter(Boolean).join(' · ')
    : '';

  if (loading) {
    return <div className="detail-page"><div className="detail-page__note">加载中...</div></div>;
  }

  if (!radio) {
    return (
      <div className="detail-page">
        <div className="detail-page__error">
          <div>{error || '电台加载失败'}</div>
          {detailError?.ok === false && detailError.reason !== 'not-found' && (
            <button className="detail-page__error-retry" onClick={() => setReloadKey((key) => key + 1)}>重试</button>
          )}
        </div>
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
              <div className="detail-page__cover-placeholder"><RadioIcon size={56} /></div>
              {radio.picUrl && (
                <img
                  key={radio.picUrl}
                  src={radio.picUrl}
                  alt={radio.name}
                  loading="lazy"
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  className="detail-page__cover-img"
                />
              )}
            </div>
          }
          title={radio.name}
          meta={
            <>
              {meta}
              {radio.desc && <InfoHint label="电台简介">{radio.desc}</InfoHint>}
            </>
          }
          actions={
            <>
              <Button
                variant="primary"
                size="sm"
                icon={<Play size={15} aria-hidden="true" />}
                onClick={handlePlayAll}
                disabled={programs.length === 0 || programsLoading || playingAll || downloadingAll || saving}
              >
                {playingAll ? '准备中...' : '播放全部'}
              </Button>
              <Button
                size="sm"
                icon={<Download size={15} aria-hidden="true" />}
                onClick={() => { void handleDownloadAll(); }}
                disabled={programs.length === 0 || programsLoading || playingAll || downloadingAll || saving}
              >
                {downloadingAll ? '准备中...' : '下载全部'}
              </Button>
              <Button
                size="sm"
                icon={<ListPlus size={15} aria-hidden="true" />}
                onClick={() => { void handleSaveAll(); }}
                disabled={saving || total === 0 || playingAll || downloadingAll}
              >
                {saving ? '保存中...' : '保存全部到新歌单'}
              </Button>
            </>
          }
        />

        <div className="detail-page__list">
          {programsError && programs.length === 0 ? (
            <div className="detail-page__error">
              <div>{programsError}</div>
              {programsFailure?.ok === false && programsFailure.reason !== 'unsupported' && (
                <button className="detail-page__error-retry" onClick={() => setReloadKey((key) => key + 1)}>重试</button>
              )}
            </div>
          ) : (
            <>
              {programsError && programs.length > 0 && (
                <div className="detail-page__error detail-page__list-error">
                  <div>{programsError}</div>
                  <button className="detail-page__error-retry" onClick={() => void loadMorePrograms()}>重试</button>
                </div>
              )}
              <SongList
                songs={programs}
                currentSongId={currentSong?.id}
                isPlaying={isPlaying}
                favoriteIds={favoriteIds}
                onPlay={handlePlay}
                onToggleFavorite={handleToggleFavorite}
                onDownload={download}
                density="library"
                showDuration
                showAlbum={false}
                indexLabel={(song) => (song as DjRadioProgram).serialNum || undefined}
                rowKey={(song, index) => (song as DjRadioProgram).programId || `program-${index}`}
                hideSwap
                rowTitle={(song) => (song as DjRadioProgram).description || undefined}
                loading={programsLoading && programs.length === 0}
                emptyText="这个电台还没有节目"
              />
              {loadingMore && <div className="detail-page__note">加载中...</div>}
              {!hasMore && programs.length > 0 && (
                <div className="detail-page__note">共 {total || programs.length} 期，已加载全部</div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default DjRadioDetailPage;
