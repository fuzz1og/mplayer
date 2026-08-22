import React from 'react';
import type { SourceKey } from '@mplayer/core';
import { SOURCE_COLORS } from '@/renderer/constants/sourceConfig';

const SOURCE_LABELS: Record<string, string> = {
  netease: '网易云',
  qq: 'QQ',
  kugou: '酷狗',
  kuwo: '酷我',
  qianqian: '千千',
  migu: '咪咕',
  soda: '汽水',
  local: '本地',
};

interface SourceBadgeProps {
  sourceType: string;
  style?: React.CSSProperties;
}

const SourceBadge: React.FC<SourceBadgeProps> = ({ sourceType, style }) => {
  const color = SOURCE_COLORS[sourceType as SourceKey];
  const label = SOURCE_LABELS[sourceType];
  if (!color || !label) return null;

  return (
    <span
      style={{
        fontSize: 'var(--text-2xs)',
        fontWeight: 'var(--weight-medium)',
        padding: '1px 6px',
        borderRadius: 'var(--radius-xs)',
        backgroundColor: `${color}14`,
        color,
        flexShrink: 0,
        lineHeight: '1.4',
        ...style,
      }}
    >
      {label}
    </span>
  );
};

export default React.memo(SourceBadge);
