import React, { useMemo, useRef, useEffect } from 'react';
import { parseLRC, findCurrentLyricIndex, type ParsedLyrics } from '@/renderer/utils/lyricsParser';

interface LyricsDisplayProps {
  lrcContent: string;
  currentTime: number;
  className?: string;
  style?: React.CSSProperties;
  onLyricClick?: (time: number) => void;
}

const LyricsDisplay: React.FC<LyricsDisplayProps> = ({
  lrcContent,
  currentTime,
  className,
  style,
  onLyricClick
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeLineRef = useRef<HTMLDivElement>(null);

  const safeCurrentTime = typeof currentTime === 'number' && !isNaN(currentTime) ? currentTime : 0;

  const parsedLyrics: ParsedLyrics = useMemo(() => {
    if (!lrcContent) {
      return { lines: [], hasTranslation: false };
    }
    try {
      return parseLRC(lrcContent);
    } catch {
      return { lines: [], hasTranslation: false };
    }
  }, [lrcContent]);

  const currentLineIndex = useMemo(() => {
    if (!parsedLyrics?.lines || parsedLyrics.lines.length === 0) return -1;
    return findCurrentLyricIndex(parsedLyrics.lines, safeCurrentTime);
  }, [parsedLyrics.lines, safeCurrentTime]);

  useEffect(() => {
    if (currentLineIndex < 0 || !activeLineRef.current || !containerRef.current) {
      return;
    }
    const container = containerRef.current;
    const activeLine = activeLineRef.current;

    try {
      const containerRect = container.getBoundingClientRect();
      const activeLineRect = activeLine.getBoundingClientRect();

      const scrollTop = activeLine.offsetTop - containerRect.height / 2 + activeLineRect.height / 2;

      container.scrollTo({
        top: scrollTop,
        behavior: 'smooth'
      });
    } catch {
      // 忽略滚动错误
    }
  }, [currentLineIndex]);

  if (!lrcContent || parsedLyrics.lines.length === 0) {
    return (
      <div
        className={className}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          ...style
        }}
      >
        <span style={{ 
          color: '#2D3436', 
          fontSize: '14px',
          textShadow: '0 1px 2px rgba(255, 255, 255, 0.8)'
        }}>
          暂无歌词
        </span>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        overflowY: 'auto',
        overflowX: 'hidden',
        height: '100%',
        padding: '20px 0',
        ...style
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {parsedLyrics.lines.map((line, index) => {
          const isActive = index === currentLineIndex;
          const isPast = index < currentLineIndex;

          return (
            <div
              key={index}
              ref={isActive ? activeLineRef : null}
              onClick={() => onLyricClick?.(line.time)}
              style={{
                textAlign: 'center',
                padding: '8px 20px',
                transition: 'all 0.3s ease',
                transform: isActive ? 'scale(1.02)' : 'scale(1)',
                cursor: 'pointer',
                borderRadius: '8px',
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  e.currentTarget.style.backgroundColor = 'rgba(116, 185, 255, 0.15)';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              <span
                style={{
                  fontSize: isActive ? '20px' : '17px',
                  fontWeight: isActive ? 700 : 500,
                  color: isActive ? '#2D3436' : isPast ? '#636E72' : '#4A5568',
                  lineHeight: '1.8',
                  transition: 'all 0.3s ease',
                  textShadow: isActive 
                    ? '0 2px 4px rgba(255, 255, 255, 0.9), 0 0 20px rgba(116, 185, 255, 0.3)' 
                    : '0 1px 2px rgba(255, 255, 255, 0.8)',
                  letterSpacing: isActive ? '0.5px' : '0',
                  userSelect: 'none',
                }}
              >
                {line.text}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default React.memo(LyricsDisplay);
