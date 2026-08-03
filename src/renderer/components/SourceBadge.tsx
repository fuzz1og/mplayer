import React from 'react';

const SOURCE_CONFIG: Record<string, { label: string; color: string }> = {
  netease: { label: '网易云', color: '#E74C3C' },
  qq: { label: 'QQ', color: '#1DB954' },
  kugou: { label: '酷狗', color: '#FF8C00' },
  kuwo: { label: '酷我', color: '#FF6F00' },
  qianqian: { label: '千千', color: '#00A1D6' },
  soda: { label: '汽水', color: '#1E90FF' },
  local: { label: '本地', color: '#10B981' },
};

interface SourceBadgeProps {
  sourceType: string;
  style?: React.CSSProperties;
}

const SourceBadge: React.FC<SourceBadgeProps> = ({ sourceType, style }) => {
  const config = SOURCE_CONFIG[sourceType];
  if (!config) return null;

  return (
    <span
      style={{
        fontSize: 'var(--text-2xs)',
        fontWeight: 'var(--weight-medium)',
        padding: '1px 6px',
        borderRadius: 'var(--radius-xs)',
        backgroundColor: `${config.color}14`,
        color: config.color,
        flexShrink: 0,
        lineHeight: '1.4',
        ...style,
      }}
    >
      {config.label}
    </span>
  );
};

export default React.memo(SourceBadge);
