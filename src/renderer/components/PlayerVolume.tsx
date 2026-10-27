import React from 'react';
import { Volume2, Volume1, VolumeX } from 'lucide-react';

interface PlayerVolumeProps {
  volume: number;
  onVolumeChange: (vol: number) => void;
  onToggleMute: () => void;
}

const PlayerVolume: React.FC<PlayerVolumeProps> = React.memo(({
  volume, onVolumeChange, onToggleMute,
}) => {
  const getVolumeIcon = () => {
    if (volume === 0) return <VolumeX size={20} />;
    if (volume < 50) return <Volume1 size={20} />;
    return <Volume2 size={20} />;
  };

  return (
    <div className="player-volume">
      <button onClick={onToggleMute} aria-label={volume === 0 ? '取消静音' : '静音'} className="player-volume__mute">
        {getVolumeIcon()}
      </button>
      <input
        type="range" min={0} max={100} value={volume}
        aria-label="音量"
        onChange={(e) => onVolumeChange(Number(e.target.value))}
        className="player-volume__slider"
        style={{ '--volume': `${volume}%` } as React.CSSProperties}
      />
    </div>
  );
});

export default PlayerVolume;
