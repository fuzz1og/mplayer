import React from 'react';
import { Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1 } from 'lucide-react';
import type { PlayMode } from '@mplayer/core';
import '@/renderer/styles/player-bar.css';

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

/** 播放模式循环顺序：列表循环 → 随机播放 → 单曲循环 → 列表循环。 */
const PLAY_MODE_ORDER: PlayMode[] = ['列表循环', '随机播放', '单曲循环'];

const getNextPlayMode = (mode: PlayMode): PlayMode => {
  const index = PLAY_MODE_ORDER.indexOf(mode);
  return PLAY_MODE_ORDER[(index + 1) % PLAY_MODE_ORDER.length];
};

const ModeIcon: React.FC<{ mode: PlayMode }> = ({ mode }) => {
  if (mode === '随机播放') return <Shuffle size={16} />;
  if (mode === '单曲循环') return <Repeat1 size={16} />;
  return <Repeat size={16} />;
};

/**
 * 播放控件（1.9.0 收口）：上一 / 播放 / 下一，外加**一个**播放模式按钮。
 * 模式按钮按 列表循环 → 随机播放 → 单曲循环 循环；图标 Repeat / Shuffle / Repeat1。
 * 布局用 1fr auto 1fr：播放键永远落在控件行的几何中心（与窗口中心对齐）。
 */
const PlayerControls: React.FC<PlayerControlsProps> = React.memo(({
  isPlaying, loading = false, hasCurrentSong, playMode,
  onPlayPause, onPrev, onNext, onModeChange,
}) => {
  const nextMode = getNextPlayMode(playMode);

  return (
    <div className="player-controls">
      <div className="player-controls__side player-controls__side--start">
        <button
          type="button"
          onClick={() => onModeChange(nextMode)}
          aria-label={`播放模式：${playMode}`}
          title={`切换到${nextMode}`}
          className="player-btn player-controls__mode"
        >
          <ModeIcon mode={playMode} />
        </button>
        <button
          onClick={onPrev}
          disabled={!hasCurrentSong}
          aria-label="上一首"
          className="player-btn player-controls__skip"
        >
          <SkipBack size={18} fill="currentColor" />
        </button>
      </div>
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
      <div className="player-controls__side player-controls__side--end">
        <button
          onClick={onNext}
          disabled={!hasCurrentSong}
          aria-label="下一首"
          className="player-btn player-controls__skip"
        >
          <SkipForward size={18} fill="currentColor" />
        </button>
      </div>
    </div>
  );
});

export default PlayerControls;
