import React, { useEffect } from 'react';
import { FolderOpen, RefreshCw, FolderPlus } from 'lucide-react';
import { useLocalStore } from '@/renderer/store/localStore';
import { usePlayerStore } from '@/renderer/store/playerStore';
import { useFavoriteStore } from '@/renderer/store/favoriteStore';
import SongList from '@/renderer/components/SongList';
import type { Song } from '@mplayer/core';

const LocalMusicPage: React.FC = () => {
  const folders = useLocalStore((s) => s.folders);
  const songs = useLocalStore((s) => s.songs);
  const currentFolder = useLocalStore((s) => s.currentFolder);
  const isScanning = useLocalStore((s) => s.isScanning);
  const initialize = useLocalStore((s) => s.initialize);
  const addFolder = useLocalStore((s) => s.addFolder);
  const removeFolder = useLocalStore((s) => s.removeFolder);
  const refresh = useLocalStore((s) => s.refresh);
  const setCurrentFolder = useLocalStore((s) => s.setCurrentFolder);
  const favoriteIds = useFavoriteStore((s) => s.favoriteIds);
  const toggleFavorite = useFavoriteStore((s) => s.toggleFavorite);

  const currentSongId = usePlayerStore(state => state.currentSong?.id);
  const isPlaying = usePlayerStore(state => state.isPlaying);

  useEffect(() => {
    initialize();
  }, []);

  const displayedSongs = currentFolder
    ? songs.filter(s => s.url.includes(currentFolder.replace(/\\/g, '/')))
    : songs;

  const handlePlay = (song: Song) => {
    usePlayerStore.getState().play(song);
  };

  const handleRemoveFolder = (path: string) => {
    removeFolder(path);
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 页面头部 */}
      <div
        style={{
          padding: '24px 24px 16px',
          borderBottom: '1px solid var(--border-subtle)',
          backgroundColor: 'var(--bg-surface)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <FolderOpen size={24} color="var(--text-secondary)" />
            <h1 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
              本地音乐
            </h1>
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>
              {folders.length} 个文件夹 · {songs.length} 首歌
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button
              onClick={addFolder}
              disabled={isScanning}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 16px',
                backgroundColor: 'var(--accent)',
                color: 'white',
                border: 'none',
                borderRadius: '20px',
                cursor: isScanning ? 'not-allowed' : 'pointer',
                fontSize: 'var(--text-base)',
                fontWeight: 500,
                opacity: isScanning ? 0.7 : 1,
              }}
            >
              <FolderPlus size={16} />
              {isScanning ? '扫描中...' : '选择文件夹'}
            </button>
            <button
              onClick={refresh}
              disabled={isScanning}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 16px',
                backgroundColor: 'transparent',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-default)',
                borderRadius: '20px',
                cursor: isScanning ? 'not-allowed' : 'pointer',
                fontSize: 'var(--text-base)',
                fontWeight: 500,
                opacity: isScanning ? 0.7 : 1,
              }}
            >
              <RefreshCw size={16} />
              刷新
            </button>
          </div>
        </div>
      </div>

      {/* 内容区 */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* 左侧文件夹列表 */}
        <div
          style={{
            width: '240px',
            borderRight: '1px solid var(--border-default)',
            overflowY: 'auto',
            padding: '16px',
          }}
        >
          <div
            onClick={() => setCurrentFolder(null)}
            style={{
              padding: '10px 12px',
              borderRadius: '6px',
              cursor: 'pointer',
              backgroundColor: currentFolder === null ? 'var(--bg-active)' : 'transparent',
              color: currentFolder === null ? 'var(--text-primary)' : 'var(--text-secondary)',
              fontWeight: currentFolder === null ? 500 : 400,
              marginBottom: '4px',
            }}
          >
            全部歌曲 ({songs.length})
          </div>
          {folders.map(folder => (
            <div
              key={folder.path}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 12px',
                borderRadius: '6px',
                cursor: 'pointer',
                backgroundColor: currentFolder === folder.path ? 'var(--bg-active)' : 'transparent',
                color: currentFolder === folder.path ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontWeight: currentFolder === folder.path ? 500 : 400,
                marginBottom: '4px',
              }}
              onClick={() => setCurrentFolder(folder.path)}
              onContextMenu={(e) => {
                e.preventDefault();
                if (confirm(`移除文件夹「${folder.name}」？`)) {
                  handleRemoveFolder(folder.path);
                }
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                <FolderOpen size={15} style={{ flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{folder.name}</span>
              </span>
              <span style={{ fontSize: '12px', opacity: 0.7 }}>{folder.songCount}</span>
            </div>
          ))}
          {folders.length === 0 && (
            <div style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)', padding: '12px' }}>
              暂无文件夹，点击上方按钮添加
            </div>
          )}
        </div>

        {/* 右侧歌曲列表 */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {displayedSongs.length > 0 ? (
            <div style={{ flex: 1, overflowY: 'auto' }}>
              <SongList
                songs={displayedSongs}
                currentSongId={currentSongId}
                isPlaying={isPlaying}
                favoriteIds={favoriteIds}
                onPlay={handlePlay}
                onToggleFavorite={toggleFavorite}
                showHeader={false}
                emptyText="该文件夹下暂无歌曲"
              />
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                color: 'var(--text-tertiary)',
              }}
            >
              <FolderOpen size={48} style={{ marginBottom: '16px', opacity: 0.5 }} />
              <div style={{ fontSize: '16px', marginBottom: '8px' }}>暂无歌曲</div>
              <div style={{ fontSize: 'var(--text-base)' }}>点击上方按钮选择文件夹开始导入音乐</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LocalMusicPage;
