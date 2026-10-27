import React from 'react';
import { ChevronRight, Play } from 'lucide-react';
import type { SongGroup } from '@mplayer/core';
import '@/renderer/styles/songlist.css';

interface GroupHeaderRowProps {
  group: SongGroup;
  isExpanded: boolean;
  /**
   * 回调**带上自己的分组**而不是由父组件包一层闭包（#412）：`onToggle={() => f(group.key)}`
   * 这种写法每次渲染都是新引用，会把本组件的 `React.memo` 直接击穿——列表滚动/任意状态
   * 变化都会让所有组头重渲染。
   */
  onToggle: (groupKey: string) => void;
  onPlayFirst: (group: SongGroup) => void;
}

const GroupHeaderRow: React.FC<GroupHeaderRowProps> = ({
  group, isExpanded, onToggle, onPlayFirst,
}) => {
  const sourceCount = new Set(group.songs.map(s => s.sourceType)).size;

  return (
    <div className="ghead"
      onClick={() => onPlayFirst(group)}
    >
      <button
        onClick={(e) => { e.stopPropagation(); onToggle(group.key); }}
        aria-label={isExpanded ? '折叠分组' : '展开分组'}
        className="ghead__toggle"
      >
        <ChevronRight size={15} className="ghead__chevron" data-expanded={isExpanded || undefined} />
      </button>

      <div className="ghead__main">
        <span className="ghead__name">{group.name}</span>
        <span className="ghead__dot">·</span>
        <span className="ghead__artist">{group.artist}</span>
      </div>

      <span className="ghead__badge">
        {sourceCount} 个版本
      </span>

      <button
        onClick={(e) => { e.stopPropagation(); onPlayFirst(group); }}
        aria-label="播放分组第一首"
        className="ghead__play"
      >
        <Play size={14} fill="currentColor" />
      </button>
    </div>
  );
};

export default React.memo(GroupHeaderRow);
