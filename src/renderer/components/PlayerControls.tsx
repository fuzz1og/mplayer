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
  <div className="player-controls">
    <PlayModeButton mode={playMode} onModeChange={onModeChange} size={16} />
    <button
      onClick={onPrev}
      disabled={!hasCurrentSong}
      aria-label="上一首"
      className="player-btn player-controls__skip"
    >
      <SkipBack size={18} fill="currentColor" />
    </button>
    <button
      onClick={onPlayPause}
      disabled={!hasCurrentSong}
      aria-label={loading ? '加载中' : isPlaying ? '暂停' : '播放'}
      className="player-controls__play"
    >
      {loading ? (
        // #387：等待反馈——冷启 P50 约 1s 期间界面此前完全静止（移动端已有 preparing spinner）。
        // 用全局 @keyframes spin（styles 里已定义），不引入新依赖。
        <span
          aria-hidden
          data-testid="player-loading"
          className="player-controls__spinner"
        />
      ) : isPlaying ? (
        <Pause size={20} fill="white" />
      ) : (
        <Play size={20} fill="white" className="player-controls__play-icon" />
      )}
    </button>
    <button
      onClick={onNext}
      disabled={!hasCurrentSong}
      aria-label="下一首"
      className="player-btn player-controls__skip"
    >
      <SkipForward size={18} fill="currentColor" />
    </button>
  </div>
));

export default PlayerControls;
