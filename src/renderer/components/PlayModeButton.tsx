import React, { useState } from 'react';
import { Repeat, Repeat1, Shuffle, ArrowRight } from 'lucide-react';
import type { PlayMode } from '@/shared/types/player';

interface PlayModeButtonProps {
  mode: PlayMode;
  onModeChange: (mode: PlayMode) => void;
  size?: number;
}

const modeConfig: Record<PlayMode, { icon: React.ReactNode; label: string; next: PlayMode }> = {
  'sequential': {
    icon: <ArrowRight size={18} />,
    label: '顺序播放',
    next: 'list-loop'
  },
  'list-loop': {
    icon: <Repeat size={18} />,
    label: '列表循环',
    next: 'single-loop'
  },
  'single-loop': {
    icon: <Repeat1 size={18} />,
    label: '单曲循环',
    next: 'shuffle'
  },
  'shuffle': {
    icon: <Shuffle size={18} />,
    label: '随机播放',
    next: 'sequential'
  }
};

const PlayModeButton: React.FC<PlayModeButtonProps> = ({ mode, onModeChange, size = 18 }) => {
  const [showTooltip, setShowTooltip] = useState(false);
  const config = modeConfig[mode];

  const handleClick = () => {
    onModeChange(config.next);
  };

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={handleClick}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        style={{
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          padding: '6px',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-tertiary)',
          transition: 'all 0.15s ease',
        }}
        onMouseOver={(e) => {
          e.currentTarget.style.color = 'var(--text-secondary)';
          e.currentTarget.style.backgroundColor = 'var(--hover-bg)';
        }}
        onMouseOut={(e) => {
          e.currentTarget.style.color = 'var(--text-tertiary)';
          e.currentTarget.style.backgroundColor = 'transparent';
        }}
      >
        {React.cloneElement(config.icon as React.ReactElement, { size })}
      </button>

      {/* 提示框 */}
      {showTooltip && (
        <div
          style={{
            position: 'absolute',
            bottom: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            marginBottom: '8px',
            padding: '6px 10px',
            backgroundColor: 'var(--text-primary)',
            color: 'white',
            fontSize: '12px',
            borderRadius: '4px',
            whiteSpace: 'nowrap',
            zIndex: 100,
            pointerEvents: 'none',
          }}
        >
          {config.label}
          <div
            style={{
              position: 'absolute',
              top: '100%',
              left: '50%',
              transform: 'translateX(-50%)',
              width: 0,
              height: 0,
              borderLeft: '4px solid transparent',
              borderRight: '4px solid transparent',
              borderTop: '4px solid var(--text-primary)',
            }}
          />
        </div>
      )}
    </div>
  );
};

export default React.memo(PlayModeButton);
