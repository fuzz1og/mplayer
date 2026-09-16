import React, { useState, useRef, useCallback } from 'react';
import { usePlaybackDuration, usePlaybackPosition } from '@/renderer/services/playbackClock';

interface PlayerProgressProps {
  hasCurrentSong: boolean;
  onSeek: (pos: number) => void;
}

const formatTime = (seconds: number): string => {
  if (!seconds || isNaN(seconds)) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

/**
 * 播放进度块：位置的唯一消费者在叶子这一层——position/duration 由
 * playbackClock 直接订阅，PlayerBar 不再随每 250ms 的采样重渲染。
 *
 * 交互：
 * - 点击 / 键盘沿用「百分比 × 时长」seek；
 * - **按住拖动**期间在本地持有 dragPosition 立即跟手（不等 250ms 时钟采样），
 *   松手才提交 onSeek；拖拽期间关掉填充条的 width transition，避免「越拖越滞后」；
 * - 提交后由 playbackClock 的 seek 乐观值兜住 HTML5 media 的异步 seek
 *   （见该模块注释），所以松手不会看到位置回跳。
 */
const PlayerProgress: React.FC<PlayerProgressProps> = React.memo(({
  hasCurrentSong, onSeek,
}) => {
  const position = usePlaybackPosition();
  const duration = usePlaybackDuration();
  const [isHovered, setIsHovered] = useState(false);
  const [dragPosition, setDragPosition] = useState<number | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const dragPositionRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);

  const dragging = dragPosition !== null;
  const shownPosition = dragPosition ?? position;
  const progress = duration > 0 ? (shownPosition / duration) * 100 : 0;

  /** 视口 X → 目标位置（秒）；轨道尺寸不可用（未挂载/宽度为 0）时返回 null */
  const seekTargetFromClientX = useCallback((clientX: number): number | null => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || !rect.width) return null;
    const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return percent * duration;
  }, [duration]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // pointerup 已经提交过 seek：浏览器随后补发的 click 不再重复 seek 一次
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (!hasCurrentSong) return;
    const target = seekTargetFromClientX(e.clientX);
    if (target !== null) onSeek(target);
  }, [hasCurrentSong, onSeek, seekTargetFromClientX]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!hasCurrentSong || duration <= 0) return;
    if (e.button !== 0) return; // 只接管主键（触摸/笔的 button 也是 0）
    suppressClickRef.current = false;
    e.preventDefault(); // 拖动时不要顺带选中文本
    try {
      e.currentTarget.setPointerCapture(e.pointerId); // 指针移出轨道也能继续拖
    } catch { /* jsdom / 内核不支持：退化为只在轨道内拖动 */ }
    const target = seekTargetFromClientX(e.clientX) ?? 0;
    draggingRef.current = true;
    dragPositionRef.current = target;
    setDragPosition(target); // 按下即跟手，不等下一次时钟采样
  }, [hasCurrentSong, duration, seekTargetFromClientX]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const target = seekTargetFromClientX(e.clientX);
    if (target === null) return;
    dragPositionRef.current = target;
    setDragPosition(target);
  }, [seekTargetFromClientX]);

  const endDrag = useCallback((commit: boolean, clientX?: number): void => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    const target = dragPositionRef.current ?? (clientX === undefined ? null : seekTargetFromClientX(clientX));
    dragPositionRef.current = null;
    setDragPosition(null);
    if (commit && target !== null) {
      suppressClickRef.current = true; // 抑制 pointerup 之后补发的 click
      onSeek(target);
    }
  }, [onSeek, seekTargetFromClientX]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    try {
      if (typeof el.hasPointerCapture === 'function' && el.hasPointerCapture(e.pointerId)) {
        el.releasePointerCapture(e.pointerId);
      }
    } catch { /* 忽略：未成功捕获过 */ }
    endDrag(true, e.clientX);
  }, [endDrag]);

  const handlePointerCancel = useCallback(() => {
    endDrag(false); // 取消不提交，回到时钟位置
  }, [endDrag]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!hasCurrentSong) return;
    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        onSeek(Math.min(position + 5, duration));
        break;
      case 'ArrowLeft':
        e.preventDefault();
        onSeek(Math.max(position - 5, 0));
        break;
      case 'Home':
        e.preventDefault();
        onSeek(0);
        break;
      case 'End':
        e.preventDefault();
        onSeek(Math.max(0, duration - 1));
        break;
    }
  }, [hasCurrentSong, position, duration, onSeek]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', width: '100%' }}>
      <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', minWidth: '36px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        {formatTime(shownPosition)}
      </span>
      <div
        ref={trackRef}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        tabIndex={hasCurrentSong ? 0 : -1}
        style={{
          flex: 1,
          height: isHovered || dragging ? '20px' : '16px',
          display: 'flex',
          alignItems: 'center',
          cursor: hasCurrentSong ? (dragging ? 'grabbing' : 'pointer') : 'not-allowed',
          position: 'relative',
          outline: 'none',
          userSelect: 'none',
          touchAction: 'none',
        }}
        role="slider"
        aria-label="播放进度"
        aria-valuemin={0}
        aria-valuemax={duration || 100}
        aria-valuenow={shownPosition}
        aria-disabled={!hasCurrentSong}
      >
        {/* Track background */}
        <div
          style={{
            width: '100%',
            height: isHovered || dragging ? '6px' : '4px',
            backgroundColor: 'var(--border-default)',
            borderRadius: '2px',
            overflow: 'hidden',
            transition: 'height 150ms ease',
          }}
        >
          {/* Filled portion */}
          <div
            style={{
              width: `${progress}%`,
              height: '100%',
              backgroundColor: 'var(--accent)',
              borderRadius: '2px',
              // 拖动中跟手优先：transition 会让填充条落后于指针
              transition: dragging ? 'none' : 'width 100ms linear',
            }}
          />
        </div>
        {/* Thumb (hover / dragging) */}
        {(isHovered || dragging) && hasCurrentSong && (
          <div
            style={{
              position: 'absolute',
              left: `calc(${progress}% - 5px)`,
              top: '50%',
              transform: 'translateY(-50%)',
              width: '10px',
              height: '10px',
              backgroundColor: 'var(--accent)',
              borderRadius: '50%',
              boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
              pointerEvents: 'none',
            }}
          />
        )}
      </div>
      <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', minWidth: '36px', fontVariantNumeric: 'tabular-nums' }}>
        {formatTime(duration)}
      </span>
    </div>
  );
});

export default PlayerProgress;
