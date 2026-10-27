import React, { useMemo, useRef, useEffect } from 'react';
import { parseLRC, findCurrentLyricIndex, type ParsedLyrics } from '@mplayer/core';
import { usePlaybackSelector } from '@/renderer/services/playbackClock';

interface LyricsDisplayProps {
  lrcContent: string;
  className?: string;
  style?: React.CSSProperties;
  onLyricClick?: (time: number) => void;
}

const LyricsDisplay: React.FC<LyricsDisplayProps> = ({
  lrcContent,
  className,
  style,
  onLyricClick
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeLineRef = useRef<HTMLDivElement>(null);

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

  // 只订阅派生值「当前行序号」：250ms 的采样落到歌词上只在换行时重渲染一次，
  // 不再每次 tick 重算并重渲染全部歌词行
  const currentLineIndex = usePlaybackSelector((snapshot) => {
    if (!parsedLyrics?.lines || parsedLyrics.lines.length === 0) return -1;
    const currentTime = typeof snapshot.position === 'number' && !isNaN(snapshot.position) ? snapshot.position : 0;
    return findCurrentLyricIndex(parsedLyrics.lines, currentTime);
  });

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
      <div className={className ? className + ' lyrics__empty' : 'lyrics__empty'} style={style}>
        <span className="lyrics__empty-text">暂无歌词</span>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={className ? className + ' lyrics' : 'lyrics'}
      data-scroll
      style={style}
    >
      <div className="lyrics__lines">
        {parsedLyrics.lines.map((line, index) => {
          const isActive = index === currentLineIndex;

          return (
            <div
              key={index}
              ref={isActive ? activeLineRef : null}
              onClick={() => onLyricClick?.(line.time)}
              className="lyrics__line"
              data-active={isActive || undefined}
            >
              <span className="lyrics__text">
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
