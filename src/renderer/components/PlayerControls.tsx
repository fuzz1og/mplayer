import React from 'react';
import { Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1 } from 'lucide-react';
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

/**
 * 播放控件（原型）：左「随机」、中「上一 / 播放 / 下一」、右「循环」。
 * 三段式播放模式仍是唯一真相（顺序=列表循环 / 单曲循环 / 随机播放），
 * 两个按钮只是把它拆成原型里的两个独立开关。
 */
const PlayerControls: React.FC<PlayerControlsProps> = React.memo(({
  isPlaying, loading = false, hasCurrentSong, playMode,
  onPlayPause, onPrev, onNext, onModeChange,
}) => {
  const shuffleOn = playMode === '随机播放';
  const repeatOne = playMode === '单曲循环';

  return (
    <div className="player-controls">
      <button
        type="button"
        onClick={() => onModeChange(shuffleOn ? '列表循环' : '随机播放')}
        aria-label="随机播放"
        aria-pressed={shuffleOn}
        className="player-btn player-controls__mode"
      >
        <Shuffle size={16} />
      </button>
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
          <span aria-hidden data-testid="player-loading" className="player-controls__spinner" />
        ) : isPlaying ? (
          <Pause size={20} fill="currentColor" />
        ) : (
          <Play size={20} fill="currentColor" className="player-controls__play-icon" />
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
      <button
        type="button"
        onClick={() => onModeChange(repeatOne ? '列表循环' : '单曲循环')}
        aria-label="单曲循环"
        aria-pressed={repeatOne}
        className="player-btn player-controls__mode"
      >
        {repeatOne ? <Repeat1 size={16} /> : <Repeat size={16} />}
      </button>
    </div>
  );
});

export default PlayerControls;
