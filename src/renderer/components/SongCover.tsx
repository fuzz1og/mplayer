import React, { useEffect, useState } from 'react';
import { COVER_SIZE, coverThumbUrl } from '@mplayer/core';
import { ListMusic, Music2 } from 'lucide-react';

interface SongCoverBaseProps {
  /** 封面直链；空值直接显示占位。 */
  src?: string;
  alt?: string;
  /** CDN 缩略图档位（默认 icon；大图卡片传 `COVER_SIZE.thumb`/`hero`） */
  thumbSize?: number;
  /** 加载失败回调（搜索式刷新等后续动作由调用方决定，本组件无解析/无缓存语义）。 */
  onError?: () => void;
  /** 透传到 img（如绝对定位于容器）。 */
  style?: React.CSSProperties;
  /** 透传到占位元素（variant 基础样式之上，用于特殊布局定位）。 */
  placeholderStyle?: React.CSSProperties;
}

type SongCoverProps = SongCoverBaseProps &
  (
    | { variant: 'icon' | 'tinted'; iconSize: number }
    | { variant: 'gradient' | 'none'; iconSize?: never }
  );

/**
 * 封面直链直渲的纯展示形状（#286）：失败态 + 封面变化重置 + 占位。
 * 占位 variant 按形状命名（保留各调用点既有视觉）：icon = Music2 居中；tinted = --cover-placeholder
 * 底 + ListMusic；gradient = 灰阶渐变色块；none = 不渲染占位（容器自有底色透出）。
 */
const SongCover = ({
  src,
  alt = '',
  thumbSize = COVER_SIZE.icon,
  variant,
  iconSize,
  onError,
  style,
  placeholderStyle,
}: SongCoverProps) => {
  const [failed, setFailed] = useState(false);

  // 封面刷新换新 URL 后重置失败态，否则新封面永远不会显示
  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) {
    if (variant === 'icon') {
      return (
        <div className="cover-fill cover-fill--icon" style={placeholderStyle}>
          <Music2 size={iconSize} />
        </div>
      );
    }
    if (variant === 'tinted') {
      return (
        <div className="cover-abs cover-abs--tinted" style={placeholderStyle}>
          <ListMusic size={iconSize} color="var(--text-tertiary)" />
        </div>
      );
    }
    if (variant === 'gradient') {
      return (
        <div className="cover-gradient" style={placeholderStyle} />
      );
    }
    return null;
  }

  return (
    <img
      src={coverThumbUrl(src, thumbSize)}
      alt={alt}
      loading="lazy"
      onError={() => {
        setFailed(true);
        onError?.();
      }}
      className="cover-img"
      style={style}
    />
  );
};

export default SongCover;
