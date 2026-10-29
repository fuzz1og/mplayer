import React, { useEffect, useMemo, useRef } from 'react';
import { parseLRC, findCurrentLyricIndex, type LyricLine, type ParsedLyrics } from '@mplayer/core';
import {
  playbackClock,
  usePlaybackDuration,
  usePlaybackPlaying,
  usePlaybackSelector,
} from '@/renderer/services/playbackClock';
import '@/renderer/styles/songlist.css';

interface LyricsDisplayProps {
  lrcContent: string;
  className?: string;
  style?: React.CSSProperties;
  onLyricClick?: (time: number) => void;
}

/** 当前行的一个填充单元：逐字轨用词，普通 LRC 用字（时间轴按行时长线性均分） */
export interface FillUnit {
  text: string;
  time: number;
  duration: number;
}

export interface UnitFill {
  index: number;
  progress: number;
}

/** 最后一行没有下一行时间可借时的行时长：整曲剩余时长，夹在 1.5~5s */
const LAST_LINE_MIN_S = 1.5;
const LAST_LINE_MAX_S = 5;

/** 行 → 填充单元：有逐字轨就用词，没有就把正文按字符切、时间轴线性均分（用户要的「线性」） */
export function lineFillUnits(line: LyricLine, nextLineTime: number | null, songDuration: number): FillUnit[] {
  if (line.words && line.words.length > 0) {
    return line.words.map((word) => ({ text: word.text, time: word.time, duration: word.duration }));
  }
  const chars = Array.from(line.text);
  if (chars.length === 0) return [];
  const span = nextLineTime !== null && nextLineTime > line.time
    ? nextLineTime - line.time
    : Math.min(LAST_LINE_MAX_S, Math.max(LAST_LINE_MIN_S, Math.max(songDuration, line.time + LAST_LINE_MIN_S) - line.time));
  const unit = span / chars.length;
  return chars.map((char, index) => ({ text: char, time: line.time + index * unit, duration: unit }));
}

/** 单元内进度：当前单元下标 + 已唱比例（0~1，单元前/后按端点夹紧）；没有单元返回 null */
export function unitFillAt(units: FillUnit[] | undefined, position: number): UnitFill | null {
  if (!units || units.length === 0) return null;
  const index = findCurrentLyricIndex(units, position);
  const unit = units[index < 0 ? 0 : index];
  if (!unit) return { index: 0, progress: 0 };
  const raw = unit.duration > 0 ? (position - unit.time) / unit.duration : (position >= unit.time ? 1 : 0);
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
  const unitElsRef = useRef<HTMLElement[]>([]);
  const unitsRef = useRef<FillUnit[]>([]);
  const fillIndexRef = useRef(-1);
  const applyFillRef = useRef<(position: number) => void>(() => {});

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

  // 只订阅「当前行序号」：换行才重渲染整块歌词；单元下标与字内进度全在 imperative 路径里
  const currentLineIndex = usePlaybackSelector((snapshot) => {
    if (!parsedLyrics?.lines || parsedLyrics.lines.length === 0) return -1;
    const currentTime = typeof snapshot.position === 'number' && !isNaN(snapshot.position) ? snapshot.position : 0;
    return findCurrentLyricIndex(parsedLyrics.lines, currentTime);
  });

  const playing = usePlaybackPlaying();
  const songDuration = usePlaybackDuration();

  const activeUnits = useMemo(() => {
    if (currentLineIndex < 0) return [] as FillUnit[];
    const line = parsedLyrics.lines[currentLineIndex];
    if (!line) return [] as FillUnit[];
    const next = parsedLyrics.lines[currentLineIndex + 1];
    return lineFillUnits(line, next ? next.time : null, songDuration);
  }, [currentLineIndex, parsedLyrics, songDuration]);
  unitsRef.current = activeUnits;

  // 一帧一次：同一个位置同时算「第几个单元」与「单元内进度」。只在单元变化时改 data 属性，
  // 每帧只写当前单元的一个 CSS 变量，不 setState（词/字边界不再走 React）。
  applyFillRef.current = (position: number) => {
    const units = unitsRef.current;
    const els = unitElsRef.current;
    if (units.length === 0 || els.length === 0) return;
    const fill = unitFillAt(units, position);
    if (!fill) return;
    if (fill.index !== fillIndexRef.current) {
      for (let i = 0; i < els.length; i++) {
        const element = els[i];
        if (!element) continue;
        if (i < fill.index) {
          element.setAttribute('data-sung', '');
          element.removeAttribute('data-current');
        } else if (i === fill.index) {
          element.setAttribute('data-sung', '');
          element.setAttribute('data-current', '');
        } else {
          element.removeAttribute('data-sung');
          element.removeAttribute('data-current');
        }
      }
      fillIndexRef.current = fill.index;
    }
    const current = els[fill.index];
    if (current) current.style.setProperty('--fill', `${(fill.progress * 100).toFixed(2)}%`);
  };

  // 换行 / 换曲 / 播放态变化：重新绑定单元元素并同步画一帧（暂停、刚打开也有正确填充）
  useEffect(() => {
    const line = activeLineRef.current;
    unitElsRef.current = line ? Array.from(line.querySelectorAll<HTMLElement>('.lyrics__unit')) : [];
    fillIndexRef.current = -1;
    applyFillRef.current(playbackClock.getPositionNow());
  }, [currentLineIndex, activeUnits, playing]);

  // 播放中每帧填充：位置直读传输层（getPositionNow），与单元下标同一个读数
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const paint = (): void => {
      applyFillRef.current(playbackClock.getPositionNow());
      frame = requestAnimationFrame(paint);
    };
    frame = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  // 暂停中的 seek / 切歌：订阅快照（不引起 React 渲染）后同步重画一次
  useEffect(() => playbackClock.subscribe(() => {
    if (!playbackClock.isPlaying()) applyFillRef.current(playbackClock.getPositionNow());
  }), []);

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
          const units = isActive ? activeUnits : null;

          return (
            <div
              key={index}
              ref={isActive ? activeLineRef : null}
              onClick={() => onLyricClick?.(line.time)}
              className="lyrics__line"
              data-active={isActive || undefined}
            >
              <span className="lyrics__text">
                {units && units.length > 0
                  ? units.map((unit, unitIndex) => (
                      <span key={unitIndex} className="lyrics__unit">
                        {unit.text}
                      </span>
                    ))
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
