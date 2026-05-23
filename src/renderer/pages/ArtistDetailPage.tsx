import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, Search } from 'lucide-react';
import SongList from '@/renderer/components/SongList';
import { usePlayerStore } from '@/renderer/store/playerStore';
import { useFavoriteStore } from '@/renderer/store/favoriteStore';
import { searchService } from '@/renderer/services/searchService';
import type { Song } from '@/shared/types/song';
const { ipcRenderer } = window.require('electron');

const ArtistDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const artistId = id || '';
  const stateName = (location.state as any)?.name as string | undefined;
  const statePic = (location.state as any)?.pic as string | undefined;

  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [order, setOrder] = useState<'hot' | 'time'>('hot');

  const { play, currentSong, isPlaying } = usePlayerStore();
  const { favoriteIds, toggleFavorite } = useFavoriteStore();

  useEffect(() => {
    const loadSongs = async () => {
      if (!artistId) return;
      setLoading(true);
      try {
        const result = await ipcRenderer.invoke('musicApi:getArtistSongs', artistId, 0, 50, order);
        const data = result.success ? result.data : { songs: [], total: 0 };
        setSongs(data.songs);
        setTotal(data.total);
      } catch (error) {
        console.error('获取歌手歌曲失败:', error);
      } finally {
        setLoading(false);
      }
    };
    loadSongs();
  }, [artistId, order]);

  const handlePlay = async (song: Song) => {
    const keyword = `${song.name} ${song.artist}`;
    const result = await ipcRenderer.invoke('musicApi:searchSongs', keyword, 1, 'netease');
    const searchResults = result.success ? result.data : [];
    if (searchResults.length > 0) {
      await play(searchResults[0]);
    }
  };

  const handleToggleFavorite = async (song: Song) => {
    try {
      await toggleFavorite(song);
    } catch (error) {
      console.error('收藏操作失败:', error);
    }
  };

  const handleDownload = async (song: Song) => {
    try {
      await ipcRenderer.invoke('download:start', song);
    } catch (error) {
      console.error('下载失败:', error);
    }
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          padding: '12px 24px',
          borderBottom: '1px solid var(--divider-color)',
          backgroundColor: 'var(--content-bg)',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
          height: '60px',
        }}
      >
        <button
          onClick={() => navigate(-1)}
          style={{
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            padding: '10px',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            color: 'var(--text-secondary)',
            transition: 'all 0.2s ease',
            fontSize: '14px',
            fontWeight: 500,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--hover-bg)';
            e.currentTarget.style.color = 'var(--text-primary)';
            e.currentTarget.style.transform = 'translateX(-2px)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
            e.currentTarget.style.color = 'var(--text-secondary)';
            e.currentTarget.style.transform = 'translateX(0)';
          }}
        >
          <ArrowLeft size={16} />
          <span>返回</span>
        </button>
        <h1
          style={{
            fontSize: '20px',
            fontWeight: 600,
            color: 'var(--text-primary)',
            flex: 1,
            margin: 0,
            textAlign: 'center',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          歌手歌曲
        </h1>
        <div style={{ width: '140px' }} />
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '24px' }}>
        {loading ? (
          <div>
            {Array.from({ length: 10 }).map((_, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '10px 16px',
                  borderRadius: '6px',
                  marginBottom: '8px',
                }}
              >
                <div style={{ width: '50px', textAlign: 'center' }}>
                  <div style={{
                    width: '20px', height: '14px', borderRadius: '2px',
                    background: 'linear-gradient(135deg, #f0f0f0 0%, #e0e0e0 50%, #f0f0f0 100%)',
                    backgroundSize: '200% 200%',
                    animation: 'shimmer 1.5s ease-in-out infinite',
                    margin: '0 auto',
                  }} />
                </div>
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{
                    width: '40px', height: '40px', borderRadius: '4px',
                    background: 'linear-gradient(135deg, #f0f0f0 0%, #e0e0e0 50%, #f0f0f0 100%)',
                    backgroundSize: '200% 200%',
                    animation: 'shimmer 1.5s ease-in-out infinite',
                  }} />
                  <div style={{ flex: 1 }}>
                    <div style={{
                      width: '70%', height: '14px', borderRadius: '2px',
                      background: 'linear-gradient(135deg, #f0f0f0 0%, #e0e0e0 50%, #f0f0f0 100%)',
                      backgroundSize: '200% 200%',
                      animation: 'shimmer 1.5s ease-in-out infinite',
                      marginBottom: '4px',
                    }} />
                    <div style={{
                      width: '50%', height: '12px', borderRadius: '2px',
                      background: 'linear-gradient(135deg, #f0f0f0 0%, #e0e0e0 50%, #f0f0f0 100%)',
                      backgroundSize: '200% 200%',
                      animation: 'shimmer 1.5s ease-in-out infinite',
                      animationDelay: '0.1s',
                    }} />
                  </div>
                </div>
              </div>
            ))}
            <style>{`
              @keyframes shimmer {
                0% { background-position: 200% 0; }
                100% { background-position: -200% 0; }
              }
            `}</style>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
              <div
                style={{
                  width: '100px', height: '100px', borderRadius: '50%',
                  overflow: 'hidden', flexShrink: 0,
                  backgroundColor: 'var(--hover-bg)',
                  border: '2px solid var(--border-color)',
                }}
              >
                {statePic ? (
                  <img
                    src={statePic}
                    alt={stateName || ''}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : (
                  <div
                    style={{
                      width: '100%', height: '100%',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '32px', color: 'var(--text-tertiary)',
                    }}
                  >
                    {stateName?.charAt(0) || '?'}
                  </div>
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '24px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>
                  {stateName || `歌手 (ID: ${artistId})`}
                </div>
                <div style={{ fontSize: '14px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span>共 {total || '--'} 首歌曲</span>
                  <button
                    onClick={async () => {
                      if (stateName) {
                        await searchService.search(stateName);
                        navigate('/discover');
                      }
                    }}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      cursor: 'pointer',
                      fontSize: '12px',
                      color: 'var(--accent-color)',
                      padding: 0,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '3px',
                    }}
                  >
                    <Search size={12} />
                    换源获取更多歌曲
                  </button>
                </div>
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => setOrder('hot')}
                  style={{
                    padding: '6px 16px',
                    borderRadius: '16px',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '12px',
                    fontWeight: order === 'hot' ? 600 : 400,
                    color: order === 'hot' ? 'white' : 'var(--text-secondary)',
                    backgroundColor: order === 'hot' ? 'var(--accent-color)' : 'var(--hover-bg)',
                    transition: 'all 0.15s ease',
                  }}
                >
                  热门歌曲
                </button>
                <button
                  onClick={() => setOrder('time')}
                  style={{
                    padding: '6px 16px',
                    borderRadius: '16px',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '12px',
                    fontWeight: order === 'time' ? 600 : 400,
                    color: order === 'time' ? 'white' : 'var(--text-secondary)',
                    backgroundColor: order === 'time' ? 'var(--accent-color)' : 'var(--hover-bg)',
                    transition: 'all 0.15s ease',
                  }}
                >
                  最新歌曲
                </button>
              </div>
            </div>

            <SongList
              songs={songs}
              currentSongId={currentSong?.id}
              isPlaying={isPlaying}
              favoriteIds={favoriteIds}
              onPlay={handlePlay}
              onToggleFavorite={handleToggleFavorite}
              onDownload={handleDownload}
              showHeader={true}
              showIndex={true}
              emptyText="暂无歌曲数据"
            />
          </>
        )}
      </div>
    </div>
  );
};

export default ArtistDetailPage;
