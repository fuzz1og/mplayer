import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Play, Disc3 } from 'lucide-react';
import SongList from '@/renderer/components/SongList';
import { usePlayerStore } from '@/renderer/store/playerStore';
import { useFavoriteStore } from '@/renderer/store/favoriteStore';
import { callMusicApi } from '@/renderer/services/callMusicApi';
import type { Album, Song } from '@mplayer/core';
const ipcRenderer = window.electronAPI;

function formatDuration(sec?: number): string {
  if (!sec || sec <= 0) return '--:--';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

const AlbumDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
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
        const detail = await callMusicApi('getAlbumDetail', albumId);
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

  const handlePlay = useCallback((song: Song) => {
    const index = songs.findIndex(s => s.id === song.id && s.sourceType === song.sourceType);
    setCurrentPlaylist(songs, index >= 0 ? index : 0);
    play(song);
  }, [songs, setCurrentPlaylist, play]);

  const handlePlayAll = useCallback(() => {
    if (songs.length === 0) return;
    setCurrentPlaylist(songs, 0);
    play(songs[0]);
  }, [songs, setCurrentPlaylist, play]);

  const handleDownload = async (song: Song) => {
    try {
      await ipcRenderer.invoke('download:start', song);
    } catch (e) {
      console.error('下载失败:', e);
    }
  };

  const year = (() => {
    const t = Number(album?.publishTime || 0);
    return t > 0 ? String(new Date(t).getFullYear()) : '';
  })();
  const totalDuration = songs.reduce((sum, s) => sum + (s.duration || 0), 0);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '12px 24px', borderBottom: '1px solid var(--border-subtle)', backgroundColor: 'var(--bg-surface)', boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)', height: '60px' }}>
        <button onClick={() => navigate(-1)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '10px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-secondary)', transition: 'all 0.2s ease', fontSize: '14px', fontWeight: 500 }} onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; }} onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)'; }}>
          <ArrowLeft size={16} /><span>返回</span>
        </button>
        <h1 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text-primary)', flex: 1, margin: 0, textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayName || '专辑'}</h1>
        <div style={{ width: '140px' }} />
      </div>
      {/* 专辑卡片区:固定不滚动,布局与歌单详情页一致 */}
      <div style={{ padding: '24px 24px 0', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: '24px', marginBottom: '32px' }}>
          <div style={{ position: 'relative', width: '200px', height: '200px', borderRadius: '12px', overflow: 'hidden', flexShrink: 0, boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)', backgroundColor: 'var(--bg-hover)' }}>
            {/* 占位层（无封面/加载失败时显示），img 成功后覆盖其上 */}
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Disc3 size={56} style={{ color: 'var(--text-tertiary)' }} />
            </div>
            {displayPic && (
              <img
                key={displayPic}
                src={displayPic}
                alt={displayName}
                loading="lazy"
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
              />
            )}
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <h2 style={{ fontSize: '24px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '12px', marginTop: 0 }}>{displayName || '专辑'}</h2>
            <div style={{ display: 'flex', gap: '16px', marginBottom: '12px', fontSize: '13px', color: 'var(--text-tertiary)' }}>
              {displayArtist && <span>{displayArtist}</span>}
              {year && <span>{year}</span>}
              {songs.length > 0 && (
                <>
                  <span>{songs.length} 首</span>
                  <span>总时长 {formatDuration(totalDuration)}</span>
                </>
              )}
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                onClick={handlePlayAll}
                disabled={songs.length === 0 || loading}
                style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '10px 24px', borderRadius: '24px', border: 'none',
                  backgroundColor: 'var(--accent)', color: 'white',
                  fontSize: '14px', fontWeight: 500,
                  cursor: songs.length === 0 || loading ? 'not-allowed' : 'pointer',
                  opacity: songs.length === 0 || loading ? 0.6 : 1,
                  transition: 'all 0.2s ease',
                }}
              >
                <Play size={16} />播放全部
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 歌曲列表独立容器:内部滚动,与歌单详情页一致 */}
      <div style={{ flex: 1, overflow: 'auto', padding: '0 24px 24px' }}>
        {error && songs.length === 0 ? (
          <div style={{ padding: '12px 16px', backgroundColor: 'var(--danger-subtle)', borderRadius: '8px', color: 'var(--danger)', textAlign: 'center' }}>
            {error}
          </div>
        ) : (
          <SongList
            songs={songs}
            currentSongId={currentSong?.id}
            isPlaying={isPlaying}
            favoriteIds={favoriteIds}
            onPlay={handlePlay}
            onSwap={(original, swapped) => setSongs(prev => prev.map(s => s.id === original.id ? swapped : s))}
            onToggleFavorite={toggleFavorite}
            onDownload={handleDownload}
            showHeader={true}
            showIndex={true}
            showCheckbox={true}
            enableBatchDownload={true}
            enableBatchAddToPlaylist={true}
            loading={loading && songs.length === 0}
            emptyText="暂无歌曲数据"
          />
        )}
      </div>
    </div>
  );
};

export default AlbumDetailPage;
