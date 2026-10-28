import React from 'react';
import '@/renderer/styles/songlist.css';
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
      className="badge"
      style={{ '--badge-color': color, ...style } as React.CSSProperties}
    >
      {label}
    </span>
  );
};

export default React.memo(SourceBadge);
