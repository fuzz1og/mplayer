import React, { useState, useRef, useEffect } from 'react';
import { Search, X, ChevronDown, ArrowLeft, ArrowRight, RotateCw } from 'lucide-react';
import type { SourceKey } from '@/renderer/store/searchStore';
import { useButtonHover } from '@/renderer/hooks/useButtonHover';

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
  all: { label: '全部', accent: '#8B5CF6' },
  netease: { label: '网易云', accent: '#E74C3C' },
  qq: { label: 'QQ', accent: '#1DB954' },
  kugou: { label: '酷狗', accent: '#FF8C00' },
  migu: { label: '咪咕', accent: '#C20C0C' },
  kuwo: { label: '酷我', accent: '#FF6F00' },
  qianqian: { label: '千千', accent: '#00A1D6' },
  soda: { label: '汽水', accent: '#1E90FF' },
};

const TopBar: React.FC<TopBarProps> = ({ onSearch, sourceType, onSourceTypeChange, onBack, onForward, onRefresh, canGoBack, canGoForward }) => {
  const [searchValue, setSearchValue] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const dropdownHoverProps = useButtonHover({ hoverBg: 'var(--bg-hover)', leaveBg: 'transparent' });

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

  const searchBoxStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    backgroundColor: isFocused ? 'var(--bg-surface)' : 'var(--input-bg)',
    border: `1px solid ${isFocused ? 'var(--accent)' : 'var(--input-border)'}`,
    borderRadius: 'var(--radius-full)',
    padding: '6px 4px 6px 6px',
    transition: 'all var(--duration-normal) var(--ease-out)',
    boxShadow: isFocused ? '0 0 0 3px var(--accent-subtle)' : 'var(--shadow-xs)',
  };

  return (
    <header
      style={{
        height: 'var(--topbar-height)',
        backgroundColor: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border-subtle)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 var(--space-6)',
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', flex: 1 }}>
        {/* 导航按钮 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', flexShrink: 0 }}>
          <button
            onClick={onBack}
            disabled={!canGoBack}
            className="player-btn"
            aria-label="后退"
            style={{ opacity: canGoBack ? 1 : 0.3, cursor: canGoBack ? 'pointer' : 'not-allowed' }}
          >
            <ArrowLeft size={16} />
          </button>
          <button
            onClick={onForward}
            disabled={!canGoForward}
            className="player-btn"
            aria-label="前进"
            style={{ opacity: canGoForward ? 1 : 0.3, cursor: canGoForward ? 'pointer' : 'not-allowed' }}
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

        <div style={searchBoxStyle}>
          {/* 来源选择器 */}
          <div ref={dropdownRef} style={{ position: 'relative', flexShrink: 0 }}>
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '5px 10px',
                width: '90px',
                borderRadius: 'var(--radius-full)',
                fontSize: 'var(--text-xs)',
                fontWeight: 'var(--weight-semibold)',
                border: 'none',
                cursor: 'pointer',
                backgroundColor: `${currentSource.accent}12`,
                color: currentSource.accent,
                transition: 'all var(--duration-fast) var(--ease-out)',
              }}
            >
              <span
                style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: 'var(--radius-full)',
                  backgroundColor: currentSource.accent,
                  flexShrink: 0,
                }}
              />
              <span style={{ flex: 1, textAlign: 'center' }}>{currentSource.label}</span>
              <ChevronDown
                size={12}
                style={{
                  transition: 'transform var(--duration-normal) var(--ease-out)',
                  transform: dropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                  flexShrink: 0,
                }}
              />
            </button>

            {/* 下拉菜单 */}
            {dropdownOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 6px)',
                  left: 0,
                  minWidth: '130px',
                  backgroundColor: 'var(--bg-surface)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-default)',
                  boxShadow: 'var(--shadow-xl)',
                  padding: 'var(--space-1)',
                  zIndex: 200,
                  animation: 'scaleIn var(--duration-fast) var(--ease-out)',
                }}
              >
                {(Object.entries(SOURCE_CONFIG) as [SourceKey, typeof SOURCE_CONFIG[SourceKey]][]).map(([key, config], idx) => {
                  const isActive = sourceType === key;
                  return (
                    <button
                      key={key}
                      onClick={() => {
                        onSourceTypeChange(key);
                        setDropdownOpen(false);
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--space-2)',
                        width: '100%',
                        padding: '7px var(--space-3)',
                        border: 'none',
                        borderRadius: 'var(--radius-xs)',
                        cursor: 'pointer',
                        backgroundColor: isActive ? `${config.accent}10` : 'transparent',
                        color: isActive ? config.accent : 'var(--text-primary)',
                        fontSize: 'var(--text-sm)',
                        fontWeight: isActive ? 'var(--weight-semibold)' : 'var(--weight-normal)',
                        transition: 'background var(--duration-fast)',
                        animation: dropdownOpen ? `dropdownItemFade var(--duration-normal) var(--ease-out) ${idx * 0.04}s both` : 'none',
                      }}
                      {...(!isActive ? { onMouseEnter: dropdownHoverProps.handleMouseEnter, onMouseLeave: dropdownHoverProps.handleMouseLeave } : {})}
                    >
                      <span
                        style={{
                          width: '6px',
                          height: '6px',
                          borderRadius: 'var(--radius-full)',
                          backgroundColor: config.accent,
                          flexShrink: 0,
                        }}
                      />
                      {config.label}
                      {isActive && <span style={{ marginLeft: 'auto', fontSize: '10px', color: config.accent }}>✓</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* 分隔线 */}
          <div
            style={{
              width: '1px',
              height: '16px',
              backgroundColor: 'var(--border-default)',
              margin: '0 var(--space-2)',
              flexShrink: 0,
            }}
          />

          {/* 搜索输入 */}
          <div style={{ display: 'flex', alignItems: 'center', flex: 1, padding: '0 var(--space-2)' }}>
            <Search
              size={16}
              color={isFocused ? 'var(--accent)' : 'var(--text-tertiary)'}
              style={{ marginRight: 'var(--space-2)', flexShrink: 0, transition: 'color var(--duration-fast)' }}
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
              style={{
                flex: 1,
                border: 'none',
                outline: 'none',
                background: 'transparent',
                fontSize: 'var(--text-sm)',
                color: 'var(--text-primary)',
              } as React.CSSProperties}
            />
            {searchValue && (
              <button
                onClick={() => setSearchValue('')}
                aria-label="清除搜索"
                className="player-btn"
                style={{ padding: 'var(--space-1)' }}
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
