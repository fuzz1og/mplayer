import React, { useState } from 'react';
import { Play, Trash2 } from 'lucide-react';
import { useButtonHover } from '@/renderer/hooks/useButtonHover';
import SongCover from '@/renderer/components/SongCover';

interface MusicCardProps {
  title: string;
  subtitle?: string;
  cover?: string;
  onClick?: () => void;
  onPlay?: () => void;
  onDelete?: () => void;
  size?: 'small' | 'medium' | 'large';
}

const MusicCard: React.FC<MusicCardProps> = ({
  title,
  subtitle,
  cover,
  onClick,
  onPlay,
  onDelete,
  size = 'medium'
}) => {
  const sizeMap = {
    small: { width: 140, imgHeight: 140 },
    medium: { width: 180, imgHeight: 180 },
    large: { width: 220, imgHeight: 220 }
  };

  const { width, imgHeight } = sizeMap[size];
  const [isHovered, setIsHovered] = useState(false);
  const deleteHoverProps = useButtonHover({ hoverBg: 'rgba(220,38,38,0.8)', leaveBg: 'rgba(0,0,0,0.5)' });

  return (
    <div
      style={{
        width: `${width}px`,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'transform var(--duration-normal) var(--ease-out)',
        transform: isHovered ? 'translateY(-3px)' : 'translateY(0)',
      }}
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
    >
      {/* 封面区域 */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: `${imgHeight}px`,
          borderRadius: 'var(--radius-md)',
          overflow: 'hidden',
          backgroundColor: 'var(--skeleton-base)',
          boxShadow: isHovered ? 'var(--shadow-lg)' : 'var(--shadow-sm)',
          transition: 'box-shadow var(--duration-normal) var(--ease-out)',
        }}
      >
        {/* 封面：无封面/加载失败显示占位（#286 形状回收）；占位与 img 互斥渲染，img 无需叠层定位 */}
        <SongCover src={cover} alt={title} variant="music" iconSize={34} />

        {/* 播放按钮覆盖层 */}
        {onPlay && (
          <div
            className="play-overlay"
            style={{ opacity: isHovered ? 1 : 0 }}
          >
            <button
              onClick={(e) => { e.stopPropagation(); onPlay(); }}
              aria-label="播放"
              style={{
                width: '44px',
                height: '44px',
                borderRadius: 'var(--radius-full)',
                backgroundColor: 'var(--bg-surface)',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: 'var(--shadow-lg)',
                transition: 'transform var(--duration-fast) var(--ease-out)',
                transform: isHovered ? 'scale(1.08)' : 'scale(1)',
              }}
            >
              <Play size={18} color="var(--text-primary)" fill="var(--text-primary)" style={{ marginLeft: '2px' }} />
            </button>
          </div>
        )}

        {/* 删除按钮 */}
        {onDelete && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            aria-label="删除"
            style={{
              position: 'absolute',
              top: 'var(--space-2)',
              right: 'var(--space-2)',
              width: '28px',
              height: '28px',
              borderRadius: 'var(--radius-full)',
              backgroundColor: 'rgba(0,0,0,0.5)',
              backdropFilter: 'blur(4px)',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background var(--duration-fast)',
            }}
            onMouseEnter={deleteHoverProps.handleMouseEnter}
            onMouseLeave={deleteHoverProps.handleMouseLeave}
          >
            <Trash2 size={13} color="white" />
          </button>
        )}
      </div>

      {/* 文字信息 */}
      <div style={{ marginTop: 'var(--space-2)', padding: '0 var(--space-1)' }}>
        <div
          style={{
            fontSize: 'var(--text-sm)',
            fontWeight: 'var(--weight-medium)',
            color: 'var(--text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            lineHeight: 'var(--leading-tight)',
          }}
        >
          {title}
        </div>
        {subtitle && (
          <div
            style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--text-tertiary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              marginTop: '2px',
            }}
          >
            {subtitle}
          </div>
        )}
      </div>
    </div>
  );
};

export default React.memo(MusicCard);
