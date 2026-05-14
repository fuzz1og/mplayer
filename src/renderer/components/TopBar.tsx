import React, { useState } from 'react';
import { Search, X, User } from 'lucide-react';

interface TopBarProps {
  onSearch: (keyword: string) => void;
  searchLoading?: boolean;
  sourceType: 'netease' | 'qq';
  onSourceTypeChange: (type: 'netease' | 'qq') => void;
}

const SOURCE_CONFIG = {
  netease: { label: '网易云', accent: '#E74C3C', bg: 'rgba(231, 76, 60, 0.12)' },
  qq: { label: 'QQ 音乐', accent: '#1DB954', bg: 'rgba(29, 185, 84, 0.12)' },
} as const;

const TopBar: React.FC<TopBarProps> = ({ onSearch, sourceType, onSourceTypeChange }) => {
  const [searchValue, setSearchValue] = useState('');
  const [isFocused, setIsFocused] = useState(false);

  const handleSearch = () => {
    if (searchValue.trim()) {
      onSearch(searchValue.trim());
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const clearSearch = () => {
    setSearchValue('');
  };

  return (
    <header
      style={{
        height: '60px',
        backgroundColor: 'var(--content-bg)',
        borderBottom: '1px solid var(--border-color)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 24px',
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}
    >
      {/* 左侧 - 搜索框 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          flex: 1,
        }}
      >
        {/* 整体容器 - 音乐源选择器 + 搜索框 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            backgroundColor: isFocused ? 'var(--bg-color)' : '#F8F9FA',
            border: `1px solid ${isFocused ? 'var(--accent-color)' : 'transparent'}`,
            borderRadius: '24px',
            padding: '6px 4px 6px 6px',
            transition: 'all 0.25s ease',
            boxShadow: isFocused ? '0 0 0 3px rgba(116, 185, 255, 0.15)' : 'none',
          }}
        >
          {/* 音乐源分段切换器 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '2px',
              backgroundColor: 'var(--hover-bg)',
              borderRadius: '18px',
              padding: '2px',
              flexShrink: 0,
            }}
          >
            {(Object.entries(SOURCE_CONFIG) as [string, typeof SOURCE_CONFIG[keyof typeof SOURCE_CONFIG]][]).map(([key, config]) => {
              const isActive = sourceType === key;
              return (
                <button
                  key={key}
                  onClick={() => onSourceTypeChange(key as 'netease' | 'qq')}
                  style={{
                    padding: '4px 12px',
                    borderRadius: '16px',
                    fontSize: '12px',
                    fontWeight: isActive ? 600 : 400,
                    letterSpacing: '0.02em',
                    border: 'none',
                    cursor: 'pointer',
                    background: isActive ? config.accent : 'transparent',
                    color: isActive ? '#fff' : 'var(--text-tertiary)',
                    transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                    position: 'relative',
                    boxShadow: isActive ? `0 1px 4px ${config.accent}44` : 'none',
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.background = config.bg;
                      e.currentTarget.style.color = config.accent;
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.background = 'transparent';
                      e.currentTarget.style.color = 'var(--text-tertiary)';
                    }
                  }}
                >
                  {config.label}
                </button>
              );
            })}
          </div>

          {/* 分隔线 */}
          <div
            style={{
              width: '1px',
              height: '18px',
              backgroundColor: 'var(--border-color)',
              margin: '0 8px',
              flexShrink: 0,
            }}
          />

          {/* 搜索框 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              flex: 1,
              padding: '0 8px',
            }}
          >
            <Search
              size={18}
              color={isFocused ? 'var(--accent-color)' : 'var(--text-tertiary)'}
              style={{ marginRight: '10px', flexShrink: 0, transition: 'color 0.2s ease' }}
            />
            <input
              type="text"
              placeholder="搜索音乐、歌手、专辑..."
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              style={{
                flex: 1,
                border: 'none',
                outline: 'none',
                background: 'transparent',
                fontSize: '14px',
                color: 'var(--text-primary)',
                '::placeholder': {
                  color: 'var(--text-tertiary)',
                },
              } as React.CSSProperties}
            />
            {searchValue && (
              <button
                onClick={clearSearch}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  padding: '4px',
                  marginLeft: '4px',
                  borderRadius: '50%',
                  color: 'var(--text-tertiary)',
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--hover-bg)';
                  e.currentTarget.style.color = 'var(--text-primary)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = 'var(--text-tertiary)';
                }}
              >
                <X size={16} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 右侧 - 用户信息 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '20px',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            cursor: 'pointer',
            padding: '6px 12px',
            borderRadius: '20px',
            transition: 'background-color 0.15s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--hover-bg)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
          }}
        >
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #74B9FF 0%, #0984E3 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <User size={18} color="white" />
          </div>
          <span
            style={{
              fontSize: '14px',
              color: 'var(--text-secondary)',
              fontWeight: 500,
            }}
          >
            用户
          </span>
        </div>
      </div>
    </header>
  );
};

export default React.memo(TopBar);
