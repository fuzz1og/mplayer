import React, { useEffect, useState } from 'react';
import { Sparkles, Compass, Library, Heart, History, ListMusic } from 'lucide-react';
import { useFavoriteStore } from '@/renderer/store/favoriteStore';
import { useLocalStore } from '@/renderer/store/localStore';
import { IpcClient } from '@/renderer/services/IpcClient';
import '@/renderer/styles/sidebar.css';

interface NavItem {
  key: string;
  icon: React.ReactNode;
  label: string;
  /** 右侧计数（原型：全部 1,284 / 我喜欢的音乐 128 / 我的歌单 12）。 */
  count?: number;
}

interface SidebarProps {
  currentPage: string;
  onPageChange: (page: string) => void;
}

/**
 * 侧栏（1.9.0 收口）：无品牌块，顶部直接是 推荐 / 发现 + 「资料库」组
 * （全部 / 我喜欢的音乐 / 最近播放）+ 「歌单」组（我的歌单）。
 * 设置不在这里——它是应用级动作，收进标题栏的「设置」文字按钮。
 */
const Sidebar: React.FC<SidebarProps> = ({ currentPage, onPageChange }) => {
  const favoriteCount = useFavoriteStore((s) => s.favorites.length);
  const localCount = useLocalStore((s) => s.songs.length);
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

  const items: NavItem[] = [
    { key: 'recommend', icon: <Sparkles size={17} />, label: '推荐' },
    { key: 'discover', icon: <Compass size={17} />, label: '发现' },
  ];

  const libraryItems: NavItem[] = [
    { key: 'library', icon: <Library size={17} />, label: '全部', count: favoriteCount + localCount },
    { key: 'favorites', icon: <Heart size={17} />, label: '我喜欢的音乐', count: favoriteCount },
    { key: 'history', icon: <History size={17} />, label: '最近播放' },
  ];

  const playlistItems: NavItem[] = [
    { key: 'playlists', icon: <ListMusic size={17} />, label: '我的歌单', count: playlistCount },
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
        {items.map(renderNavItem)}

        <div className="sidebar__group-label">资料库</div>
        {libraryItems.map(renderNavItem)}

        <div className="sidebar__group-label">歌单</div>
        {playlistItems.map(renderNavItem)}
      </nav>
    </aside>
  );
};

export default Sidebar;
