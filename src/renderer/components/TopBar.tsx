import React, { useState, useRef, useEffect } from 'react';
import { Search, X, Check, ChevronDown, ArrowLeft, ArrowRight, RotateCw } from 'lucide-react';
import type { SourceKey } from '@/renderer/store/searchStore';
import { SOURCE_COLORS, ALL_SOURCE_COLOR } from '@/renderer/constants/sourceConfig';

interface TopBarProps {
  onSearch: (keyword: string) => void;
  sourceType: SourceKey;
  onSourceTypeChange: (type: SourceKey) => void;
  onBack?: () => void;
  onForward?: () => void;
  onRefresh?: () => void;
  canGoBack?: boolean;
  canGoForward?: boolean;
}

const SOURCE_CONFIG: Record<SourceKey, { label: string; accent: string }> = {
  all: { label: '全部', accent: ALL_SOURCE_COLOR },
  netease: { label: '网易云', accent: SOURCE_COLORS.netease },
  qq: { label: 'QQ', accent: SOURCE_COLORS.qq },
  kugou: { label: '酷狗', accent: SOURCE_COLORS.kugou },
  kuwo: { label: '酷我', accent: SOURCE_COLORS.kuwo },
  migu: { label: '咪咕', accent: SOURCE_COLORS.migu },
  qianqian: { label: '千千', accent: SOURCE_COLORS.qianqian },
  soda: { label: '汽水', accent: SOURCE_COLORS.soda },
  local: { label: '本地', accent: SOURCE_COLORS.local },
};

const TopBar: React.FC<TopBarProps> = ({ onSearch, sourceType, onSourceTypeChange, onBack, onForward, onRefresh, canGoBack, canGoForward }) => {
  const [searchValue, setSearchValue] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSearch = () => {
    if (searchValue.trim()) onSearch(searchValue.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  };

  const currentSource = SOURCE_CONFIG[sourceType];

  return (
    <header className="topbar">
      <div className="topbar__leading">
        {/* 导航按钮 */}
        <div className="topbar__nav">
          <button
            onClick={onBack}
            disabled={!canGoBack}
            className="player-btn"
            aria-label="后退"
          >
            <ArrowLeft size={16} />
          </button>
          <button
            onClick={onForward}
            disabled={!canGoForward}
            className="player-btn"
            aria-label="前进"
          >
            <ArrowRight size={16} />
          </button>
          <button
            onClick={onRefresh}
            className="player-btn"
            aria-label="刷新"
          >
            <RotateCw size={16} />
          </button>
        </div>

        <div className={isFocused ? 'topbar__search topbar__search--focused' : 'topbar__search'}>
          {/* 来源选择器 */}
          <div
            ref={dropdownRef}
            className="topbar__source"
            style={{ '--source-accent': currentSource.accent } as React.CSSProperties}
          >
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="topbar__source-trigger"
            >
              <span className="topbar__source-dot" />
              <span className="topbar__source-label">{currentSource.label}</span>
              <ChevronDown
                size={12}
                className={dropdownOpen ? 'topbar__source-chevron topbar__source-chevron--open' : 'topbar__source-chevron'}
              />
            </button>

            {/* 下拉菜单 */}
            {dropdownOpen && (
              <div className="topbar__dropdown">
                {(Object.entries(SOURCE_CONFIG) as [SourceKey, typeof SOURCE_CONFIG[SourceKey]][]).map(([key, config], idx) => {
                  const isActive = sourceType === key;
                  return (
                    <button
                      key={key}
                      onClick={() => {
                        onSourceTypeChange(key);
                        setDropdownOpen(false);
                      }}
                      className={isActive ? 'topbar__source-item topbar__source-item--active' : 'topbar__source-item'}
                      style={{ '--source-accent': config.accent, '--item-delay': `${idx * 0.04}s` } as React.CSSProperties}
                    >
                      <span className="topbar__source-dot" />
                      {config.label}
                      {isActive && <span className="topbar__source-check"><Check size={12} /></span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* 分隔线 */}
          <div className="topbar__divider" />

          {/* 搜索输入 */}
          <div className="topbar__search-field">
            <Search
              size={16}
              color={isFocused ? 'var(--accent)' : 'var(--text-tertiary)'}
              className="topbar__search-icon"
            />
            <input
              type="text"
              placeholder="搜索音乐、歌手、专辑..."
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              aria-label="搜索音乐、歌手、专辑"
              className="topbar__search-input"
            />
            {searchValue && (
              <button
                onClick={() => setSearchValue('')}
                aria-label="清除搜索"
                className="player-btn topbar__clear"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};

export default React.memo(TopBar);
