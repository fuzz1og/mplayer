import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Download, ListPlus, Play, Radio as RadioIcon } from 'lucide-react';
import { formatPlayCount, type DjRadio, type DjRadioProgram, type Song } from '@mplayer/core';
import '@/renderer/styles/detail-page.css';
import '@/renderer/styles/songlist.css';
import { Button, InfoHint, PageHero } from '@/renderer/ui';
import SongList from '@/renderer/components/SongList';
import { useInfiniteScroll } from '@/renderer/hooks/useInfiniteScroll';
import { useDownload } from '@/renderer/hooks/useDownload';
import { usePlayerStore } from '@/renderer/store/playerStore';
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
  const loadingMoreRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);

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
    setPrograms([]);
    setTotal(0);
    setHasMore(false);
    setProgramsError(null);
    setProgramsLoading(false);
    callMusicApi('getDjRadioDetail', 'netease', radioId)
      .then((data) => {
        if (cancelled) return;
        if (!data) {
          setError('电台不存在或加载失败');
          return;
        }
        setRadio(data);
        setLoading(false);
        setProgramsLoading(true);
        return callMusicApi('getDjRadioPrograms', 'netease', radioId, 0, PAGE_SIZE)
          .then((page) => {
            if (cancelled) return;
            setPrograms(page.programs);
            setTotal(page.total);
            setHasMore(page.more);
          })
          .catch((e: unknown) => {
            if (cancelled) return;
            console.error('加载电台节目失败:', e);
            setProgramsError(e instanceof Error ? e.message : '节目加载失败');
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
  }, [radioId]);

  const loadMorePrograms = useCallback(async () => {
    if (!radioId || loadingMoreRef.current || !hasMore) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const page = await callMusicApi('getDjRadioPrograms', 'netease', radioId, programs.length, PAGE_SIZE);
      setPrograms((prev) => [...prev, ...page.programs]);
      setTotal(page.total);
      setHasMore(page.more);
    } catch (e: unknown) {
      console.error('加载更多电台节目失败:', e);
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

  const handlePlayAll = useCallback(() => {
    if (programs.length === 0) return;
    setCurrentPlaylist(programs, 0);
    void play(programs[0]);
  }, [play, programs, setCurrentPlaylist]);

  const handleDownloadAll = useCallback(() => {
    if (programs.length > 0) void downloadBatch(programs);
  }, [downloadBatch, programs]);

  const handleSaveAll = useCallback(async () => {
    if (!radio || saving) return;
    setSaving(true);
    try {
      const all: DjRadioProgram[] = [];
      let offset = 0;
      let more = true;
      while (more) {
        const page = await callMusicApi('getDjRadioPrograms', 'netease', radioId, offset, 200);
        all.push(...page.programs);
        more = page.more;
        offset += page.programs.length;
        if (page.programs.length === 0) break;
      }
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
    }
  }, [navigate, radio, radioId, saving]);

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
    return <div className="detail-page"><div className="detail-page__error">{error || '电台不存在或加载失败'}</div></div>;
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
                disabled={programs.length === 0 || programsLoading}
              >
                播放全部
              </Button>
              <Button
                size="sm"
                icon={<Download size={15} aria-hidden="true" />}
                onClick={handleDownloadAll}
                disabled={programs.length === 0 || programsLoading}
              >
                下载全部
              </Button>
              <Button
                size="sm"
                icon={<ListPlus size={15} aria-hidden="true" />}
                onClick={() => { void handleSaveAll(); }}
                disabled={saving || total === 0}
              >
                {saving ? '保存中...' : '保存全部到新歌单'}
              </Button>
            </>
          }
        />

        <div className="detail-page__list">
          {programsError && programs.length === 0 ? (
            <div className="detail-page__error">{programsError}</div>
          ) : (
            <>
              <SongList
                songs={programs}
                currentSongId={currentSong?.id}
                isPlaying={isPlaying}
                onPlay={handlePlay}
                onDownload={download}
                density="library"
                showDuration
                showAlbum={false}
                indexLabel={(song) => (song as DjRadioProgram).serialNum || undefined}
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
