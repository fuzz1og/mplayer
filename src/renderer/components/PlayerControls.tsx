import React from 'react';
import { Play, Pause, SkipBack, SkipForward } from 'lucide-react';
import PlayModeButton from './PlayModeButton';
import type { PlayMode } from '@mplayer/core';

interface PlayerControlsProps {
  isPlaying: boolean;
  /** #387：解析/加载中（对齐移动端 preparing）——播放键位置显示 spinner。 */
  loading?: boolean;
  hasCurrentSong: boolean;
  playMode: PlayMode;
  onPlayPause: () => void;
  onPrev: () => void;
  onNext: () => void;
  onModeChange: (mode: PlayMode) => void;
}

const PlayerControls: React.FC<PlayerControlsProps> = React.memo(({
  isPlaying, loading = false, hasCurrentSong, playMode,
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
      aria-label={loading ? '加载中' : isPlaying ? '暂停' : '播放'}
      style={{
        border: 'none',
        background: hasCurrentSong ? 'var(--accent)' : 'var(--gray-300)',
        cursor: hasCurrentSong ? 'pointer' : 'not-allowed',
        padding: '11px',
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
      {loading ? (
        // #387：等待反馈——冷启 P50 约 1s 期间界面此前完全静止（移动端已有 preparing spinner）。
        // 用全局 @keyframes spin（styles 里已定义），不引入新依赖。
        <span
          aria-hidden
          data-testid="player-loading"
          style={{
            display: 'inline-block',
            width: '18px',
            height: '18px',
            borderRadius: 'var(--radius-full)',
            border: '2px solid var(--border-subtle)',
            borderTopColor: 'var(--text-inverse)',
            animation: 'spin 0.8s linear infinite',
          }}
        />
      ) : isPlaying ? (
        <Pause size={20} fill="white" />
      ) : (
        <Play size={20} fill="white" style={{ marginLeft: '2px' }} />
      )}
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
