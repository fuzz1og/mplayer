import React, { useCallback, useEffect, useRef, useState } from 'react';
import '../styles/page-discover.css';
import { COVER_SIZE, coverThumbUrl } from '@mplayer/core';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, Play, Music2 } from 'lucide-react';
import { toast } from '@/renderer/services/toastStore';
import { useConfirm } from '@/renderer/ui';
import SongList from '@/renderer/components/SongList';
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
  const { download } = useDownload();

  const [playlist, setPlaylist] = useState<DiscoverPlaylist | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [songsLoading, setSongsLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [saving, setSaving] = useState(false);
  const [songsError, setSongsError] = useState<string | null>(null);
  const loadingMoreRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);

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

  const handlePlay = async (song: Song) => {
    await play(song);
  };

  const handlePlayAll = async () => {
    if (songs.length > 0) {
      setCurrentPlaylist(songs, 0);
      await play(songs[0]);
    }
  };

  const handleSaveToLocal = () => {
    if (!playlist) return;
    confirm({
      title: '保存到本地',
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
          // 本页此前逐首 addSong、**无回滚**、失败只 console.error 却照样 message.success——
          // 现在失败会把刚建的空歌单删掉并如实报错，不再谎报成功。
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
  };

  if (loading) {
    return (
      <div className="discover-page">
        <div className="discover-topbar">
          <button onClick={() => navigate(-1)} className="discover-back">
            <ArrowLeft size={16} /><span>返回</span>
          </button>
          <h1 className="discover-topbar__title">加载中...</h1>
          <div className="discover-topbar__spacer" />
        </div>
        <div className="discover-state-center">加载中...</div>
      </div>
    );
  }

  if (!playlist) {
    return (
      <div className="discover-page">
        <div className="discover-topbar">
          <button onClick={() => navigate(-1)} className="discover-back">
            <ArrowLeft size={16} /><span>返回</span>
          </button>
          <h1 className="discover-topbar__title">歌单不存在</h1>
          <div className="discover-topbar__spacer" />
        </div>
        <div className="discover-state-center">歌单不存在或加载失败</div>
      </div>
    );
  }

  return (
    <div className="discover-page">
      <div className="discover-topbar discover-topbar--shadow">
        <button onClick={() => navigate(-1)} className="discover-back discover-back--action">
          <ArrowLeft size={16} /><span>返回</span>
        </button>
        <h1 className="discover-topbar__title">{playlist.name}</h1>
        <div className="discover-topbar__spacer" />
      </div>

      <div ref={scrollRef} className="discover-detail-scroll">
        <div className="discover-detail__head">
          <div className="discover-detail__cover">
            {/* 占位层（无封面/加载失败时显示），img 成功后覆盖其上 */}
            <div className="discover-detail__cover-fallback">
              <Music2 size={40} className="discover-detail__cover-icon" />
            </div>
            {playlist.coverImgUrl && (
              <img
                key={playlist.coverImgUrl}
                src={coverThumbUrl(playlist.coverImgUrl, COVER_SIZE.thumb)}
                alt={playlist.name}
                loading="lazy"
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
                className="discover-detail__cover-img"
              />
            )}
          </div>
          <div className="discover-detail__info">
            <h2 className="discover-detail__title">{playlist.name}</h2>
            <div className="discover-detail__meta">
              <span>创建者: {playlist.creator.nickname}</span>
              <span>播放量: {formatPlayCount(playlist.playCount)}</span>
              <span>歌曲数: {playlist.trackCount}</span>
            </div>
            {playlist.tags.length > 0 && (
              <div className="discover-detail__tags">
                {playlist.tags.map(tag => (
                  <span key={tag} className="discover-detail__tag">{tag}</span>
                ))}
              </div>
            )}
            {playlist.description && (
              <p className="discover-detail__desc">{playlist.description}</p>
            )}
            <div className="discover-detail__actions">
              <button onClick={handlePlayAll} disabled={songs.length === 0 || songsLoading} className="discover-action discover-action--primary">
                <Play size={16} />播放全部
              </button>
              <button onClick={handleSaveToLocal} disabled={songs.length === 0 || saving} className="discover-action">
                <Download size={16} />{saving ? '保存中...' : '保存到本地'}
              </button>
            </div>
          </div>
        </div>

        {songsLoading ? (
          <div className="discover-status">正在加载歌曲列表...</div>
        ) : songsError ? (
          <div className="discover-detail__error">
            {songsError}
          </div>
        ) : (
          <>
          <SongList
            songs={songs}
            currentSongId={currentSong?.id}
            isPlaying={isPlaying}
            favoriteIds={favoriteIds}
            onPlay={handlePlay}
            onToggleFavorite={toggleFavorite}
            onDownload={download}
            onSwap={(original, swapped) => setSongs(prev => prev.map(s => s.id === original.id ? swapped : s))}
            showHeader={true}
            showIndex={true}
            showCheckbox={true}
            enableBatchDownload={true}
            enableBatchAddToPlaylist={true}
            emptyText="暂无歌曲数据"
          />
            {loadingMore && (
              <div className="discover-note discover-note--tight">加载中...</div>
            )}
            {!hasMore && songs.length > 0 && (
              <div className="discover-note discover-note--tight">
                已加载全部 {songs.length}{total > songs.length ? ` / ${total}` : ''} 首歌曲
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default DiscoverPlaylistDetailPage;
