import React, { useState } from 'react';
import { Play, Trash2 } from 'lucide-react';
import SongCover from '@/renderer/components/SongCover';
import '@/renderer/styles/songlist.css';

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

  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      className="mcard"
      data-size={size}
      data-clickable={onClick ? '' : undefined}
      data-hovered={isHovered ? '' : undefined}
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
    >
      {/* 封面区域 */}
      <div className="mcard__cover">
        {/* 封面：无封面/加载失败显示占位（#286 形状回收）；占位与 img 互斥渲染，img 无需叠层定位 */}
        <SongCover src={cover} alt={title} variant="tinted" iconSize={34} />

        {/* 播放按钮覆盖层 */}
        {onPlay && (
          <div className="play-overlay mcard__play-overlay">
            <button
              onClick={(e) => { e.stopPropagation(); onPlay(); }}
              aria-label="播放"
              className="mcard__play-btn"
            >
              <Play size={18} color="var(--text-primary)" fill="var(--text-primary)" />
            </button>
          </div>
        )}

        {/* 删除按钮 */}
        {onDelete && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            aria-label="删除"
            className="mcard__delete"
          >
            <Trash2 size={13} color="white" />
          </button>
        )}
      </div>

      {/* 文字信息 */}
      <div className="mcard__text">
        <div className="mcard__title">{title}</div>
        {subtitle && (
          <div className="mcard__subtitle">{subtitle}</div>
        )}
      </div>
    </div>
  );
};

export default React.memo(MusicCard);
