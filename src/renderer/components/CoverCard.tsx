import React from 'react';
import { Play } from 'lucide-react';
import { COVER_SIZE } from '@mplayer/core';
import SongCover from '@/renderer/components/SongCover';
import '@/renderer/styles/cover-card.css';

interface CoverCardProps {
  /** 主标题：歌单 / 专辑 / 歌手名，单行溢出省略，悬停可见全称 */
  title: string;
  /** 副标题：来源、播放量、专辑数等，单行溢出省略 */
  subtitle?: string;
  /** 封面直链，空值由 SongCover 出占位 */
  cover?: string;
  /** 封面形状：方形（歌单 / 专辑）或圆形（歌手头像） */
  shape?: 'square' | 'circle';
  /** 封面角标（如播放量），叠在封面右上角 */
  badge?: React.ReactNode;
  /** 封面内的悬停层（如播放图标），由调用方决定语义 */
  overlay?: React.ReactNode;
  /** 卡角操作位（如删除），悬停或键盘聚焦才显形；与 badge 同位，二者不并用 */
  action?: React.ReactNode;
  /** 角落快捷播放：悬停 / 聚焦才显形；没有播放能力时不传，按钮不渲染 */
  onPlay?: () => void;
  /** 播放按钮的无障碍名（缺省「播放 {title}」） */
  onPlayLabel?: string;
  onClick?: () => void;
  /** 无障碍名称，缺省用标题 */
  ariaLabel?: string;
}

/**
 * 统一内容网格卡（#694）：歌单 / 专辑 / 歌手共用同一套「封面 + 标题 + 副标题」结构。
 * 取图统一经 SongCover（core 缩略图档位 + 失败占位 + 换 URL 重置），本组件只管布局。
 */
const CoverCard: React.FC<CoverCardProps> = ({
  title,
  subtitle,
  cover,
  shape = 'square',
  badge,
  overlay,
  action,
  onPlay,
  onPlayLabel,
  onClick,
  ariaLabel,
}) => {
  const interactive = Boolean(onClick);

  return (
    <div
      className="cover-card"
      data-shape={shape}
      data-clickable={interactive ? '' : undefined}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? ariaLabel ?? title : undefined}
      onClick={onClick}
      onKeyDown={interactive ? (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick?.();
        }
      } : undefined}
    >
      <div className="cover-card__media">
        <SongCover src={cover} alt="" variant="tinted" iconSize={28} thumbSize={COVER_SIZE.thumb} />
        {overlay}
        {onPlay && (
          <button
            type="button"
            className="cover-card__play"
            aria-label={onPlayLabel ?? `播放 ${title}`}
            title="播放"
            onClick={(event) => {
              event.stopPropagation();
              onPlay();
            }}
          >
            <Play size={16} aria-hidden="true" />
          </button>
        )}
        {badge && <span className="cover-card__badge">{badge}</span>}
        {action && (
          <span
            className="cover-card__action"
            onClick={(event) => event.stopPropagation()}
          >
            {action}
          </span>
        )}
      </div>
      <div className="cover-card__text">
        <div className="cover-card__title" title={title}>{title}</div>
        {subtitle && <div className="cover-card__meta" title={subtitle}>{subtitle}</div>}
      </div>
    </div>
  );
};

export default CoverCard;
