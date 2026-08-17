import React from 'react';

interface AudioTagBadgeProps {
  tag: 'preview' | 'invalid';
}

const AudioTagBadge: React.FC<AudioTagBadgeProps> = ({ tag }) => {
  const config = tag === 'preview'
    ? { label: '试听', color: '#e67e22' }
    : { label: '不可播', color: '#e74c3c' };

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
      }}
    >
      {config.label}
    </span>
  );
};

export default AudioTagBadge;
