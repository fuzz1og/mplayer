import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Minus, Square, Copy, X, Search, ChevronDown, ChevronLeft, Check } from 'lucide-react';
import type { SourceKey } from '@/renderer/store/searchStore';
import { SOURCE_COLORS, ALL_SOURCE_COLOR } from '@/renderer/constants/sourceConfig';
import { SOURCE_DISPLAY_NAMES } from '@mplayer/core';

const ipcRenderer = window.electronAPI;

/** 来源中文名唯一来源是 core 的 SOURCE_DISPLAY_NAMES（docs/agents/architecture.md:74）；这里只补「全部」与色点。 */
const SOURCE_CONFIG: Record<SourceKey, { label: string; accent: string }> = {
  all: { label: '全部', accent: ALL_SOURCE_COLOR },
  netease: { label: SOURCE_DISPLAY_NAMES.netease, accent: SOURCE_COLORS.netease },
  qq: { label: SOURCE_DISPLAY_NAMES.qq, accent: SOURCE_COLORS.qq },
  kugou: { label: SOURCE_DISPLAY_NAMES.kugou, accent: SOURCE_COLORS.kugou },
  kuwo: { label: SOURCE_DISPLAY_NAMES.kuwo, accent: SOURCE_COLORS.kuwo },
  migu: { label: SOURCE_DISPLAY_NAMES.migu, accent: SOURCE_COLORS.migu },
  qianqian: { label: SOURCE_DISPLAY_NAMES.qianqian, accent: SOURCE_COLORS.qianqian },
  soda: { label: SOURCE_DISPLAY_NAMES.soda, accent: SOURCE_COLORS.soda },
  local: { label: SOURCE_DISPLAY_NAMES.local, accent: SOURCE_COLORS.local },
};

interface TitleBarProps {
  /** 中部标题；传入时隐藏搜索框（设置页）。 */
  title?: string;
  /** 有标题时的左上返回入口——spec 要求「左上返回 + ESC」两条退出口都在。 */
  onBack?: () => void;
  /** 设置入口（1.9.0 从侧栏搬上来：侧栏只留内容导航，设置是应用级动作）。 */
  onSettingsClick?: () => void;
  /** 有可用更新时在「设置」右侧点一枚徽标（#579）。 */
  updateAvailable?: boolean;
  onSearch?: (keyword: string) => void;
  sourceType?: SourceKey;
  onSourceTypeChange?: (type: SourceKey) => void;
}

/**
 * 标题栏（1.9.0）：品牌左、中部搜索（或页面标题）、窗口控件右。
 * 搜索从旧 TopBar 上移到这里，Ctrl/Cmd+K 聚焦；来源筛选收进搜索框左侧的小下拉。
 */
const TitleBar: React.FC<TitleBarProps> = ({ title, onBack, onSettingsClick, updateAvailable = false, onSearch, sourceType = 'all', onSourceTypeChange }) => {
  const [maximized, setMaximized] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [focused, setFocused] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const sourceRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ipcRenderer.invoke('window:isMaximized').then(setMaximized).catch(() => {});
    const handleMaximized = (_event: unknown, value: boolean) => setMaximized(value);
    ipcRenderer.on('window:maximized', handleMaximized);
    return () => {
      ipcRenderer.removeListener('window:maximized', handleMaximized);
    };
  }, []);

  // Ctrl/Cmd+K 聚焦搜索（原型里搜索框右侧的提示）
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') return;
      if (!inputRef.current) return;
      event.preventDefault();
      inputRef.current.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (sourceRef.current && !sourceRef.current.contains(event.target as Node)) setDropdownOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  const submit = useCallback(() => {
    const value = keyword.trim();
    if (!value) return;
    onSearch?.(value);
  }, [keyword, onSearch]);

  const current = SOURCE_CONFIG[sourceType];

  return (
    <header className="titlebar">
      <div className="titlebar__leading">
        {title && onBack && (
          <button type="button" className="titlebar__back" onClick={onBack} aria-label="返回">
            <ChevronLeft size={15} />
            <span>返回</span>
          </button>
        )}
        {title && (
          <span className="titlebar__brand">
            <img className="titlebar__brand-icon" src="./icon.png" alt="" />
            <span>MPlayer</span>
          </span>
        )}
      </div>

      <div className="titlebar__center">
        {title ? (
          <span className="titlebar__title">{title}</span>
        ) : (
          <div className={focused ? 'titlebar__search titlebar__search--focused' : 'titlebar__search'}>
            <div
              ref={sourceRef}
              className="titlebar__source"
              style={{ '--source-accent': current.accent } as React.CSSProperties}
            >
              <button
                type="button"
                className="titlebar__source-trigger"
                aria-label={`搜索来源：${current.label}`}
                onClick={() => setDropdownOpen((open) => !open)}
              >
                <span className="titlebar__source-dot" aria-hidden="true" />
                <span className="titlebar__source-label">{current.label}</span>
                <ChevronDown size={12} className={dropdownOpen ? 'titlebar__source-chevron titlebar__source-chevron--open' : 'titlebar__source-chevron'} aria-hidden="true" />
              </button>
              {dropdownOpen && (
                <div className="titlebar__source-menu" role="menu">
                  {(Object.entries(SOURCE_CONFIG) as [SourceKey, typeof SOURCE_CONFIG[SourceKey]][]).map(([key, config]) => (
                    <button
                      key={key}
                      type="button"
                      role="menuitemradio"
                      aria-checked={sourceType === key}
                      className="titlebar__source-item"
                      style={{ '--source-accent': config.accent } as React.CSSProperties}
                      onClick={() => {
                        onSourceTypeChange?.(key);
                        setDropdownOpen(false);
                      }}
                    >
                      <span className="titlebar__source-dot" aria-hidden="true" />
                      <span>{config.label}</span>
                      {sourceType === key && <Check size={12} className="titlebar__source-check" aria-hidden="true" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <span className="titlebar__divider" aria-hidden="true" />
            <Search size={15} className="titlebar__search-icon" aria-hidden="true" />
            <input
              ref={inputRef}
              type="search"
              className="titlebar__search-input"
              placeholder="搜索歌曲、专辑、歌手"
              aria-label="搜索歌曲、专辑、歌手"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submit();
                if (event.key === 'Escape') setKeyword('');
              }}
            />
            {keyword ? (
              <button type="button" className="titlebar__search-clear" aria-label="清除搜索" onClick={() => setKeyword('')}>
                <X size={13} />
              </button>
            ) : (
              <kbd className="titlebar__kbd">Ctrl K</kbd>
            )}
          </div>
        )}
      </div>

      <div className="titlebar__trailing">
        {!title && onSettingsClick && (
          <button type="button" className="titlebar__settings" onClick={onSettingsClick} aria-label="设置">
            设置
            {updateAvailable && <span className="titlebar__settings-badge" data-testid="update-badge" title="有新版本可更新" aria-hidden="true" />}
          </button>
        )}
        <div className="titlebar__controls">
          <button type="button" className="titlebar__btn" onClick={() => ipcRenderer.invoke('window:minimize')} aria-label="最小化">
          <Minus size={14} />
        </button>
          <button
            type="button"
            className="titlebar__btn"
            onClick={() => ipcRenderer.invoke('window:toggleMaximize')}
            aria-label={maximized ? '还原' : '最大化'}
          >
            {maximized ? <Copy size={12} /> : <Square size={11} />}
          </button>
          <button
            type="button"
            className="titlebar__btn titlebar__btn--close"
            onClick={() => ipcRenderer.invoke('window:close')}
            aria-label="关闭"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </header>
  );
};

export default TitleBar;
