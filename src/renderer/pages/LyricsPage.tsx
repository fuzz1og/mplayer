import React, { useEffect } from 'react';
import { ArrowLeft, Music2, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import LyricsDisplay from '@/renderer/components/LyricsDisplay';
import { useCachedCover } from '@/renderer/services/coverCacheService';
import CoverImage from '@/renderer/components/CoverImage';
import { refreshSongCover } from '@/renderer/utils/songCoverRefresh';
import { usePlayerStore } from '@/renderer/store/playerStore';

interface LyricsPageProps {
  onBack: () => void;
}

const LyricsPage: React.FC<LyricsPageProps> = ({ onBack }) => {
  const lyrics = usePlayerStore((s) => s.lyrics);
  const lyricsLoading = usePlayerStore((s) => s.lyricsLoading);
  const position = usePlayerStore((s) => s.position);
  const currentSong = usePlayerStore((s) => s.currentSong);
  const seek = usePlayerStore((s) => s.seek);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const pause = usePlayerStore((s) => s.pause);
  const resume = usePlayerStore((s) => s.resume);
  const playPrevious = usePlayerStore((s) => s.playPrevious);
  const playNext = usePlayerStore((s) => s.playNext);

  // Escape 键关闭歌词页面
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onBack();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onBack]);

  const handleLyricClick = (time: number) => {
    seek(time);
  };

  const coverSrc = useCachedCover(currentSong?.cover || '');

  if (!currentSong) {
    return (
      <div style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: '16px'
      }}>
        <span style={{ color: 'var(--text-secondary)', fontSize: '16px' }}>暂无播放中的歌曲</span>
        <button
          onClick={onBack}
          style={{
            padding: '8px 16px',
            background: 'var(--primary-color)',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer'
          }}
        >
          返回
        </button>
      </div>
    );
  }

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      position: 'relative',
      overflow: 'hidden',
      backgroundColor: 'var(--bg-base)'
    }}>
      {/* 内容层 */}
      <div style={{
        position: 'relative',
        zIndex: 1,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        padding: '24px'
      }}>
        {/* 迷你播放器头部 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '20px' }}>
          <button
            onClick={onBack}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              border: 'none',
              background: 'rgba(255, 255, 255, 0.8)',
              backdropFilter: 'blur(10px)',
              cursor: 'pointer',
              padding: '8px 16px',
              borderRadius: '20px',
              color: 'var(--text-primary)',
              transition: 'all 0.2s ease',
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.95)';
              e.currentTarget.style.transform = 'translateX(-2px)';
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.12)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.8)';
              e.currentTarget.style.transform = 'translateX(0)';
              e.currentTarget.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.08)';
            }}
          >
            <ArrowLeft size={18} />
            <span style={{ fontSize: '14px', fontWeight: 500 }}>返回</span>
          </button>
          <div style={{ width: '48px', height: '48px', borderRadius: '8px', overflow: 'hidden', backgroundColor: 'var(--hover-bg)', flexShrink: 0 }}>
            {coverSrc ? (
              <CoverImage src={coverSrc} alt="" onError={() => {
                if (!currentSong) return;
                void refreshSongCover(currentSong).then((cover) => {
                  if (!cover) return;
                  usePlayerStore.setState((state) =>
                    state.currentSong?.id === currentSong.id ? { currentSong: { ...state.currentSong, cover } } : state
                  );
                });
              }} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)' }}>
                <Music2 size={18} />
              </div>
            )}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{currentSong?.name}</div>
            <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '2px' }}>{currentSong?.artist}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
            <button onClick={playPrevious} className="player-btn" aria-label="上一首"><SkipBack size={16} fill="currentColor" /></button>
            <button onClick={() => (isPlaying ? pause() : resume())} aria-label={isPlaying ? '暂停' : '播放'} style={{ width: '38px', height: '38px', borderRadius: '50%', border: 'none', backgroundColor: 'var(--accent-color)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: 'var(--shadow-sm)' }}>
              {isPlaying ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" style={{ marginLeft: '1px' }} />}
            </button>
            <button onClick={playNext} className="player-btn" aria-label="下一首"><SkipForward size={16} fill="currentColor" /></button>
          </div>
        </div>

        {/* 歌词显示区域 */}
        <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
          {lyricsLoading ? (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%'
            }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>歌词加载中...</span>
            </div>
          ) : (
            <>
              <LyricsDisplay
                lrcContent={lyrics || ''}
                currentTime={isNaN(position) ? 0 : position}
                onLyricClick={handleLyricClick}
              />
              {!lyrics && (
                <div style={{
                  position: 'absolute',
                  bottom: '20px',
                  left: 0,
                  right: 0,
                  textAlign: 'center',
                  fontSize: '12px',
                  color: 'var(--text-tertiary)'
                }}>
                  当前歌曲暂无歌词
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default LyricsPage;
