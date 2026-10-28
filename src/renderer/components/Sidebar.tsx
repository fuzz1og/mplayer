import React, { useEffect, useState } from 'react';
import { Sparkles, Compass, Heart, History, ListMusic, FolderOpen } from 'lucide-react';
import { useFavoriteStore } from '@/renderer/store/favoriteStore';
import { IpcClient } from '@/renderer/services/IpcClient';
import '@/renderer/styles/sidebar.css';

interface NavItem {
  key: string;
  icon: React.ReactNode;
  label: string;
  /** 右侧计数（原型：我喜欢的音乐 128 / 我的歌单 12）。 */
  count?: number;
}

interface SidebarProps {
  currentPage: string;
  onPageChange: (page: string) => void;
}

/**
 * 侧栏（#694 信息架构）：无品牌块，两段——「发现」（推荐/发现）与「资料库」
 * （我喜欢的音乐/最近播放/我的歌单/本地）。「资料库」只是分组标题，不是页面。
 * 设置不在这里——它是应用级动作，收进标题栏的「设置」文字按钮。
 */
const Sidebar: React.FC<SidebarProps> = ({ currentPage, onPageChange }) => {
  const favoriteCount = useFavoriteStore((s) => s.favorites.length);
  const [playlistCount, setPlaylistCount] = useState<number | undefined>(undefined);

  useEffect(() => {
    let disposed = false;
    IpcClient.invoke<{ id: number }[]>('playlist:getAll')
      .then((list) => {
        if (!disposed && Array.isArray(list)) setPlaylistCount(list.length);
      })
      .catch(() => {
        // 首次启动 / 通道未就绪：不显示计数，不影响导航
      });
    return () => {
      disposed = true;
    };
  }, []);

  const discoverItems: NavItem[] = [
    { key: 'recommend', icon: <Sparkles size={17} />, label: '推荐' },
    { key: 'discover', icon: <Compass size={17} />, label: '发现' },
  ];

  const libraryItems: NavItem[] = [
    { key: 'favorites', icon: <Heart size={17} />, label: '我喜欢的音乐', count: favoriteCount },
    { key: 'history', icon: <History size={17} />, label: '最近播放' },
    { key: 'playlists', icon: <ListMusic size={17} />, label: '我的歌单', count: playlistCount },
    { key: 'local', icon: <FolderOpen size={17} />, label: '本地' },
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
      >
        <span className="sidebar__icon" aria-hidden="true">
          {item.icon}
        </span>
        <span className="sidebar__label">{item.label}</span>
        {item.count != null && item.count > 0 && <span className="sidebar__count">{item.count}</span>}
      </button>
    );
  };

  return (
    <aside className="sidebar">
      <nav className="sidebar__nav" aria-label="主导航">
        <div className="sidebar__group-label">发现</div>
        {discoverItems.map(renderNavItem)}

        <div className="sidebar__group-label">资料库</div>
        {libraryItems.map(renderNavItem)}
      </nav>
    </aside>
  );
};

export default Sidebar;
