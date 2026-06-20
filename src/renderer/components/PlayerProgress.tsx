import React from 'react';

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
}) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', width: '100%' }}>
    <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', minWidth: '36px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
      {formatTime(position)}
    </span>
    <input
      type="range" min={0} max={duration || 100} value={position}
      aria-label="播放进度"
      aria-valuemin={0}
      aria-valuemax={duration || 100}
      aria-valuenow={position}
      onChange={(e) => onSeek(Number(e.target.value))}
      disabled={!hasCurrentSong}
      style={{
        flex: 1, height: '4px', WebkitAppearance: 'none', appearance: 'none',
        background: `linear-gradient(to right, var(--accent-color) ${(position / (duration || 1)) * 100}%, var(--border-color) ${(position / (duration || 1)) * 100}%)`,
        borderRadius: '2px', outline: 'none', cursor: hasCurrentSong ? 'pointer' : 'not-allowed',
      }}
    />
    <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', minWidth: '36px', fontVariantNumeric: 'tabular-nums' }}>
      {formatTime(duration)}
    </span>
  </div>
));

export default PlayerProgress;
