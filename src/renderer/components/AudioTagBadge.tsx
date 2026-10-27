import React from 'react';
import '@/renderer/styles/songlist.css';

interface AudioTagBadgeProps {
  tag: 'preview' | 'invalid';
}

const AudioTagBadge: React.FC<AudioTagBadgeProps> = ({ tag }) => {
  const config = tag === 'preview'
    ? { label: '试听', color: 'var(--warning)' }
    : { label: '不可播', color: 'var(--danger)' };

  return (
    <span
      className="badge"
      style={{ '--badge-color': config.color } as React.CSSProperties}
    >
      {config.label}
    </span>
  );
};

export default AudioTagBadge;
