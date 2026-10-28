import React from 'react';
import { Volume2, Volume1, VolumeX } from 'lucide-react';
import '@/renderer/styles/player-bar.css';

interface PlayerVolumeProps {
  volume: number;
  onVolumeChange: (vol: number) => void;
  onToggleMute: () => void;
}

/**
 * 音量（1.9.0 收口）：默认只露图标，hover / focus-within 才弹出滑杆。
 * 静音点击保留；滑杆始终留在 DOM 里，Tab 能聚焦到它（焦点进入即 focus-within 展开）。
 */
const PlayerVolume: React.FC<PlayerVolumeProps> = React.memo(({
  volume, onVolumeChange, onToggleMute,
}) => {
  const getVolumeIcon = () => {
    if (volume === 0) return <VolumeX size={16} />;
    if (volume < 50) return <Volume1 size={16} />;
    return <Volume2 size={16} />;
  };

  return (
    <div className="player-volume">
      <button type="button" onClick={onToggleMute} aria-label={volume === 0 ? '取消静音' : '静音'} className="player-volume__mute">
        {getVolumeIcon()}
      </button>
      <div className="player-volume__popover">
        <input
          type="range" min={0} max={100} value={volume}
          aria-label="音量"
          onChange={(e) => onVolumeChange(Number(e.target.value))}
          className="player-volume__slider"
          style={{ '--volume': `${volume}%` } as React.CSSProperties}
        />
      </div>
    </div>
  );
});

export default PlayerVolume;
