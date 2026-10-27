import React from 'react';
import {
  Sparkles,
  Compass,
  Library,
  Heart,
  History,
  ListMusic,
  Settings,
} from 'lucide-react';

interface NavItem {
  key: string;
  icon: React.ReactNode;
  label: string;
  /** 右侧圆点徽标（#579：「设置」项表示有可用更新） */
  badge?: boolean;
}

interface SidebarProps {
  currentPage: string;
  onPageChange: (page: string) => void;
  /** 有可用更新时在左下「设置」项旁显示徽标（#579 / ADR 决策 3） */
  updateAvailable?: boolean;
}

/**
 * 侧栏 7 项。原「本地音乐 / 下载管理 / 我的收藏 / 播放历史」四入口按 1.9.0 决策收进
 * 「资料库」分段（后两者同时保留快捷入口），队列移到播放栏与全屏播放器。
 */
const Sidebar: React.FC<SidebarProps> = ({ currentPage, onPageChange, updateAvailable = false }) => {
  const primaryItems: NavItem[] = [
    { key: 'recommend', icon: <Sparkles size={17} />, label: '推荐' },
    { key: 'discover', icon: <Compass size={17} />, label: '发现' },
  ];

  const libraryItems: NavItem[] = [
    { key: 'library', icon: <Library size={17} />, label: '资料库' },
    { key: 'favorites', icon: <Heart size={17} />, label: '我喜欢的音乐' },
    { key: 'history', icon: <History size={17} />, label: '最近播放' },
  ];

  const playlistItems: NavItem[] = [
    { key: 'playlists', icon: <ListMusic size={17} />, label: '我的歌单' },
  ];

  const renderNavItem = (item: NavItem) => {
    const isActive = currentPage === item.key;
    return (
      <button
        key={item.key}
        type="button"
        className="sidebar__item"
        onClick={() => onPageChange(item.key)}
        aria-current={isActive ? 'page' : undefined}
        aria-label={item.badge ? `${item.label}（有可用更新）` : undefined}
      >
        <span className="sidebar__icon" aria-hidden="true">
          {item.icon}
        </span>
        <span>{item.label}</span>
        {item.badge && <span className="sidebar__badge" data-testid="update-badge" title="有新版本可更新" aria-hidden="true" />}
      </button>
    );
  };

  return (
    <aside className="sidebar">
      <nav className="sidebar__nav" aria-label="主导航">
        {primaryItems.map(renderNavItem)}

        <div className="sidebar__group-label">我的音乐</div>
        {libraryItems.map(renderNavItem)}

        <div className="sidebar__group-label">歌单</div>
        {playlistItems.map(renderNavItem)}
      </nav>

      <div className="sidebar__footer">{renderNavItem({ key: 'settings', icon: <Settings size={17} />, label: '设置', badge: updateAvailable })}</div>
    </aside>
  );
};

export default Sidebar;
