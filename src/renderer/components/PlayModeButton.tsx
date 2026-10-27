import React, { useState } from 'react';
import { Repeat, Repeat1, Shuffle } from 'lucide-react';
import type { PlayMode } from '@mplayer/core';

interface PlayModeButtonProps {
  mode: PlayMode;
  onModeChange: (mode: PlayMode) => void;
  size?: number;
}

const modeConfig: Record<PlayMode, { icon: React.ReactNode; label: string; next: PlayMode }> = {
  '单曲循环': {
    icon: <Repeat1 size={18} />,
    label: '单曲循环',
    next: '列表循环'
  },
  '列表循环': {
    icon: <Repeat size={18} />,
    label: '列表循环',
    next: '随机播放'
  },
  '随机播放': {
    icon: <Shuffle size={18} />,
    label: '随机播放',
    next: '单曲循环'
  }
};

const PlayModeButton: React.FC<PlayModeButtonProps> = ({ mode, onModeChange, size = 18 }) => {
  const [showTooltip, setShowTooltip] = useState(false);
  const config = modeConfig[mode];

  const handleClick = () => {
    onModeChange(config.next);
  };

  return (
    <div className="play-mode">
      {/* hover 表现（颜色 + 底色）已移到 .play-mode__trigger:hover，不再用 onMouseOver 改内联样式 */}
      <button
        onClick={handleClick}
        aria-label={`播放模式: ${config.label}`}
        aria-expanded={showTooltip}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        className="play-mode__trigger"
      >
        {React.cloneElement(config.icon as React.ReactElement<{ size?: number }>, { size })}
      </button>

      {/* 提示框 */}
      {showTooltip && (
        <div className="play-mode__tooltip">
          {config.label}
          <div className="play-mode__tooltip-arrow" />
        </div>
      )}
    </div>
  );
};

export default React.memo(PlayModeButton);
