import React, { useState, useEffect } from 'react';
import { musicApi } from '@/main/api/musicApi';
import SongList from '@/renderer/components/SongList';
import type { Song } from '@/shared/types/song';

interface HotlistDetailPageProps {
  onBack?: () => void;
  onPlay: (song: Song) => void;
  hotlistType: 'netease' | 'qq';
  onDownload?: (song: Song) => void;
  onBatchDownload?: (songs: Song[]) => void;
  onAddToPlaylist?: (song: Song) => void;
  onBatchAddToPlaylist?: (songs: Song[]) => void;
}

// 热榜歌曲类型
interface HotlistSong {
  id: string;
  name: string;
  artists: string;
  rank: number;
  cover: string;
  album: string;
}

const HotlistDetailPage: React.FC<HotlistDetailPageProps> = ({ onBack: _onBack, onPlay, hotlistType, onDownload, onBatchDownload, onAddToPlaylist, onBatchAddToPlaylist }) => {
  const [hotlist, setHotlist] = useState<HotlistSong[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 加载热榜数据
  useEffect(() => {
    const loadHotlist = async () => {
      try {
        setLoading(true);
        setError(null);
        let data;
        if (hotlistType === 'netease') {
          data = await musicApi.getNeteaseHotlist();
        } else {
          data = await musicApi.getQQHotlist();
        }

        // 为QQ音乐热榜的歌曲获取专辑图片
        if (hotlistType === 'qq' && data.length > 0) {
          const songsWithCovers = await Promise.all(
            data.map(async (song) => {
              try {
                const keyword = `${song.name} ${song.artists}`;
                const searchResults = await musicApi.searchSongs(keyword, 1, 'qq');
                if (searchResults.length > 0) {
                  return {
                    ...song,
                    cover: searchResults[0].cover
                  };
                }
              } catch (error) {
                console.error('获取歌曲封面失败:', error);
              }
              return song;
            })
          );
          setHotlist(songsWithCovers);
        } else {
          setHotlist(data);
        }
      } catch (error) {
        console.error(`加载${hotlistType === 'netease' ? '网易' : 'QQ'}热榜失败:`, error);
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
      url: '', // 热榜数据中没有音频URL，需要通过搜索获取
      duration: 0, // 热榜数据中没有时长信息
      lrc: '', // 热榜数据中没有歌词信息
      sourceType: hotlistType
    }));
  };

  return (
    <div style={{ padding: '24px', height: '100%', overflow: 'auto' }}>
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
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
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
          <h1 style={{ fontSize: '28px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '8px' }}>
            {hotlistType === 'netease' ? '网易云音乐热歌榜' : 'QQ音乐热歌榜'}
          </h1>
          <p style={{ fontSize: '14px', color: 'var(--text-tertiary)' }}>
            实时更新，最热门的{hotlistType === 'netease' ? '50' : '20'}首歌曲
          </p>
        </div>
      </div>

      {/* 热榜歌曲列表 */}
      {loading ? (
        <div
          style={{
            backgroundColor: 'var(--content-bg)',
            borderRadius: '8px',
            padding: '24px',
            border: '1px solid var(--border-color)',
          }}
        >
          {/* 热榜标题骨架屏 */}
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
                background: 'linear-gradient(135deg, #f0f0f0 0%, #e0e0e0 50%, #f0f0f0 100%)',
                backgroundSize: '200% 200%',
                animation: 'skeletonLoading 1.5s ease-in-out infinite',
              }}
            />
            <div style={{ flex: 1 }}>
              <div
                style={{
                  width: '60%',
                  height: '28px',
                  borderRadius: '4px',
                  background: 'linear-gradient(135deg, #f0f0f0 0%, #e0e0e0 50%, #f0f0f0 100%)',
                  backgroundSize: '200% 200%',
                  animation: 'skeletonLoading 1.5s ease-in-out infinite',
                  marginBottom: '8px',
                }}
              />
              <div
                style={{
                  width: '40%',
                  height: '14px',
                  borderRadius: '4px',
                  background: 'linear-gradient(135deg, #f0f0f0 0%, #e0e0e0 50%, #f0f0f0 100%)',
                  backgroundSize: '200% 200%',
                  animation: 'skeletonLoading 1.5s ease-in-out infinite',
                  animationDelay: '0.2s',
                }}
              />
            </div>
          </div>

          {/* 歌曲列表骨架屏 */}
          <div>
            {/* 表头 */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '12px 16px',
                borderBottom: '1px solid var(--divider-color)',
                fontSize: '12px',
                color: 'var(--text-tertiary)',
                fontWeight: 500,
                marginBottom: '8px',
              }}
            >
              <div style={{ width: '40px', textAlign: 'center' }}></div>
              <div style={{ width: '50px', textAlign: 'center' }}>#</div>
              <div style={{ flex: 1 }}>标题</div>
              <div style={{ width: '25%' }}>专辑</div>
              <div style={{ width: '80px', textAlign: 'right' }}>时长</div>
              <div style={{ width: '100px', textAlign: 'center' }}>操作</div>
            </div>

            {/* 歌曲行骨架屏 */}
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
                <div style={{ width: '40px', textAlign: 'center' }}>
                  <div
                    style={{
                      width: '16px',
                      height: '16px',
                      borderRadius: '4px',
                      background: 'linear-gradient(135deg, #f0f0f0 0%, #e0e0e0 50%, #f0f0f0 100%)',
                      backgroundSize: '200% 200%',
                      animation: 'skeletonLoading 1.5s ease-in-out infinite',
                      margin: '0 auto',
                    }}
                  />
                </div>
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
                <div style={{ width: '25%' }}>
                  <div
                    style={{
                      width: '80%',
                      height: '13px',
                      borderRadius: '2px',
                      background: 'linear-gradient(135deg, #f0f0f0 0%, #e0e0e0 50%, #f0f0f0 100%)',
                      backgroundSize: '200% 200%',
                      animation: 'skeletonLoading 1.5s ease-in-out infinite',
                      animationDelay: '0.2s',
                    }}
                  />
                </div>
                <div style={{ width: '80px', textAlign: 'right' }}>
                  <div
                    style={{
                      width: '40px',
                      height: '13px',
                      borderRadius: '2px',
                      background: 'linear-gradient(135deg, #f0f0f0 0%, #e0e0e0 50%, #f0f0f0 100%)',
                      backgroundSize: '200% 200%',
                      animation: 'skeletonLoading 1.5s ease-in-out infinite',
                      animationDelay: '0.3s',
                      marginLeft: 'auto',
                    }}
                  />
                </div>
                <div style={{ width: '100px', textAlign: 'center' }}>
                  <div
                    style={{
                      width: '16px',
                      height: '16px',
                      borderRadius: '50%',
                      background: 'linear-gradient(135deg, #f0f0f0 0%, #e0e0e0 50%, #f0f0f0 100%)',
                      backgroundSize: '200% 200%',
                      animation: 'skeletonLoading 1.5s ease-in-out infinite',
                      animationDelay: '0.4s',
                      margin: '0 auto',
                    }}
                  />
                </div>
              </div>
            ))}
          </div>

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
            onClick={() => {
              setLoading(true);
              const loadFunction = hotlistType === 'netease' ? musicApi.getNeteaseHotlist : musicApi.getQQHotlist;
              loadFunction().then(setHotlist).catch(console.error).finally(() => setLoading(false));
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
        <div
          style={{
            backgroundColor: 'var(--content-bg)',
            borderRadius: '8px',
            padding: '24px',
            border: '1px solid var(--border-color)',
          }}
        >
          <SongList
            songs={convertToSongs(hotlist)}
            onPlay={async (song) => {
              // 使用歌曲名 + 歌手名作为关键词搜索
              const keyword = `${song.name} ${song.artist}`;
              const searchResults = await musicApi.searchSongs(keyword, 1, hotlistType);

              if (searchResults.length > 0) {
                // 播放第一首匹配的歌曲
                onPlay(searchResults[0]);
              }
            }}
            onDownload={async (song) => {
              // 使用歌曲名 + 歌手名作为关键词搜索
              const keyword = `${song.name} ${song.artist}`;
              const searchResults = await musicApi.searchSongs(keyword, 1, hotlistType);

              if (searchResults.length > 0 && onDownload) {
                // 下载第一首匹配的歌曲
                onDownload(searchResults[0]);
              }
            }}
            onBatchDownload={async (songs) => {
              // 为每首歌曲搜索并下载
              if (!onBatchDownload) return;

              const searchPromises = songs.map(async (song) => {
                const keyword = `${song.name} ${song.artist}`;
                const searchResults = await musicApi.searchSongs(keyword, 1, hotlistType);
                return searchResults.length > 0 ? searchResults[0] : null;
              });

              const searchResults = await Promise.all(searchPromises);
              const validSongs = searchResults.filter((song): song is Song => song !== null);

              if (validSongs.length > 0) {
                onBatchDownload(validSongs);
              }
            }}
            onAddToPlaylist={async (song) => {
              // 使用歌曲名 + 歌手名作为关键词搜索
              const keyword = `${song.name} ${song.artist}`;
              const searchResults = await musicApi.searchSongs(keyword, 1, hotlistType);

              if (searchResults.length > 0 && onAddToPlaylist) {
                // 加入歌单第一首匹配的歌曲
                onAddToPlaylist(searchResults[0]);
              }
            }}
            onBatchAddToPlaylist={async (songs) => {
              // 为每首歌曲搜索并加入歌单
              if (!onBatchAddToPlaylist) return;

              const searchPromises = songs.map(async (song) => {
                const keyword = `${song.name} ${song.artist}`;
                const searchResults = await musicApi.searchSongs(keyword, 1, hotlistType);
                return searchResults.length > 0 ? searchResults[0] : null;
              });

              const searchResults = await Promise.all(searchPromises);
              const validSongs = searchResults.filter((song): song is Song => song !== null);

              if (validSongs.length > 0) {
                onBatchAddToPlaylist(validSongs);
              }
            }}
            showHeader={true}
            showIndex={true}
            showCheckbox={true}
            enableBatchDownload={true}
            enableBatchAddToPlaylist={true}
            emptyText="暂无热榜歌曲"
          />
        </div>
      )}
    </div>
  );
};

export default HotlistDetailPage;