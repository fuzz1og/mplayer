import React, { useState } from 'react';
import { Play, Trash2 } from 'lucide-react';

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

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete?.();
  };

  return (
    <div
      style={{
        width: `${width}px`,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'transform 0.2s ease',
      }}
      onClick={onClick}
      onMouseEnter={(e) => {
        setIsHovered(true);
        e.currentTarget.style.transform = 'translateY(-4px)';
      }}
      onMouseLeave={(e) => {
        setIsHovered(false);
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      {/* 封面区域 */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: `${imgHeight}px`,
          borderRadius: '8px',
          overflow: 'hidden',
          backgroundColor: 'var(--hover-bg)',
          boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
        }}
      >
        {cover ? (
          <img
            src={cover}
            alt={title}
            loading="lazy"
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
            }}
          />
        ) : (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'linear-gradient(135deg, var(--border-color) 0%, var(--hover-bg) 100%)',
            }}
          >
            <div
              style={{
                width: '40%',
                height: '40%',
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #D0D0D0 0%, #E0E0E0 100%)',
              }}
            />
          </div>
        )}

        {/* 播放按钮覆盖层 */}
        {onPlay && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backgroundColor: 'rgba(0,0,0,0.4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: 0,
              transition: 'opacity 0.2s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.opacity = '1';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.opacity = '0';
            }}
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                onPlay();
              }}
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '50%',
                backgroundColor: 'rgba(255,255,255,0.95)',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
                transition: 'transform 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'scale(1.1)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
              }}
            >
              <Play size={20} color="var(--primary-color)" fill="var(--primary-color)" />
            </button>
          </div>
        )}

        {/* 删除按钮 */}
        {onDelete && (
          <button
            onClick={handleDelete}
            style={{
              position: 'absolute',
              top: '8px',
              right: '8px',
              width: '28px',
              height: '28px',
              borderRadius: '50%',
              backgroundColor: 'rgba(0,0,0,0.5)',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: isHovered ? 1 : 0,
              transition: 'opacity 0.2s ease',
            }}
          >
            <Trash2 size={14} color="white" />
          </button>
        )}
      </div>

      {/* 文字信息 */}
      <div style={{ marginTop: '10px' }}>
        <div
          style={{
            fontSize: '14px',
            fontWeight: 500,
            color: 'var(--text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {title}
        </div>
        {subtitle && (
          <div
            style={{
              fontSize: '12px',
              color: 'var(--text-secondary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              marginTop: '4px',
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
