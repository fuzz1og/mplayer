import React from 'react';
import { Play, Pause, SkipBack, SkipForward } from 'lucide-react';
import PlayModeButton from './PlayModeButton';
import type { PlayMode } from '@/shared/types/player';

interface PlayerControlsProps {
  isPlaying: boolean;
  hasCurrentSong: boolean;
  playMode: PlayMode;
  onPlayPause: () => void;
  onPrev: () => void;
  onNext: () => void;
  onModeChange: (mode: PlayMode) => void;
}

const PlayerControls: React.FC<PlayerControlsProps> = React.memo(({
  isPlaying, hasCurrentSong, playMode,
  onPlayPause, onPrev, onNext, onModeChange,
}) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
    <PlayModeButton mode={playMode} onModeChange={onModeChange} size={18} />
    <button onClick={onPrev} disabled={!hasCurrentSong} aria-label="上一首"
      style={{ border: 'none', background: 'transparent', cursor: hasCurrentSong ? 'pointer' : 'not-allowed', padding: '8px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: hasCurrentSong ? 'var(--text-primary)' : 'var(--text-tertiary)', opacity: hasCurrentSong ? 1 : 0.5 }}>
      <SkipBack size={22} fill="currentColor" />
    </button>
    <button onClick={onPlayPause} disabled={!hasCurrentSong} aria-label={isPlaying ? '暂停' : '播放'}
      style={{ border: 'none', background: 'var(--primary-color)', cursor: hasCurrentSong ? 'pointer' : 'not-allowed', padding: '12px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', boxShadow: '0 2px 8px rgba(45, 52, 54, 0.3)', opacity: hasCurrentSong ? 1 : 0.5 }}>
      {isPlaying ? <Pause size={24} fill="white" /> : <Play size={24} fill="white" style={{ marginLeft: '2px' }} />}
    </button>
    <button onClick={onNext} disabled={!hasCurrentSong} aria-label="下一首"
      style={{ border: 'none', background: 'transparent', cursor: hasCurrentSong ? 'pointer' : 'not-allowed', padding: '8px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: hasCurrentSong ? 'var(--text-primary)' : 'var(--text-tertiary)', opacity: hasCurrentSong ? 1 : 0.5 }}>
      <SkipForward size={22} fill="currentColor" />
    </button>
  </div>
));

export default PlayerControls;
