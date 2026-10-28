import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Minus, Square, Copy, X, Search, ChevronDown, ChevronLeft, ChevronRight, Check } from 'lucide-react';
import type { SourceKey } from '@/renderer/store/searchStore';
import { SOURCE_COLORS, ALL_SOURCE_COLOR } from '@/renderer/constants/sourceConfig';
import { SOURCE_DISPLAY_NAMES } from '@mplayer/core';
import '@/renderer/styles/titlebar.css';

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
  /** 兼容旧调用方：设置页返回入口；缺省用 navigate(-1)。 */
  onBack?: () => void;
  /** 设置入口；缺省用 navigate('/settings')。 */
  onSettingsClick?: () => void;
  /** 有可用更新时在「帮助」上点一枚红点（#579）。 */
  updateAvailable?: boolean;
  onSearch?: (keyword: string) => void;
  sourceType?: SourceKey;
  onSourceTypeChange?: (type: SourceKey) => void;
}

/**
 * 标题栏（1.9.0 收口）：左列 ‹ › 设置 帮助，中部搜索（或页面标题），右侧窗口控件。
 * 品牌与 logo 已移除——应用身份由窗口标题/任务栏承担；「检查更新」收进「帮助」菜单。
 * 搜索不再绑 Ctrl/Cmd+K（规格 §2.3）：不显示 kbd 提示，也不注册全局快捷键。
 */
const TitleBar: React.FC<TitleBarProps> = ({ title, onBack, onSettingsClick, updateAvailable = false, onSearch, sourceType = 'all', onSourceTypeChange }) => {
  const navigate = useNavigate();
  const [maximized, setMaximized] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [focused, setFocused] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const sourceRef = useRef<HTMLDivElement>(null);
  const helpRef = useRef<HTMLDivElement>(null);
  const helpTriggerRef = useRef<HTMLButtonElement>(null);
  const helpMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ipcRenderer.invoke('window:isMaximized').then(setMaximized).catch(() => {});
    const handleMaximized = (_event: unknown, value: boolean) => setMaximized(value);
    ipcRenderer.on('window:maximized', handleMaximized);
    return () => {
      ipcRenderer.removeListener('window:maximized', handleMaximized);
    };
  }, []);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (sourceRef.current && !sourceRef.current.contains(event.target as Node)) setDropdownOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  const closeHelp = useCallback((returnFocus = false) => {
    setHelpOpen(false);
    if (returnFocus) helpTriggerRef.current?.focus();
  }, []);

  // 帮助菜单：ESC / 点击外部关闭；打开时把焦点送进第一项，ESC 关闭后归还触发按钮。
  useEffect(() => {
    if (!helpOpen) return;
    helpMenuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const onPointerDown = (event: MouseEvent) => {
      if (helpRef.current && !helpRef.current.contains(event.target as Node)) setHelpOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeHelp(true);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [helpOpen, closeHelp]);

  const handleHelpMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // 禁用项不参与方向键导航（ARIA 菜单惯例）
    const items = Array.from(helpMenuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? []);
    if (items.length === 0) return;
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex = currentIndex;
    if (event.key === 'ArrowDown') nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
    else if (event.key === 'ArrowUp') nextIndex = currentIndex < 0 ? items.length - 1 : (currentIndex - 1 + items.length) % items.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = items.length - 1;
    else return;
    event.preventDefault();
    items[nextIndex]?.focus();
  };

  const handleBack = useCallback(() => {
    if (onBack) onBack();
    else navigate(-1);
  }, [navigate, onBack]);

  const handleForward = useCallback(() => navigate(1), [navigate]);

  const handleSettings = useCallback(() => {
    if (onSettingsClick) onSettingsClick();
    else navigate('/settings');
  }, [navigate, onSettingsClick]);

  const handleHelpNavigate = useCallback((path: string) => {
    setHelpOpen(false);
    navigate(path);
    helpTriggerRef.current?.focus();
  }, [navigate]);

  const submit = useCallback(() => {
    const value = keyword.trim();
    if (!value) return;
    onSearch?.(value);
  }, [keyword, onSearch]);

  const current = SOURCE_CONFIG[sourceType];

  return (
    <header className="titlebar">
      <div className="titlebar__leading">
        <button type="button" className="titlebar__nav" onClick={handleBack} aria-label="返回">
          <ChevronLeft size={16} />
        </button>
        <button type="button" className="titlebar__nav" onClick={handleForward} aria-label="前进">
          <ChevronRight size={16} />
        </button>
        <button type="button" className="titlebar__tool" onClick={handleSettings} aria-label="设置">
          设置
        </button>
        <div className="titlebar__help" ref={helpRef}>
          <button
            ref={helpTriggerRef}
            type="button"
            className="titlebar__tool"
            aria-label="帮助"
            aria-haspopup="menu"
            aria-expanded={helpOpen}
            onClick={() => setHelpOpen((open) => !open)}
          >
            帮助
            {updateAvailable && (
              <span className="titlebar__badge" data-testid="update-badge" title="有新版本可更新" aria-hidden="true" />
            )}
          </button>
          {helpOpen && (
            <div ref={helpMenuRef} className="titlebar__help-menu" role="menu" aria-label="帮助" onKeyDown={handleHelpMenuKeyDown}>
              <button type="button" role="menuitem" className="titlebar__help-item" onClick={() => handleHelpNavigate('/settings/update')}>
                检查更新
              </button>
              <button type="button" role="menuitem" className="titlebar__help-item" onClick={() => handleHelpNavigate('/settings/about')}>
                关于
              </button>
            </div>
          )}
        </div>
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
            {keyword && (
              <button type="button" className="titlebar__search-clear" aria-label="清除搜索" onClick={() => setKeyword('')}>
                <X size={13} />
              </button>
            )}
          </div>
        )}
      </div>

      <div className="titlebar__trailing">
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
