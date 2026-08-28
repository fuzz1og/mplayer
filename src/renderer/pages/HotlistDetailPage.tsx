import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, AlertCircle } from 'lucide-react';
import SongList from '@/renderer/components/SongList';
import { usePlayerStore } from '@/renderer/store/playerStore';
import { useFavoriteStore } from '@/renderer/store/favoriteStore';
import { useDownload } from '@/renderer/hooks/useDownload';
import { callMusicApi } from '@/renderer/services/callMusicApi';
import type { Song } from '@mplayer/core';

// QQ 榜单旧结构（QQ 内容迁移在后续票，#278 仅迁网易；rank 由索引推导）
interface QqHotlistItem {
  id: string;
  name: string;
  artists: string;
  rank: number;
  cover: string;
  album: string;
}

/** 榜单组按 id 取 songs（ToplistGroup.id = `${source}:${sourceId}`，#278）。 */
function pickToplist(groups: { id: string; songs: Song[] }[], sourceId: number): Song[] {
  return groups.find((g) => g.id === `netease:${sourceId}`)?.songs ?? [];
}

const HotlistDetailPage: React.FC = () => {
  const { type } = useParams<{ type: 'netease' | 'netease_new' | 'qq' | 'qq_new' }>();
  const navigate = useNavigate();
  const hotlistType = type || 'netease';

  const [hotlist, setHotlist] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const play = usePlayerStore((s) => s.play);
  const currentSong = usePlayerStore((s) => s.currentSong);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const favoriteIds = useFavoriteStore((s) => s.favoriteIds);
  const toggleFavorite = useFavoriteStore((s) => s.toggleFavorite);
  const { download, downloadBatch } = useDownload();

  // 加载热榜数据
  useEffect(() => {
    const loadHotlist = async () => {
      try {
        setLoading(true);
        setError(null);
        if (hotlistType === 'netease' || hotlistType === 'netease_new') {
          // 网易榜单走能力面 getToplists（歌词内联，#242），按 id 取组
          const groups = await callMusicApi('getToplists', 'netease');
          setHotlist(pickToplist(groups, hotlistType === 'netease' ? 3778678 : 3779629));
        } else {
          const raw: QqHotlistItem[] = hotlistType === 'qq'
            ? await callMusicApi('getQQHotlist')
            : await callMusicApi('getQQNewSongList');
          setHotlist(convertToSongs(raw || []));
        }
      } catch (error) {
        console.error(`加载热榜失败:`, error);
        setError('加载热榜失败，请稍后重试');
      } finally {
        setLoading(false);
      }
    };

    loadHotlist();
  }, [hotlistType]);

  // QQ 榜单旧结构 → Song（rank 由索引推导；网易路径直接用能力面返回的 Song）
  const convertToSongs = (hotlistSongs: QqHotlistItem[]): Song[] => {
    return hotlistSongs.map(song => ({
      id: song.id,
      name: song.name,
      artist: song.artists,
      album: song.album,
      cover: song.cover,
      url: '',
      duration: 0,
      lrc: '',
      sourceType: (hotlistType === 'qq_new' ? 'qq' : hotlistType) as 'netease' | 'qq'
    }));
  };

  const handlePlay = async (song: Song) => {
    const keyword = `${song.name} ${song.artist}`;
    const sourceType = hotlistType === 'netease_new' ? 'netease' : hotlistType === 'qq_new' ? 'qq' : hotlistType;
    const searchResults = await callMusicApi('searchSongsRouted', keyword, 1, sourceType);
    if (searchResults.length > 0) {
      await play(searchResults[0]);
    }
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 导航栏 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          padding: '12px 24px',
          borderBottom: '1px solid var(--border-subtle)',
          backgroundColor: 'var(--bg-surface)',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
          height: '60px',
        }}
      >
        <button
          onClick={() => navigate('/discover')}
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
            e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
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
          {hotlistType === 'netease' ? '网易云音乐热歌榜' :
           hotlistType === 'netease_new' ? '网易云音乐新歌榜' :
           hotlistType === 'qq_new' ? 'QQ音乐新歌榜' :
           'QQ音乐热歌榜'}
        </h1>
        <div style={{ width: '140px' }} />
      </div>

      {/* 内容区域 */}
      <div style={{ flex: 1, overflow: 'auto', padding: '24px' }}>
        {/* 热榜标题 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            marginBottom: '32px',
          }}
        >
          <div
            style={{
              width: '80px',
              height: '80px',
              borderRadius: '8px',
              background: 'linear-gradient(135deg, var(--accent) 0%, var(--accent-active) 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              fontWeight: 600,
              fontSize: '20px',
            }}
          >
            热榜
          </div>
          <div>
            <h2 style={{ fontSize: '28px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '8px' }}>
              {hotlistType === 'netease' ? '网易云音乐热歌榜' :
               hotlistType === 'netease_new' ? '网易云音乐新歌榜' :
               hotlistType === 'qq_new' ? 'QQ音乐新歌榜' :
               'QQ音乐热歌榜'}
            </h2>
            <p style={{ fontSize: '14px', color: 'var(--text-tertiary)' }}>
              实时更新，最热门的100首歌曲
            </p>
          </div>
        </div>

        {/* 热榜歌曲列表 */}
        {loading ? (
          <div>
            {/* 骨架屏 */}
            {Array.from({ length: 10 }).map((_, index) => (
              <div
                key={`skeleton-${index}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '10px 16px',
                  borderRadius: '6px',
                  marginBottom: '8px',
                }}
              >
                <div style={{ width: '50px', textAlign: 'center' }}>
                  <div
                    style={{
                      width: '20px',
                      height: '14px',
                      borderRadius: '2px',
                      background: 'linear-gradient(135deg, var(--skeleton-shine) 0%, var(--skeleton-base) 50%, var(--skeleton-shine) 100%)',
                      backgroundSize: '200% 200%',
                      animation: 'skeletonLoading 1.5s ease-in-out infinite',
                      margin: '0 auto',
                    }}
                  />
                </div>
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div
                    style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '4px',
                      background: 'linear-gradient(135deg, var(--skeleton-shine) 0%, var(--skeleton-base) 50%, var(--skeleton-shine) 100%)',
                      backgroundSize: '200% 200%',
                      animation: 'skeletonLoading 1.5s ease-in-out infinite',
                    }}
                  />
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        width: '70%',
                        height: '14px',
                        borderRadius: '2px',
                        background: 'linear-gradient(135deg, var(--skeleton-shine) 0%, var(--skeleton-base) 50%, var(--skeleton-shine) 100%)',
                        backgroundSize: '200% 200%',
                        animation: 'skeletonLoading 1.5s ease-in-out infinite',
                        marginBottom: '4px',
                      }}
                    />
                    <div
                      style={{
                        width: '50%',
                        height: '12px',
                        borderRadius: '2px',
                        background: 'linear-gradient(135deg, var(--skeleton-shine) 0%, var(--skeleton-base) 50%, var(--skeleton-shine) 100%)',
                        backgroundSize: '200% 200%',
                        animation: 'skeletonLoading 1.5s ease-in-out infinite',
                        animationDelay: '0.1s',
                      }}
                    />
                  </div>
                </div>
              </div>
            ))}
            <style>{`
              @keyframes skeletonLoading {
                0% {
                  background-position: 200% 0;
                }
                100% {
                  background-position: -200% 0;
                }
              }
            `}</style>
          </div>
        ) : error ? (
          <div
            style={{
              padding: '24px',
              backgroundColor: 'var(--danger-subtle)',
              borderRadius: '8px',
              color: 'var(--danger)',
              textAlign: 'center',
            }}
          >
            <AlertCircle size={28} style={{ marginBottom: '12px', color: 'var(--danger)' }} />
            <div style={{ fontSize: '16px', marginBottom: '8px' }}>{error}</div>
            <button
              onClick={async () => {
                setLoading(true);
                try {
                  if (hotlistType === 'netease' || hotlistType === 'netease_new') {
                    const groups = await callMusicApi('getToplists', 'netease');
                    setHotlist(pickToplist(groups, hotlistType === 'netease' ? 3778678 : 3779629));
                  } else {
                    const raw: QqHotlistItem[] = await callMusicApi('getQQHotlist');
                    setHotlist(convertToSongs(raw || []));
                  }
                } catch (error) {
                  console.error(error);
                } finally {
                  setLoading(false);
                }
              }}
              style={{
                marginTop: '16px',
                padding: '8px 16px',
                backgroundColor: 'var(--danger)',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              重试
            </button>
          </div>
        ) : (
          <SongList
            songs={hotlist}
            currentSongId={currentSong?.id}
            isPlaying={isPlaying}
            favoriteIds={favoriteIds}
            onPlay={handlePlay}
            onToggleFavorite={toggleFavorite}
            showHeader={true}
            showIndex={true}
            showCheckbox={true}
            enableBatchDownload={true}
            onDownload={download}
            onBatchDownload={downloadBatch}
            enableBatchAddToPlaylist={true}
            emptyText="暂无热榜歌曲"
          />
        )}
      </div>
    </div>
  );
};

export default HotlistDetailPage;
