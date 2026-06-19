import React, { useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';
import LyricsDisplay from '@/renderer/components/LyricsDisplay';
import { usePlayerStore } from '@/renderer/store/playerStore';

interface LyricsPageProps {
  onBack: () => void;
}

const LyricsPage: React.FC<LyricsPageProps> = ({ onBack }) => {
  const { lyrics, lyricsLoading, position, currentSong, seek } = usePlayerStore();

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
        <span style={{ color: '#636E72', fontSize: '16px' }}>暂无播放中的歌曲</span>
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
      overflow: 'hidden'
    }}>
      {/* 梦幻背景层 */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 0,
        }}
      >
        {/* 使用歌曲封面作为背景 */}
        {currentSong?.cover ? (
          <>
            <img
              src={currentSong.cover}
              alt=""
              style={{
                position: 'absolute',
                inset: '-20px',
                width: 'calc(100% + 40px)',
                height: 'calc(100% + 40px)',
                objectFit: 'cover',
                filter: 'blur(60px) saturate(1.5) brightness(0.8)',
                transform: 'scale(1.1)',
                opacity: 0.6,
              }}
            />
            {/* 渐变遮罩 - 顶部 */}
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: '200px',
                background: 'linear-gradient(to bottom, rgba(250, 250, 250, 0.95) 0%, rgba(250, 250, 250, 0.7) 50%, transparent 100%)',
              }}
            />
            {/* 渐变遮罩 - 底部 */}
            <div
              style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                height: '150px',
                background: 'linear-gradient(to top, rgba(250, 250, 250, 0.95) 0%, rgba(250, 250, 250, 0.7) 50%, transparent 100%)',
              }}
            />
          </>
        ) : (
          /* 没有封面时的渐变背景 */
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: `
                radial-gradient(ellipse at 20% 30%, rgba(116, 185, 255, 0.15) 0%, transparent 50%),
                radial-gradient(ellipse at 80% 70%, rgba(162, 155, 254, 0.12) 0%, transparent 50%),
                radial-gradient(ellipse at 50% 50%, rgba(253, 203, 110, 0.08) 0%, transparent 60%),
                linear-gradient(135deg, #FAFAFA 0%, #F0F4F8 50%, #FAFAFA 100%)
              `,
            }}
          />
        )}

        {/* 装饰性光晕 */}
        <div
          style={{
            position: 'absolute',
            top: '10%',
            left: '10%',
            width: '300px',
            height: '300px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(116, 185, 255, 0.1) 0%, transparent 70%)',
            filter: 'blur(40px)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: '20%',
            right: '15%',
            width: '250px',
            height: '250px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(162, 155, 254, 0.08) 0%, transparent 70%)',
            filter: 'blur(50px)',
          }}
        />
      </div>

      {/* 内容层 */}
      <div style={{
        position: 'relative',
        zIndex: 1,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        padding: '24px'
      }}>
        {/* 返回按钮 */}
        <div style={{ marginBottom: '24px' }}>
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
              <span style={{ color: '#636E72', fontSize: '14px' }}>歌词加载中...</span>
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
                  color: '#999'
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
