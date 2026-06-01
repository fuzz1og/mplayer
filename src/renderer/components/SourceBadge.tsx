import React from 'react';

const SOURCE_CONFIG: Record<string, { label: string; color: string }> = {
  netease: { label: '网易云', color: '#FF6B6B' },
  qq: { label: 'QQ', color: '#49B8FF' },
  kugou: { label: '酷狗', color: '#FF8C00' },
  migu: { label: '咪咕', color: '#C20C0C' },
  kuwo: { label: '酷我', color: '#FF6F00' },
  qianqian: { label: '千千', color: '#00A1D6' },
  soda: { label: '汽水', color: '#1E90FF' },
  local: { label: '本地', color: '#00B894' },
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
        fontSize: '10px',
        padding: '2px 5px',
        borderRadius: '3px',
        backgroundColor: config.color,
        color: 'white',
        flexShrink: 0,
        ...style,
      }}
    >
      {config.label}
    </span>
  );
};

export default React.memo(SourceBadge);
