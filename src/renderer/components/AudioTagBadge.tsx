import React from 'react';

interface AudioTagBadgeProps {
  tag: 'preview' | 'invalid';
}

const AudioTagBadge: React.FC<AudioTagBadgeProps> = ({ tag }) => {
  const config = tag === 'preview'
    ? { label: '试听', color: 'var(--warning)' }
    : { label: '不可播', color: 'var(--danger)' };

  return (
    <span
      style={{
        fontSize: 'var(--text-2xs)',
        fontWeight: 'var(--weight-medium)',
        padding: '1px 6px',
        borderRadius: 'var(--radius-xs)',
        backgroundColor: `color-mix(in srgb, ${config.color} 12%, transparent)`,
        color: config.color,
        flexShrink: 0,
        lineHeight: '1.4',
      }}
    >
      {config.label}
    </span>
  );
};

export default AudioTagBadge;
