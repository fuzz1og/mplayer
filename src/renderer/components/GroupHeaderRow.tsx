import React from 'react';
import { ChevronDown } from 'lucide-react';
import type { SongGroup } from '@/shared/types/song';

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
  const sourceSet = new Set(group.songs.map(s => s.sourceType));
  const sourceCount = sourceSet.size;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '10px 16px',
        cursor: 'pointer',
        borderBottom: '1px solid var(--border-color)',
        backgroundColor: 'var(--content-bg)',
        ...style,
      }}
      onClick={onPlayFirst}
    >
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
        <span style={{
          fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {group.name}
        </span>
        <span style={{ color: 'var(--text-tertiary)', fontSize: '13px' }}>-</span>
        <span style={{
          fontSize: '13px', color: 'var(--text-secondary)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {group.artist}
        </span>
      </div>

      <button
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        style={{
          display: 'flex', alignItems: 'center', gap: '4px',
          padding: '4px 10px', border: 'none', borderRadius: '12px',
          backgroundColor: '#6C5CE7', color: 'white',
          fontSize: '11px', fontWeight: 600, cursor: 'pointer',
          transition: 'opacity 0.15s', whiteSpace: 'nowrap', flexShrink: 0,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.8'; }}
        onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
      >
        <span>{sourceCount} 个版本</span>
        <ChevronDown size={12} style={{
          transition: 'transform 0.2s',
          transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
        }} />
      </button>
    </div>
  );
};

export default React.memo(GroupHeaderRow);
