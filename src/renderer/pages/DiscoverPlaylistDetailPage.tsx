import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, Play, Music2 } from 'lucide-react';
import { Modal, message } from 'antd';
import SongList from '@/renderer/components/SongList';
import { usePlayerStore } from '@/renderer/store/playerStore';
import { useFavoriteStore } from '@/renderer/store/favoriteStore';
import { useDownload } from '@/renderer/hooks/useDownload';
import { IpcClient } from '@/renderer/services/IpcClient';
import { useInfiniteScroll } from '@/renderer/hooks/useInfiniteScroll';
import { callMusicApi } from '@/renderer/services/callMusicApi';
import type { Song, DiscoverPlaylist } from '@mplayer/core';
import { formatPlayCount } from '@mplayer/core';

const PAGE_SIZE = 20;

const DiscoverPlaylistDetailPage: React.FC = () => {
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
        const data = await callMusicApi('getNeteasePlaylistDetail', parseInt(id));
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
      const page = await callMusicApi('getNeteasePlaylistSongsPage', parseInt(id), offset, PAGE_SIZE);

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
    Modal.confirm({
      title: '保存到本地',
      content: `确定要将歌单"${playlist.name}"（${total > songs.length ? `${songs.length}/${total}` : songs.length}首歌曲）保存到本地吗？`,
      okText: '保存',
      cancelText: '取消',
      onOk: async () => {
        try {
          setSaving(true);
          // 分页模式下已加载的歌曲可能不全,保存前拉取全量
          let songsToSave = songs;
          if (songsToSave.length < total) {
            const full = await callMusicApi('getNeteasePlaylistSongs', parseInt(id!));
            if (full && full.length > 0) {
              songsToSave = full;
            }
          }
          const playlistId = await IpcClient.invoke<number>(
            'playlist:create',
            playlist.name,
            playlist.description || `来自网易云歌单: ${playlist.name}`
          );
          let addedCount = 0;
          for (const song of songsToSave) {
            try {
              await IpcClient.invoke<number>('playlist:addSong', playlistId, song);
              addedCount++;
            } catch (e) {
              console.error('添加歌曲失败:', song.name, e);
            }
          }
          message.success(`成功保存 ${addedCount} 首歌曲到本地歌单`);
          navigate('/playlists');
        } catch (error) {
          console.error('保存到本地失败:', error);
          message.error('保存失败，请稍后重试');
        } finally {
          setSaving(false);
        }
      },
    });
  };

  if (loading) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '12px 24px', borderBottom: '1px solid var(--border-subtle)', backgroundColor: 'var(--bg-surface)', height: '60px' }}>
          <button onClick={() => navigate(-1)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '10px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-secondary)', fontSize: '14px' }}>
            <ArrowLeft size={16} /><span>返回</span>
          </button>
          <h1 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text-primary)', flex: 1, margin: 0, textAlign: 'center' }}>加载中...</h1>
          <div style={{ width: '140px' }} />
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)' }}>加载中...</div>
      </div>
    );
  }

  if (!playlist) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '12px 24px', borderBottom: '1px solid var(--border-subtle)', backgroundColor: 'var(--bg-surface)', height: '60px' }}>
          <button onClick={() => navigate(-1)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '10px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-secondary)', fontSize: '14px' }}>
            <ArrowLeft size={16} /><span>返回</span>
          </button>
          <h1 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text-primary)', flex: 1, margin: 0, textAlign: 'center' }}>歌单不存在</h1>
          <div style={{ width: '140px' }} />
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)' }}>歌单不存在或加载失败</div>
      </div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '12px 24px', borderBottom: '1px solid var(--border-subtle)', backgroundColor: 'var(--bg-surface)', boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)', height: '60px' }}>
        <button onClick={() => navigate(-1)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '10px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-secondary)', transition: 'all 0.2s ease', fontSize: '14px', fontWeight: 500 }} onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; }} onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)'; }}>
          <ArrowLeft size={16} /><span>返回</span>
        </button>
        <h1 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text-primary)', flex: 1, margin: 0, textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{playlist.name}</h1>
        <div style={{ width: '140px' }} />
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', padding: '24px' }}>
        <div style={{ display: 'flex', gap: '24px', marginBottom: '32px' }}>
          <div style={{ position: 'relative', width: '200px', height: '200px', borderRadius: '12px', overflow: 'hidden', flexShrink: 0, boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)', backgroundColor: 'var(--bg-hover)' }}>
            {/* 占位层（无封面/加载失败时显示），img 成功后覆盖其上 */}
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Music2 size={40} style={{ color: 'var(--text-tertiary)' }} />
            </div>
            {playlist.coverImgUrl && (
              <img
                key={playlist.coverImgUrl}
                src={playlist.coverImgUrl}
                alt={playlist.name}
                loading="lazy"
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
              />
            )}
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <h2 style={{ fontSize: '24px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '12px', marginTop: 0 }}>{playlist.name}</h2>
            <div style={{ display: 'flex', gap: '16px', marginBottom: '12px', fontSize: '13px', color: 'var(--text-tertiary)' }}>
              <span>创建者: {playlist.creator.nickname}</span>
              <span>播放量: {formatPlayCount(playlist.playCount)}</span>
              <span>歌曲数: {playlist.trackCount}</span>
            </div>
            {playlist.tags.length > 0 && (
              <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
                {playlist.tags.map(tag => (
                  <span key={tag} style={{ padding: '2px 10px', borderRadius: '12px', fontSize: '12px', backgroundColor: 'var(--bg-hover)', color: 'var(--text-secondary)' }}>{tag}</span>
                ))}
              </div>
            )}
            {playlist.description && (
              <p style={{ fontSize: '13px', color: 'var(--text-tertiary)', marginBottom: '16px', marginTop: 0, lineHeight: 1.6, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{playlist.description}</p>
            )}
            <div style={{ display: 'flex', gap: '12px' }}>
              <button onClick={handlePlayAll} disabled={songs.length === 0 || songsLoading} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 24px', borderRadius: '24px', border: 'none', backgroundColor: 'var(--accent)', color: 'white', fontSize: '14px', fontWeight: 500, cursor: songs.length === 0 || songsLoading ? 'not-allowed' : 'pointer', opacity: songs.length === 0 || songsLoading ? 0.6 : 1, transition: 'all 0.2s ease' }}>
                <Play size={16} />播放全部
              </button>
              <button onClick={handleSaveToLocal} disabled={songs.length === 0 || saving} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 24px', borderRadius: '24px', border: '1px solid var(--border-default)', backgroundColor: 'transparent', color: 'var(--text-primary)', fontSize: '14px', fontWeight: 500, cursor: songs.length === 0 || saving ? 'not-allowed' : 'pointer', opacity: songs.length === 0 || saving ? 0.6 : 1, transition: 'all 0.2s ease' }}>
                <Download size={16} />{saving ? '保存中...' : '保存到本地'}
              </button>
            </div>
          </div>
        </div>

        {songsLoading ? (
          <div style={{ color: 'var(--text-tertiary)', textAlign: 'center', padding: '40px' }}>正在加载歌曲列表...</div>
        ) : songsError ? (
          <div style={{ padding: '12px 16px', backgroundColor: 'var(--danger-subtle)', borderRadius: '8px', color: 'var(--danger)', textAlign: 'center' }}>
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
              <div style={{ color: 'var(--text-tertiary)', textAlign: 'center', padding: '16px' }}>加载中...</div>
            )}
            {!hasMore && songs.length > 0 && (
              <div style={{ color: 'var(--text-tertiary)', textAlign: 'center', padding: '16px' }}>
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
