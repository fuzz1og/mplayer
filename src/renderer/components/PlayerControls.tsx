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
  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
    <PlayModeButton mode={playMode} onModeChange={onModeChange} size={16} />
    <button
      onClick={onPrev}
      disabled={!hasCurrentSong}
      aria-label="上一首"
      className="player-btn"
      style={{ color: hasCurrentSong ? 'var(--text-secondary)' : 'var(--text-disabled)' }}
    >
      <SkipBack size={18} fill="currentColor" />
    </button>
    <button
      onClick={onPlayPause}
      disabled={!hasCurrentSong}
      aria-label={isPlaying ? '暂停' : '播放'}
      style={{
        border: 'none',
        background: hasCurrentSong ? 'var(--accent)' : 'var(--gray-300)',
        cursor: hasCurrentSong ? 'pointer' : 'not-allowed',
        padding: 'var(--space-3)',
        borderRadius: 'var(--radius-full)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text-inverse)',
        boxShadow: hasCurrentSong ? 'var(--shadow-md)' : 'none',
        transition: 'all var(--duration-fast) var(--ease-out)',
        opacity: hasCurrentSong ? 1 : 0.5,
      }}
    >
      {isPlaying ? <Pause size={20} fill="white" /> : <Play size={20} fill="white" style={{ marginLeft: '2px' }} />}
    </button>
    <button
      onClick={onNext}
      disabled={!hasCurrentSong}
      aria-label="下一首"
      className="player-btn"
      style={{ color: hasCurrentSong ? 'var(--text-secondary)' : 'var(--text-disabled)' }}
    >
      <SkipForward size={18} fill="currentColor" />
    </button>
  </div>
));

export default PlayerControls;
