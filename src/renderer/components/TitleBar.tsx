import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Minus, Square, Copy, X, Search, ChevronDown, ChevronLeft, ChevronRight, Settings, HelpCircle } from 'lucide-react';
import type { SourceKey } from '@/renderer/store/searchStore';
import { SOURCE_COLORS, ALL_SOURCE_COLOR } from '@/renderer/constants/sourceConfig';
import { SOURCE_DISPLAY_NAMES } from '@mplayer/core';
import { Menu } from '@/renderer/ui';
import type { MenuItem } from '@/renderer/ui';
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
 * 菜单统一由 Menu 原语承载（#709）：首项聚焦、方向键 / Home / End / ESC / Tab 与焦点归还。
 */
const TitleBar: React.FC<TitleBarProps> = ({ title, onBack, onSettingsClick, updateAvailable = false, onSearch, sourceType = 'all', onSourceTypeChange }) => {
  const navigate = useNavigate();
  const [maximized, setMaximized] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [focused, setFocused] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [sourceMenuInitialFocus, setSourceMenuInitialFocus] = useState<'first' | 'last'>('first');
  const inputRef = useRef<HTMLInputElement>(null);
  const sourceTriggerRef = useRef<HTMLButtonElement>(null);
  const helpTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    ipcRenderer.invoke('window:isMaximized').then(setMaximized).catch(() => {});
    const handleMaximized = (_event: unknown, value: boolean) => setMaximized(value);
    ipcRenderer.on('window:maximized', handleMaximized);
    return () => {
      ipcRenderer.removeListener('window:maximized', handleMaximized);
    };
  }, []);

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
  }, [navigate]);

  const helpMenuItems: MenuItem[] = [
    { key: 'update', label: '检查更新', onSelect: () => handleHelpNavigate('/settings/update') },
    { key: 'about', label: '关于', onSelect: () => handleHelpNavigate('/settings/about') },
  ];

  const sourceMenuItems: MenuItem[] = (Object.entries(SOURCE_CONFIG) as [SourceKey, typeof SOURCE_CONFIG[SourceKey]][]).map(
    ([key, config]) => ({
      key,
      label: config.label,
      icon: <span className="titlebar__source-dot" style={{ '--source-accent': config.accent } as React.CSSProperties} />,
      checked: sourceType === key,
      ariaLabel: config.label,
      onSelect: () => onSourceTypeChange?.(key),
    }),
  );

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
          <Settings size={16} />
        </button>
        <div className="titlebar__help">
          <button
            ref={helpTriggerRef}
            type="button"
            className="titlebar__tool"
            aria-label="帮助"
            aria-haspopup="menu"
            aria-expanded={helpOpen}
            onClick={() => setHelpOpen((open) => !open)}
          >
            <HelpCircle size={16} />
            {updateAvailable && (
              <span className="titlebar__badge" data-testid="update-badge" title="有新版本可更新" aria-hidden="true" />
            )}
          </button>
          <Menu
            open={helpOpen}
            anchorRef={helpTriggerRef}
            items={helpMenuItems}
            onClose={() => setHelpOpen(false)}
            ariaLabel="帮助"
            placement="bottom-start"
            minWidth={132}
          />
        </div>
      </div>

      <div className="titlebar__center">
        {title ? (
          <span className="titlebar__title">{title}</span>
        ) : (
          <div className={focused ? 'titlebar__search titlebar__search--focused' : 'titlebar__search'}>
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
            <div
              className="titlebar__source"
              style={{ '--source-accent': current.accent } as React.CSSProperties}
            >
              <button
                ref={sourceTriggerRef}
                type="button"
                className="titlebar__source-trigger"
                aria-label={`搜索来源：${current.label}`}
                aria-haspopup="menu"
                aria-expanded={dropdownOpen}
                onClick={() => {
                  setSourceMenuInitialFocus('first');
                  setDropdownOpen((open) => !open);
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
                  event.preventDefault();
                  setSourceMenuInitialFocus(event.key === 'ArrowUp' ? 'last' : 'first');
                  setDropdownOpen(true);
                }}
              >
                <span className="titlebar__source-dot" aria-hidden="true" />
                <span className="titlebar__source-label">{current.label}</span>
                <ChevronDown size={12} className={dropdownOpen ? 'titlebar__source-chevron titlebar__source-chevron--open' : 'titlebar__source-chevron'} aria-hidden="true" />
              </button>
              <Menu
                open={dropdownOpen}
                anchorRef={sourceTriggerRef}
                items={sourceMenuItems}
                onClose={() => setDropdownOpen(false)}
                ariaLabel="搜索来源"
                placement="bottom-start"
                minWidth={132}
                initialFocus={sourceMenuInitialFocus}
              />
            </div>
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
