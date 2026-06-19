import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import SongList from '@/renderer/components/SongList';
import { usePlayerStore } from '@/renderer/store/playerStore';
import { useDownload } from '@/renderer/hooks/useDownload';
import type { Song } from '@/shared/types/song';
const { ipcRenderer } = window.require('electron');

// 热榜歌曲类型
interface HotlistSong {
  id: string;
  name: string;
  artists: string;
  rank: number;
  cover: string;
  album: string;
}

const HotlistDetailPage: React.FC = () => {
  const { type } = useParams<{ type: 'netease' | 'netease_new' | 'qq' | 'qq_new' }>();
  const navigate = useNavigate();
  const hotlistType = type || 'netease';

  const [hotlist, setHotlist] = useState<HotlistSong[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { play, currentSong, isPlaying } = usePlayerStore();
  const { download, downloadBatch } = useDownload();

  // 加载热榜数据
  useEffect(() => {
    const loadHotlist = async () => {
      try {
        setLoading(true);
        setError(null);
        let data;
        if (hotlistType === 'netease') {
          const result = await ipcRenderer.invoke('musicApi:getNeteaseHotlist');
          data = result.success ? result.data : [];
        } else if (hotlistType === 'netease_new') {
          const result = await ipcRenderer.invoke('musicApi:getNeteaseNewSongList');
          data = result.success ? result.data : [];
        } else if (hotlistType === 'qq') {
          const result = await ipcRenderer.invoke('musicApi:getQQHotlist');
          data = result.success ? result.data : [];
        } else if (hotlistType === 'qq_new') {
          const result = await ipcRenderer.invoke('musicApi:getQQNewSongList');
          data = result.success ? result.data : [];
        } else {
          const result = await ipcRenderer.invoke('musicApi:getNeteaseHotlist');
          data = result.success ? result.data : [];
        }

        setHotlist(data);
      } catch (error) {
        console.error(`加载热榜失败:`, error);
        setError('加载热榜失败，请稍后重试');
      } finally {
        setLoading(false);
      }
    };

    loadHotlist();
  }, [hotlistType]);

  // 转换热榜歌曲为Song类型
  const convertToSongs = (hotlistSongs: HotlistSong[]): Song[] => {
    return hotlistSongs.map(song => ({
      id: song.id,
      name: song.name,
      artist: song.artists,
      album: song.album,
      cover: song.cover,
      url: '',
      duration: 0,
      lrc: '',
      sourceType: (hotlistType === 'netease_new' ? 'netease' : hotlistType === 'qq_new' ? 'qq' : hotlistType) as 'netease' | 'qq'
    }));
  };

  const handlePlay = async (song: Song) => {
    const keyword = `${song.name} ${song.artist}`;
    const sourceType = hotlistType === 'netease_new' ? 'netease' : hotlistType === 'qq_new' ? 'qq' : hotlistType;
    const result = await ipcRenderer.invoke('musicApi:searchSongs', keyword, 1, sourceType);
    const searchResults = result.success ? result.data : [];
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
          borderBottom: '1px solid var(--divider-color)',
          backgroundColor: 'var(--content-bg)',
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
              background: hotlistType === 'netease' || hotlistType === 'netease_new'
                ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
                : 'linear-gradient(135deg, #FF6B6B 0%, #4ECDC4 100%)',
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
                      background: 'linear-gradient(135deg, #f0f0f0 0%, #e0e0e0 50%, #f0f0f0 100%)',
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
                      background: 'linear-gradient(135deg, #f0f0f0 0%, #e0e0e0 50%, #f0f0f0 100%)',
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
                        background: 'linear-gradient(135deg, #f0f0f0 0%, #e0e0e0 50%, #f0f0f0 100%)',
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
                        background: 'linear-gradient(135deg, #f0f0f0 0%, #e0e0e0 50%, #f0f0f0 100%)',
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
              backgroundColor: '#FF6B6B20',
              borderRadius: '8px',
              color: '#FF6B6B',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: '32px', marginBottom: '16px' }}>❌</div>
            <div style={{ fontSize: '16px', marginBottom: '8px' }}>{error}</div>
            <button
              onClick={async () => {
                setLoading(true);
                try {
                  let result;
                  if (hotlistType === 'netease' || hotlistType === 'netease_new') {
                    result = await ipcRenderer.invoke('musicApi:getNeteaseHotlist');
                  } else {
                    result = await ipcRenderer.invoke('musicApi:getQQHotlist');
                  }
                  const data = result.success ? result.data : [];
                  setHotlist(data);
                } catch (error) {
                  console.error(error);
                } finally {
                  setLoading(false);
                }
              }}
              style={{
                marginTop: '16px',
                padding: '8px 16px',
                backgroundColor: '#FF6B6B',
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
            songs={convertToSongs(hotlist)}
            currentSongId={currentSong?.id}
            isPlaying={isPlaying}
            onPlay={handlePlay}
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
