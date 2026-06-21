import React from 'react';
import {
  Compass,
  Heart,
  History,
  ListMusic,
  Settings,
  Download,
  FolderOpen,
  Headphones,
  Mic2
} from 'lucide-react';

interface NavItem {
  key: string;
  icon: React.ReactNode;
  label: string;
}

interface SidebarProps {
  currentPage: string;
  onPageChange: (page: string) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ currentPage, onPageChange }) => {
  const mainNavItems: NavItem[] = [
    { key: 'discover', icon: <Compass size={18} />, label: '发现音乐' },
    { key: 'artists', icon: <Mic2 size={18} />, label: '歌手' },
  ];

  const myMusicItems: NavItem[] = [
    { key: 'local', icon: <FolderOpen size={18} />, label: '本地音乐' },
    { key: 'download', icon: <Download size={18} />, label: '下载管理' },
    { key: 'favorites', icon: <Heart size={18} />, label: '我的收藏' },
    { key: 'history', icon: <History size={18} />, label: '播放历史' },
  ];

  const playlistItems: NavItem[] = [
    { key: 'playlists', icon: <ListMusic size={18} />, label: '我的歌单' },
    { key: 'queue', icon: <Headphones size={18} />, label: '试听列表' },
  ];

  const navItemStyle = (isActive: boolean): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-3)',
    padding: '9px var(--space-4)',
    margin: '1px var(--space-2)',
    borderRadius: 'var(--radius-sm)',
    cursor: 'pointer',
    transition: 'background var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out)',
    backgroundColor: isActive ? 'var(--bg-active)' : 'transparent',
    color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
    fontWeight: isActive ? 'var(--weight-medium)' : 'var(--weight-normal)',
    fontSize: 'var(--text-sm)',
    position: 'relative',
    border: 'none',
    width: 'calc(100% - var(--space-4))',
    textAlign: 'left' as const,
  });

  const sectionLabelStyle: React.CSSProperties = {
    padding: 'var(--space-2) var(--space-4)',
    fontSize: 'var(--text-xs)',
    color: 'var(--text-tertiary)',
    fontWeight: 'var(--weight-semibold)',
    letterSpacing: '0.5px',
    textTransform: 'uppercase' as const,
    userSelect: 'none',
  };

  const renderNavItem = (item: NavItem) => {
    const isActive = currentPage === item.key;

    return (
      <button
        key={item.key}
        onClick={() => onPageChange(item.key)}
        style={navItemStyle(isActive)}
        aria-current={isActive ? 'page' : undefined}
        onMouseEnter={(e) => {
          if (!isActive) e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
        }}
        onMouseLeave={(e) => {
          if (!isActive) e.currentTarget.style.backgroundColor = 'transparent';
        }}
      >
        {isActive && (
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: '50%',
              transform: 'translateY(-50%)',
              width: '3px',
              height: '16px',
              backgroundColor: 'var(--accent)',
              borderRadius: 'var(--radius-full)',
            }}
          />
        )}
        <span style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          {item.icon}
        </span>
        <span>{item.label}</span>
      </button>
    );
  };

  return (
    <aside
      style={{
        width: 'var(--sidebar-width)',
        height: '100%',
        backgroundColor: 'var(--bg-sidebar)',
        borderRight: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      {/* Logo */}
      <div
        style={{
          padding: 'var(--space-5) var(--space-4)',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
        }}
      >
        <img
          src="/icon.png"
          alt="MPlayer"
          style={{
            width: '36px',
            height: '36px',
            borderRadius: 'var(--radius-md)',
            objectFit: 'contain',
          }}
        />
        <span
          style={{
            fontSize: 'var(--text-lg)',
            fontWeight: 'var(--weight-bold)',
            color: 'var(--text-primary)',
            letterSpacing: '-0.3px',
          }}
        >
          MPlayer
        </span>
      </div>

      {/* 导航内容 */}
      <nav
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 'var(--space-2) 0',
        }}
        aria-label="主导航"
      >
        {/* 发现音乐 */}
        <div>{mainNavItems.map(renderNavItem)}</div>

        {/* 我的音乐 */}
        <div style={{ marginTop: 'var(--space-4)' }}>
          <div style={sectionLabelStyle}>我的音乐</div>
          {myMusicItems.map(renderNavItem)}
        </div>

        {/* 歌单 */}
        <div style={{ marginTop: 'var(--space-4)' }}>
          <div style={sectionLabelStyle}>歌单</div>
          {playlistItems.map(renderNavItem)}
        </div>
      </nav>

      {/* 底部设置 */}
      <div
        style={{
          padding: 'var(--space-2) 0',
          marginTop: 'auto',
        }}
      >
        {renderNavItem({
          key: 'settings',
          icon: <Settings size={18} />,
          label: '设置',
        })}
      </div>
    </aside>
  );
};

export default Sidebar;
