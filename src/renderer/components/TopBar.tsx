import React, { useState } from 'react';
import { Search, X, User } from 'lucide-react';
import CustomDropdown from './CustomDropdown';

interface TopBarProps {
  onSearch: (keyword: string) => void;
  searchLoading?: boolean;
  sourceType: 'netease' | 'qq';
  onSourceTypeChange: (type: 'netease' | 'qq') => void;
}

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

  const sourceOptions = [
    { value: 'netease', label: '网易' },
    { value: 'qq', label: 'QQ' },
  ];

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
            borderRadius: '20px',
            padding: '8px 4px 8px 16px',
            transition: 'all 0.2s ease',
          }}
        >
          {/* 音乐源选择器 */}
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <CustomDropdown
              value={sourceType}
              options={sourceOptions}
              onChange={(value) => onSourceTypeChange(value as 'netease' | 'qq')}
            />
            {/* 分隔线 */}
            <div
              style={{
                width: '1px',
                height: '20px',
                backgroundColor: 'var(--border-color)',
                marginLeft: '12px',
              }}
            />
          </div>

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
              style={{ marginRight: '10px', flexShrink: 0 }}
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
              }}
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
                  padding: '2px',
                  marginLeft: '8px',
                }}
              >
                <X size={16} color="var(--text-tertiary)" />
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
