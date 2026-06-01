import React, { useState, useRef, useEffect } from 'react';
import { Search, X, User, ChevronDown } from 'lucide-react';
import type { SourceKey } from '@/renderer/store/searchStore';

interface TopBarProps {
  onSearch: (keyword: string) => void;
  sourceType: SourceKey;
  onSourceTypeChange: (type: SourceKey) => void;
}

const SOURCE_CONFIG: Record<SourceKey, { label: string; accent: string }> = {
  all: { label: '全部', accent: '#6C5CE7' },
  netease: { label: '网易云', accent: '#E74C3C' },
  qq: { label: 'QQ', accent: '#1DB954' },
  kugou: { label: '酷狗', accent: '#FF8C00' },
  migu: { label: '咪咕', accent: '#C20C0C' },
  kuwo: { label: '酷我', accent: '#FF6F00' },
  qianqian: { label: '千千', accent: '#00A1D6' },
  soda: { label: '汽水', accent: '#1E90FF' },
};

const TopBar: React.FC<TopBarProps> = ({ onSearch, sourceType, onSourceTypeChange }) => {
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

  const currentSource = SOURCE_CONFIG[sourceType];

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
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          flex: 1,
        }}
      >
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
          <div ref={dropdownRef} style={{ position: 'relative', flexShrink: 0 }}>
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '6px',
                padding: '4px 10px 4px 10px',
                width: '94px',
                borderRadius: '16px',
                fontSize: '12px',
                fontWeight: 600,
                letterSpacing: '0.02em',
                border: 'none',
                cursor: 'pointer',
                backgroundColor: `${currentSource.accent}14`,
                color: currentSource.accent,
                transition: 'all 0.2s ease',
                whiteSpace: 'nowrap',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = `${currentSource.accent}24`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = `${currentSource.accent}14`;
              }}
            >
              <span
                style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  backgroundColor: currentSource.accent,
                  flexShrink: 0,
                }}
              />
              <span style={{ flex: 1, textAlign: 'center' }}>{currentSource.label}</span>
              <ChevronDown
                size={12}
                style={{
                  transition: 'transform 0.25s ease',
                  transform: dropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                  flexShrink: 0,
                }}
              />
            </button>

            <div
              style={{
                position: 'absolute',
                top: 'calc(100% + 6px)',
                left: '0',
                minWidth: '120px',
                backgroundColor: 'var(--content-bg)',
                borderRadius: '10px',
                border: '1px solid var(--border-color)',
                boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
                padding: '4px',
                opacity: dropdownOpen ? 1 : 0,
                visibility: dropdownOpen ? 'visible' : 'hidden',
                transform: dropdownOpen ? 'translateY(0) scale(1)' : 'translateY(-4px) scale(0.96)',
                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                transformOrigin: 'top left',
                zIndex: 200,
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
                      gap: '10px',
                      width: '100%',
                      padding: '8px 12px',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      backgroundColor: isActive ? `${config.accent}10` : 'transparent',
                      color: isActive ? config.accent : 'var(--text-primary)',
                      fontSize: '13px',
                      fontWeight: isActive ? 600 : 400,
                      transition: 'all 0.15s ease',
                      animation: dropdownOpen ? `dropdownItemFade 0.25s ease ${idx * 0.04}s both` : 'none',
                    }}
                    onMouseEnter={(e) => {
                      if (!isActive) e.currentTarget.style.backgroundColor = 'var(--hover-bg)';
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive) e.currentTarget.style.backgroundColor = 'transparent';
                    }}
                  >
                    <span
                      style={{
                        width: '6px',
                        height: '6px',
                        borderRadius: '50%',
                        backgroundColor: config.accent,
                        flexShrink: 0,
                      }}
                    />
                    {config.label}
                    {isActive && (
                      <span style={{ marginLeft: 'auto', fontSize: '10px', color: config.accent }}>
                        ✓
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div
            style={{
              width: '1px',
              height: '18px',
              backgroundColor: 'var(--border-color)',
              margin: '0 8px',
              flexShrink: 0,
            }}
          />

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
