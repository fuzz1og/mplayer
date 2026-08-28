import React, { useEffect, useState } from 'react';
import { ListMusic, Play, Trash2 } from 'lucide-react';
import { useButtonHover } from '@/renderer/hooks/useButtonHover';

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
  // 封面直链直渲：加载失败由占位层兜底（封面链已删，#273）
  const [coverFailed, setCoverFailed] = useState(false);
  const deleteHoverProps = useButtonHover({ hoverBg: 'rgba(220,38,38,0.8)', leaveBg: 'rgba(0,0,0,0.5)' });

  // 封面变化后重置失败态，否则新封面永远不会显示
  useEffect(() => {
    setCoverFailed(false);
  }, [cover]);

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
        {/* 占位层（无封面/加载失败时显示），img 成功后覆盖其上 */}
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--cover-placeholder)' }}>
          <ListMusic size={34} color="var(--text-tertiary)" />
        </div>
        {cover && !coverFailed && (
          <img
            key={cover}
            src={cover}
            alt={title}
            loading="lazy"
            onError={() => setCoverFailed(true)}
            style={{ position: 'relative', width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        )}

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
