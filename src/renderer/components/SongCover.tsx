import React, { useEffect, useState } from 'react';
import { ListMusic, Music2 } from 'lucide-react';

interface SongCoverBaseProps {
  /** 封面直链；空值直接显示占位。 */
  src?: string;
  alt?: string;
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
 * 占位 variant 按形状命名（保留各调用点既有视觉）：icon = Music2 居中；
 * tinted = --cover-placeholder 底 + ListMusic；gradient = 灰阶渐变色块；
 * none = 不渲染占位（容器自有底色透出）。
 * 从旧 CoverImage 删除后内联在各调用点的形状回收而来，不含任何解析/重试机件。
 */
const SongCover = ({
  src,
  alt = '',
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
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-tertiary)',
            ...placeholderStyle,
          }}
        >
          <Music2 size={iconSize} />
        </div>
      );
    }
    if (variant === 'tinted') {
      return (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'var(--cover-placeholder)',
            ...placeholderStyle,
          }}
        >
          <ListMusic size={iconSize} color="var(--text-tertiary)" />
        </div>
      );
    }
    if (variant === 'gradient') {
      return (
        <div
          style={{
            width: '100%',
            height: '100%',
            background: 'linear-gradient(135deg, var(--border-default) 0%, var(--border-subtle) 100%)',
            ...placeholderStyle,
          }}
        />
      );
    }
    return null;
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => {
        setFailed(true);
        onError?.();
      }}
      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', ...style }}
    />
  );
};

export default SongCover;
