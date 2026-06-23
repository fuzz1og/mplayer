import React, { useState, useRef, useCallback } from 'react';

interface PlayerProgressProps {
  position: number;
  duration: number;
  hasCurrentSong: boolean;
  onSeek: (pos: number) => void;
}

const formatTime = (seconds: number): string => {
  if (!seconds || isNaN(seconds)) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

const PlayerProgress: React.FC<PlayerProgressProps> = React.memo(({
  position, duration, hasCurrentSong, onSeek,
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);

  const progress = duration > 0 ? (position / duration) * 100 : 0;

  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!hasCurrentSong || !trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percent = Math.max(0, Math.min(1, x / rect.width));
    onSeek(percent * duration);
  }, [hasCurrentSong, duration, onSeek]);

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
        {formatTime(position)}
      </span>
      <div
        ref={trackRef}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        tabIndex={hasCurrentSong ? 0 : -1}
        style={{
          flex: 1,
          height: isHovered ? '20px' : '16px',
          display: 'flex',
          alignItems: 'center',
          cursor: hasCurrentSong ? 'pointer' : 'not-allowed',
          position: 'relative',
          outline: 'none',
        }}
        role="slider"
        aria-label="播放进度"
        aria-valuemin={0}
        aria-valuemax={duration || 100}
        aria-valuenow={position}
        aria-disabled={!hasCurrentSong}
      >
        {/* Track background */}
        <div
          style={{
            width: '100%',
            height: isHovered ? '6px' : '4px',
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
              transition: 'width 100ms linear',
            }}
          />
        </div>
        {/* Thumb (visible on hover) */}
        {isHovered && hasCurrentSong && (
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
