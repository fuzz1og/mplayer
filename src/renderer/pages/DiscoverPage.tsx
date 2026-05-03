import React, { useState, useEffect } from 'react';
import { Sparkles, TrendingUp, Disc, Radio } from 'lucide-react';
import { musicApi } from '@/main/api/musicApi';
import type { Song } from '@/shared/types/song';

// 热榜歌曲类型
interface HotlistSong {
  id: string;
  name: string;
  artists: string;
  rank: number;
  cover: string;
  album: string;
}

interface DiscoverPageProps {
  onPlay: (song: Song) => void;
  onNavigateToHotlistDetail: (type: 'netease' | 'qq') => void;
}



const SectionHeader: React.FC<{ icon: React.ReactNode; title: string; action?: string; onClickAction?: () => void }> = ({
  icon,
  title,
  action,
  onClickAction
}) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: '20px',
    }}
  >
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
      <span style={{ color: 'var(--accent-color)' }}>{icon}</span>
      <h2
        style={{
          fontSize: '20px',
          fontWeight: 600,
          color: 'var(--text-primary)',
        }}
      >
        {title}
      </h2>
    </div>
    {action && (
      <button
        style={{
          fontSize: '13px',
          color: 'var(--text-secondary)',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          padding: '4px 8px',
          borderRadius: '4px',
          transition: 'all 0.15s ease',
        }}
        onClick={onClickAction}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = 'var(--accent-color)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = 'var(--text-secondary)';
        }}
      >
        {action} →
      </button>
    )}
  </div>
);

const DiscoverPage: React.FC<DiscoverPageProps> = ({ onPlay, onNavigateToHotlistDetail }) => {
  const [hotlist, setHotlist] = useState<HotlistSong[]>([]);
  const [hotlistLoading, setHotlistLoading] = useState(true);

  const [qqHotlist, setQQHotlist] = useState<HotlistSong[]>([]);
  const [qqHotlistLoading, setQQHotlistLoading] = useState(true);

  // 加载网易热榜数据
  useEffect(() => {
    const loadHotlist = async () => {
      try {
        setHotlistLoading(true);
        const data = await musicApi.getNeteaseHotlist();
        setHotlist(data.slice(0, 20)); // 只显示前20首
      } catch (error) {
        console.error('加载网易热榜失败:', error);
      } finally {
        setHotlistLoading(false);
      }
    };

    loadHotlist();
  }, []);

  // 加载QQ音乐热榜数据
  useEffect(() => {
    const loadQQHotlist = async () => {
      try {
        setQQHotlistLoading(true);
        const data = await musicApi.getQQHotlist();
        setQQHotlist(data.slice(0, 20)); // 只显示前20首
      } catch (error) {
        console.error('加载QQ音乐热榜失败:', error);
      } finally {
        setQQHotlistLoading(false);
      }
    };

    loadQQHotlist();
  }, []);

  // 处理热榜歌曲点击
  const handleHotlistSongClick = async (song: HotlistSong, sourceType: 'netease' | 'qq' = 'netease') => {
    try {
      // 使用歌曲名 + 歌手名作为关键词搜索
      const keyword = `${song.name} ${song.artists}`;
      const searchResults = await musicApi.searchSongs(keyword, 1, sourceType);

      if (searchResults.length > 0) {
        // 播放第一首匹配的歌曲
        onPlay(searchResults[0]);
      }
    } catch (error) {
      console.error('搜索歌曲失败:', error);
    }
  };

  return (
    <div style={{ padding: '24px', height: '100%', overflow: 'auto' }}>
      {/* Banner 区域 */}
      <div
        style={{
          height: '200px',
          borderRadius: '12px',
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: '32px',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' fill-rule=\'evenodd\'%3E%3Cg fill=\'%23ffffff\' fill-opacity=\'0.08\'%3E%3Cpath d=\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")',
          }}
        />
        <div style={{ textAlign: 'center', color: 'white', zIndex: 1 }}>
          <h1 style={{ fontSize: '32px', fontWeight: 700, marginBottom: '8px' }}>
            发现好音乐
          </h1>
          <p style={{ fontSize: '16px', opacity: 0.9 }}>
            探索无限可能，聆听世界声音
          </p>
        </div>
      </div>

      {/* 排行榜 */}
      <section style={{ marginBottom: '40px' }}>
        <SectionHeader
          icon={<TrendingUp size={22} />}
          title="排行榜"
          action="查看全部"
          onClickAction={() => onNavigateToHotlistDetail('netease')}
        />
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: '20px',
          }}
        >
          {/* 网易热榜卡片 */}
          <div
            style={{
              backgroundColor: 'var(--content-bg)',
              borderRadius: '8px',
              padding: '16px',
              border: '1px solid var(--border-color)',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
            onClick={() => onNavigateToHotlistDetail('netease')}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--accent-color)';
              e.currentTarget.style.transform = 'translateY(-2px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border-color)';
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                marginBottom: '12px',
              }}
            >
              <div
                style={{
                  width: '60px',
                  height: '60px',
                  borderRadius: '6px',
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'white',
                  fontWeight: 600,
                }}
              >
                热榜
              </div>
              <div>
                <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  网易热榜
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                  实时更新，最热门的50首歌曲
                </div>
              </div>
            </div>
            <div>
              {hotlistLoading ? (
                // 加载占位符
                Array.from({ length: 5 }).map((_, index) => (
                  <div
                    key={`placeholder-${index}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '8px 0',
                      borderBottom: index < 4 ? '1px solid var(--divider-color)' : 'none',
                    }}
                  >
                    <span
                      style={{
                        width: '20px',
                        height: '14px',
                        backgroundColor: 'var(--divider-color)',
                        borderRadius: '2px',
                        animation: 'pulse 1.5s ease-in-out infinite',
                      }}
                    />
                    <span
                      style={{
                        flex: 1,
                        height: '13px',
                        backgroundColor: 'var(--divider-color)',
                        borderRadius: '2px',
                        animation: 'pulse 1.5s ease-in-out infinite',
                        animationDelay: '0.1s',
                      }}
                    />
                    <span
                      style={{
                        width: '80px',
                        height: '12px',
                        backgroundColor: 'var(--divider-color)',
                        borderRadius: '2px',
                        animation: 'pulse 1.5s ease-in-out infinite',
                        animationDelay: '0.2s',
                      }}
                    />
                  </div>
                ))
              ) : (
                // 实际歌曲列表
                hotlist.slice(0, 5).map((song) => (
                  <div
                    key={song.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '8px 0',
                      borderBottom: song.rank < 5 ? '1px solid var(--divider-color)' : 'none',
                    }}
                  >
                    <span
                      style={{
                        width: '20px',
                        fontSize: '14px',
                        fontWeight: 600,
                        color: song.rank <= 3 ? '#FF4D4F' : 'var(--text-tertiary)',
                      }}
                    >
                      {song.rank}
                    </span>
                    <span
                      style={{
                        flex: 1,
                        fontSize: '13px',
                        color: 'var(--text-primary)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {song.name}
                    </span>
                    <span
                      style={{
                        fontSize: '12px',
                        color: 'var(--text-tertiary)',
                      }}
                    >
                      {song.artists}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* QQ音乐热榜卡片 */}
          <div
            style={{
              backgroundColor: 'var(--content-bg)',
              borderRadius: '8px',
              padding: '16px',
              border: '1px solid var(--border-color)',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
            onClick={() => onNavigateToHotlistDetail('qq')}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--accent-color)';
              e.currentTarget.style.transform = 'translateY(-2px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border-color)';
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                marginBottom: '12px',
              }}
            >
              <div
                style={{
                  width: '60px',
                  height: '60px',
                  borderRadius: '6px',
                  background: 'linear-gradient(135deg, #FF6B6B 0%, #4ECDC4 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'white',
                  fontWeight: 600,
                }}
              >
                热榜
              </div>
              <div>
                <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  QQ音乐热榜
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                  实时更新，最热门的20首歌曲
                </div>
              </div>
            </div>
            <div>
              {qqHotlistLoading ? (
                // 加载占位符
                Array.from({ length: 5 }).map((_, index) => (
                  <div
                    key={`qq-placeholder-${index}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '8px 0',
                      borderBottom: index < 4 ? '1px solid var(--divider-color)' : 'none',
                    }}
                  >
                    <span
                      style={{
                        width: '20px',
                        height: '14px',
                        backgroundColor: 'var(--divider-color)',
                        borderRadius: '2px',
                        animation: 'pulse 1.5s ease-in-out infinite',
                      }}
                    />
                    <span
                      style={{
                        flex: 1,
                        height: '13px',
                        backgroundColor: 'var(--divider-color)',
                        borderRadius: '2px',
                        animation: 'pulse 1.5s ease-in-out infinite',
                        animationDelay: '0.1s',
                      }}
                    />
                    <span
                      style={{
                        width: '80px',
                        height: '12px',
                        backgroundColor: 'var(--divider-color)',
                        borderRadius: '2px',
                        animation: 'pulse 1.5s ease-in-out infinite',
                        animationDelay: '0.2s',
                      }}
                    />
                  </div>
                ))
              ) : (
                // 实际歌曲列表
                qqHotlist.slice(0, 5).map((song) => (
                  <div
                    key={song.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '8px 0',
                      borderBottom: song.rank < 5 ? '1px solid var(--divider-color)' : 'none',
                      cursor: 'pointer',
                      transition: 'background-color 0.15s ease',
                    }}
                    onClick={() => handleHotlistSongClick(song, 'qq')}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'var(--hover-bg)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent';
                    }}
                  >
                    <span
                      style={{
                        width: '20px',
                        fontSize: '14px',
                        fontWeight: 600,
                        color: song.rank <= 3 ? '#FF4D4F' : 'var(--text-tertiary)',
                      }}
                    >
                      {song.rank}
                    </span>
                    <span
                      style={{
                        flex: 1,
                        fontSize: '13px',
                        color: 'var(--text-primary)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {song.name}
                    </span>
                    <span
                      style={{
                        fontSize: '12px',
                        color: 'var(--text-tertiary)',
                      }}
                    >
                      {song.artists}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
          <style>{`
            @keyframes pulse {
              0%, 100% {
                opacity: 0.6;
              }
              50% {
                opacity: 1;
              }
            }
          `}</style>
        </div>
      </section>

      {/* 推荐歌单 - 功能开发中 */}
      <section style={{ marginBottom: '40px' }}>
        <SectionHeader
          icon={<Sparkles size={22} />}
          title="推荐歌单"
        />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '120px',
            backgroundColor: 'var(--content-bg)',
            borderRadius: '8px',
            border: '1px solid var(--border-color)',
            color: 'var(--text-tertiary)',
          }}
        >
          <span>推荐歌单功能开发中...</span>
        </div>
      </section>

      {/* 新碟上架 - 功能开发中 */}
      <section style={{ marginBottom: '40px' }}>
        <SectionHeader
          icon={<Disc size={22} />}
          title="新碟上架"
        />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '120px',
            backgroundColor: 'var(--content-bg)',
            borderRadius: '8px',
            border: '1px solid var(--border-color)',
            color: 'var(--text-tertiary)',
          }}
        >
          <span>新碟上架功能开发中...</span>
        </div>
      </section>

      {/* 电台推荐 - 功能开发中 */}
      <section>
        <SectionHeader
          icon={<Radio size={22} />}
          title="热门电台"
        />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '120px',
            backgroundColor: 'var(--content-bg)',
            borderRadius: '8px',
            border: '1px solid var(--border-color)',
            color: 'var(--text-tertiary)',
          }}
        >
          <span>热门电台功能开发中...</span>
        </div>
      </section>
    </div>
  );
};

export default DiscoverPage;
