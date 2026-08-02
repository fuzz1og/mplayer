import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, Play } from 'lucide-react';
import { Modal, message } from 'antd';
import SongList from '@/renderer/components/SongList';
import CoverImage from '@/renderer/components/CoverImage';
import { usePlayerStore } from '@/renderer/store/playerStore';
import { IpcClient } from '@/renderer/services/IpcClient';
import type { Song, DiscoverPlaylist } from '@mplayer/core';
import { formatPlayCount } from '@mplayer/core';
const { ipcRenderer } = window.require('electron');

const PAGE_SIZE = 20;

const DiscoverPlaylistDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { play, currentSong, isPlaying, setCurrentPlaylist } = usePlayerStore();

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
        const result = await ipcRenderer.invoke('musicApi:getNeteasePlaylistDetail', parseInt(id));
        if (result.success && result.data) {
          setPlaylist(result.data);
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
      let result = await ipcRenderer.invoke('musicApi:getNeteasePlaylistSongsPage', parseInt(id), offset, PAGE_SIZE);

      // 分页失败时仅第一页回退第三方解析
      if (!result.success || !result.data || result.data.songs.length === 0) {
        if (reset) {
          const playlistUrl = `https://music.163.com/#/playlist?id=${id}`;
          result = await ipcRenderer.invoke('musicApi:getPlaylistSongsFromThirdParty', playlistUrl);
          if (result.success && result.data) {
            setSongs(result.data);
            setTotal(result.data.length);
            setHasMore(false);
          } else {
            setSongsError('加载歌曲失败，请稍后重试');
          }
        }
        return;
      }

      setSongs(prev => reset ? result.data.songs : [...prev, ...result.data.songs]);
      setTotal(result.data.total);
      setHasMore(offset + result.data.songs.length < result.data.total);
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

  // 滚动到底加载更多
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const handleScroll = () => {
      if (songsLoading || loadingMore || !hasMore) return;
      const { scrollTop, scrollHeight, clientHeight } = container;
      if (scrollTop + clientHeight >= scrollHeight - 200) {
        loadSongsPage(false);
      }
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [songsLoading, loadingMore, hasMore, loadSongsPage]);

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
      content: `确定要将歌单"${playlist.name}"保存到本地吗？`,
      okText: '保存',
      cancelText: '取消',
      onOk: async () => {
        try {
          setSaving(true);
          // 分页模式下已加载的歌曲可能不全,保存前拉取全量
          let songsToSave = songs;
          if (songsToSave.length < total) {
            const result = await ipcRenderer.invoke('musicApi:getNeteasePlaylistSongs', parseInt(id!));
            if (result.success && result.data && result.data.length > 0) {
              songsToSave = result.data;
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '12px 24px', borderBottom: '1px solid var(--divider-color)', backgroundColor: 'var(--content-bg)', height: '60px' }}>
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '12px 24px', borderBottom: '1px solid var(--divider-color)', backgroundColor: 'var(--content-bg)', height: '60px' }}>
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
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '12px 24px', borderBottom: '1px solid var(--divider-color)', backgroundColor: 'var(--content-bg)', boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)', height: '60px' }}>
        <button onClick={() => navigate(-1)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '10px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-secondary)', transition: 'all 0.2s ease', fontSize: '14px', fontWeight: 500 }} onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--hover-bg)'; e.currentTarget.style.color = 'var(--text-primary)'; }} onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)'; }}>
          <ArrowLeft size={16} /><span>返回</span>
        </button>
        <h1 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text-primary)', flex: 1, margin: 0, textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{playlist.name}</h1>
        <div style={{ width: '140px' }} />
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', padding: '24px' }}>
        <div style={{ display: 'flex', gap: '24px', marginBottom: '32px' }}>
          <div style={{ width: '200px', height: '200px', borderRadius: '12px', overflow: 'hidden', flexShrink: 0, boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)' }}>
            <CoverImage src={playlist.coverImgUrl} alt={playlist.name} variant="playlist" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
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
                  <span key={tag} style={{ padding: '2px 10px', borderRadius: '12px', fontSize: '12px', backgroundColor: 'var(--hover-bg)', color: 'var(--text-secondary)' }}>{tag}</span>
                ))}
              </div>
            )}
            {playlist.description && (
              <p style={{ fontSize: '13px', color: 'var(--text-tertiary)', marginBottom: '16px', marginTop: 0, lineHeight: 1.6, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{playlist.description}</p>
            )}
            <div style={{ display: 'flex', gap: '12px' }}>
              <button onClick={handlePlayAll} disabled={songs.length === 0 || songsLoading} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 24px', borderRadius: '24px', border: 'none', backgroundColor: 'var(--accent-color)', color: 'white', fontSize: '14px', fontWeight: 500, cursor: songs.length === 0 || songsLoading ? 'not-allowed' : 'pointer', opacity: songs.length === 0 || songsLoading ? 0.6 : 1, transition: 'all 0.2s ease' }}>
                <Play size={16} />播放全部
              </button>
              <button onClick={handleSaveToLocal} disabled={songs.length === 0 || saving} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 24px', borderRadius: '24px', border: '1px solid var(--border-color)', backgroundColor: 'transparent', color: 'var(--text-primary)', fontSize: '14px', fontWeight: 500, cursor: songs.length === 0 || saving ? 'not-allowed' : 'pointer', opacity: songs.length === 0 || saving ? 0.6 : 1, transition: 'all 0.2s ease' }}>
                <Download size={16} />{saving ? '保存中...' : '保存到本地'}
              </button>
            </div>
          </div>
        </div>

        {songsLoading ? (
          <div style={{ color: 'var(--text-tertiary)', textAlign: 'center', padding: '40px' }}>正在加载歌曲列表...</div>
        ) : songsError ? (
          <div style={{ padding: '12px 16px', backgroundColor: 'var(--danger-bg)', borderRadius: '8px', color: 'var(--danger-color)', textAlign: 'center' }}>
            {songsError}
          </div>
        ) : (
          <>
            <SongList songs={songs} currentSongId={currentSong?.id} isPlaying={isPlaying} onPlay={handlePlay} showHeader={true} showIndex={true} showCheckbox={true} enableBatchDownload={true} enableBatchAddToPlaylist={true} emptyText="暂无歌曲数据" />
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
