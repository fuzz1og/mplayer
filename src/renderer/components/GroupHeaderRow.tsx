import React from 'react';
import { ChevronRight, Play } from 'lucide-react';
import type { SongGroup } from '@mplayer/core';

interface GroupHeaderRowProps {
  group: SongGroup;
  isExpanded: boolean;
  onToggle: () => void;
  onPlayFirst: () => void;
  style?: React.CSSProperties;
}

const GroupHeaderRow: React.FC<GroupHeaderRowProps> = ({
  group, isExpanded, onToggle, onPlayFirst, style,
}) => {
  const sourceCount = new Set(group.songs.map(s => s.sourceType)).size;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '8px 16px',
        cursor: 'pointer',
        borderBottom: '1px solid var(--border-subtle)',
        backgroundColor: 'var(--bg-surface)',
        ...style,
      }}
      onClick={onPlayFirst}
    >
      <button
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        aria-label={isExpanded ? '折叠分组' : '展开分组'}
        style={{
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          padding: '4px',
          color: 'var(--text-tertiary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <ChevronRight size={15} style={{ transform: isExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s ease' }} />
      </button>

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
        <span style={{
          fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {group.name}
        </span>
        <span style={{ color: 'var(--text-tertiary)', fontSize: '12px', flexShrink: 0 }}>·</span>
        <span style={{
          fontSize: '13px', color: 'var(--text-secondary)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {group.artist}
        </span>
      </div>

      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: '3px 9px',
        borderRadius: '999px',
        backgroundColor: 'var(--bg-hover)',
        color: 'var(--text-secondary)',
        fontSize: '12px',
        fontWeight: 500,
        flexShrink: 0,
        whiteSpace: 'nowrap',
      }}>
        {sourceCount} 个版本
      </span>

      <button
        onClick={(e) => { e.stopPropagation(); onPlayFirst(); }}
        aria-label="播放分组第一首"
        style={{
          border: 'none',
          background: 'transparent',
          color: 'var(--text-tertiary)',
          cursor: 'pointer',
          padding: '6px',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <Play size={14} fill="currentColor" />
      </button>
    </div>
  );
};

export default React.memo(GroupHeaderRow);
