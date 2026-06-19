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
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: '80px', maxWidth: '140px', justifyContent: 'flex-end' }}>
      <button onClick={onToggleMute} aria-label={volume === 0 ? '取消静音' : '静音'}
        style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '6px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>
        {getVolumeIcon()}
      </button>
      <input
        type="range" min={0} max={100} value={volume}
        aria-label="音量"
        onChange={(e) => onVolumeChange(Number(e.target.value))}
        style={{
          width: '80px', height: '4px', WebkitAppearance: 'none', appearance: 'none',
          background: `linear-gradient(to right, var(--text-secondary) ${volume}%, var(--border-color) ${volume}%)`,
          borderRadius: '2px', outline: 'none', cursor: 'pointer',
        }}
      />
    </div>
  );
});

export default PlayerVolume;
