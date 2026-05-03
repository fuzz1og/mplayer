import React from 'react';
import {
  Compass,
  Music,
  Heart,
  History,
  ListMusic,
  Settings,
  Download,
  FolderOpen
} from 'lucide-react';

interface NavItem {
  key: string;
  icon: React.ReactNode;
  label: string;
  children?: NavItem[];
}

interface SidebarProps {
  currentPage: string;
  onPageChange: (page: string) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ currentPage, onPageChange }) => {
  const mainNavItems: NavItem[] = [
    { key: 'discover', icon: <Compass size={18} />, label: '发现音乐' },
  ];

  const myMusicItems: NavItem[] = [
    { key: 'local', icon: <FolderOpen size={18} />, label: '本地音乐' },
    { key: 'download', icon: <Download size={18} />, label: '下载管理' },
    { key: 'favorites', icon: <Heart size={18} />, label: '我的收藏' },
    { key: 'history', icon: <History size={18} />, label: '播放历史' },
  ];

  const playlistItems: NavItem[] = [
    { key: 'playlists', icon: <ListMusic size={18} />, label: '我的歌单' },
  ];

  const handleClick = (key: string) => {
    onPageChange(key);
  };

  const renderNavItem = (item: NavItem) => {
    const isActive = currentPage === item.key;

    return (
      <div
        key={item.key}
        onClick={() => handleClick(item.key)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '10px 16px',
          margin: '2px 8px',
          borderRadius: '6px',
          cursor: 'pointer',
          transition: 'all 0.15s ease',
          backgroundColor: isActive ? 'var(--active-bg)' : 'transparent',
          color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
          fontWeight: isActive ? 500 : 400,
          position: 'relative',
        }}
        onMouseEnter={(e) => {
          if (!isActive) {
            e.currentTarget.style.backgroundColor = 'var(--hover-bg)';
          }
        }}
        onMouseLeave={(e) => {
          if (!isActive) {
            e.currentTarget.style.backgroundColor = 'transparent';
          }
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
              backgroundColor: 'var(--accent-color)',
              borderRadius: '0 2px 2px 0',
            }}
          />
        )}
        <span style={{ display: 'flex', alignItems: 'center' }}>
          {item.icon}
        </span>
        <span style={{ fontSize: '14px' }}>{item.label}</span>
      </div>
    );
  };

  return (
    <aside
      style={{
        width: '200px',
        height: '100%',
        backgroundColor: 'var(--sidebar-bg)',
        borderRight: '1px solid var(--border-color)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Logo */}
      <div
        style={{
          padding: '20px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          borderBottom: '1px solid var(--divider-color)',
        }}
      >
        <div
          style={{
            width: '36px',
            height: '36px',
            borderRadius: '10px',
            background: 'linear-gradient(135deg, #2D3436 0%, #636E72 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Music size={20} color="white" />
        </div>
        <span
          style={{
            fontSize: '18px',
            fontWeight: 600,
            color: 'var(--text-primary)',
            letterSpacing: '0.5px',
          }}
        >
          MPlayer
        </span>
      </div>

      {/* 导航内容 */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '12px 0',
        }}
      >
        {/* 发现音乐 */}
        <div style={{ marginBottom: '8px' }}>
          {mainNavItems.map(renderNavItem)}
        </div>

        {/* 我的音乐 */}
        <div style={{ marginTop: '16px' }}>
          <div
            style={{
              padding: '8px 16px',
              fontSize: '11px',
              color: 'var(--text-tertiary)',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              fontWeight: 500,
            }}
          >
            我的音乐
          </div>
          {myMusicItems.map(renderNavItem)}
        </div>

        {/* 歌单 */}
        <div style={{ marginTop: '16px' }}>
          <div
            style={{
              padding: '8px 16px',
              fontSize: '11px',
              color: 'var(--text-tertiary)',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              fontWeight: 500,
            }}
          >
            歌单
          </div>
          {playlistItems.map(renderNavItem)}
        </div>
      </div>

      {/* 底部设置 */}
      <div
        style={{
          padding: '12px 0',
          borderTop: '1px solid var(--divider-color)',
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
