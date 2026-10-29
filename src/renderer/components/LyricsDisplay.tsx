import React, { useEffect, useMemo, useRef } from 'react';
import { parseLRC, findCurrentLyricIndex, type LyricWord, type ParsedLyrics } from '@mplayer/core';
import { playbackClock, usePlaybackPlaying, usePlaybackSelector } from '@/renderer/services/playbackClock';
import '@/renderer/styles/songlist.css';

interface LyricsDisplayProps {
  lrcContent: string;
  className?: string;
  style?: React.CSSProperties;
  onLyricClick?: (time: number) => void;
}

export interface WordFill {
  index: number;
  progress: number;
}

/** 词内进度：当前词序号 + 该词已唱比例（0~1，词前/词后按端点夹紧）；没有逐字轨道返回 null */
export function wordFillAt(words: LyricWord[] | undefined, position: number): WordFill | null {
  if (!words || words.length === 0) return null;
  const index = findCurrentLyricIndex(words, position);
  const word = words[index < 0 ? 0 : index];
  if (!word) return { index: 0, progress: 0 };
  const raw = word.duration > 0 ? (position - word.time) / word.duration : (position >= word.time ? 1 : 0);
  return { index: index < 0 ? 0 : index, progress: Math.min(1, Math.max(0, raw)) };
}

const LyricsDisplay: React.FC<LyricsDisplayProps> = ({
  lrcContent,
  className,
  style,
  onLyricClick
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeLineRef = useRef<HTMLDivElement>(null);
  const currentWordElRef = useRef<HTMLSpanElement | null>(null);

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

  // 逐字歌词（#722）同理只在换字时重渲染：返回原生数字，未变化不打扰订阅者。
  // 返回的是「已唱到第几个词」，渲染时行首到它整段标已唱（卡拉 OK sweep）。
  const currentWordIndex = usePlaybackSelector((snapshot) => {
    const lines = parsedLyrics?.lines;
    if (!lines || lines.length === 0) return -1;
    const currentTime = typeof snapshot.position === 'number' && !isNaN(snapshot.position) ? snapshot.position : 0;
    const lineIndex = findCurrentLyricIndex(lines, currentTime);
    const words = lineIndex >= 0 ? lines[lineIndex].words : undefined;
    if (!words || words.length === 0) return -1;
    return findCurrentLyricIndex(words, currentTime);
  });

  const playing = usePlaybackPlaying();
  const activeWords = currentLineIndex >= 0 ? parsedLyrics.lines[currentLineIndex]?.words : undefined;

  // 字内连续填充（#722）：只在「播放中 + 当前行有逐字轨道」时跑 rAF，每帧只给当前词写一个
  // CSS 变量，不 setState（每帧 React 渲染会击穿行的 memo 纪律）；词边界仍由 currentWordIndex 驱动。
  useEffect(() => {
    if (!playing || !activeWords || activeWords.length === 0) return;
    let frame = 0;
    const paint = (): void => {
      const element = currentWordElRef.current;
      const fill = wordFillAt(activeWords, playbackClock.getPositionNow());
      if (element && fill) element.style.setProperty('--word-fill', `${(fill.progress * 100).toFixed(2)}%`);
      frame = requestAnimationFrame(paint);
    };
    frame = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(frame);
  }, [playing, activeWords]);

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
                {line.words && line.words.length > 0
                  ? line.words.map((word, wordIndex) => {
                      const isCurrentWord = isActive && wordIndex === currentWordIndex;
                      return (
                        <span
                          key={wordIndex}
                          ref={isCurrentWord ? currentWordElRef : null}
                          className="lyrics__word"
                          data-sung={(isActive && wordIndex <= currentWordIndex) || undefined}
                          data-current-word={isCurrentWord || undefined}
                        >
                          {word.text}
                        </span>
                      );
                    })
                  : line.text}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default React.memo(LyricsDisplay);
