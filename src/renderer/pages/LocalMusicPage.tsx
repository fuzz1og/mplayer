import React, { useEffect } from 'react';
import { FolderOpen, RefreshCw, FolderPlus } from 'lucide-react';
import { useLocalStore } from '@/renderer/store/localStore';
import { usePlayerStore } from '@/renderer/store/playerStore';
import { useFavoriteStore } from '@/renderer/store/favoriteStore';
import SongList from '@/renderer/components/SongList';
import '@/renderer/styles/songlist.css';
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
    <div className="local">
      {/* 页面头部 */}
      <div className="list-page__head">
        <div className="list-page__head-row">
          <div className="list-page__title-group">
            <FolderOpen size={20} color="var(--text-secondary)" />
            <h1 className="list-page__title">本地音乐</h1>
            <span className="list-page__count">{folders.length} 个文件夹 · {songs.length} 首歌</span>
          </div>
          <div className="local__head-actions">
            <button onClick={addFolder} disabled={isScanning} className="list-page__action list-page__action--primary">
              <FolderPlus size={15} />
              {isScanning ? '扫描中...' : '选择文件夹'}
            </button>
            <button onClick={refresh} disabled={isScanning} className="list-page__action">
              <RefreshCw size={15} />
              刷新
            </button>
          </div>
        </div>
      </div>

      {/* 内容区 */}
      <div className="local__main">
        {/* 左侧文件夹列表 */}
        <div className="local__folders">
          <div
            onClick={() => setCurrentFolder(null)}
            className="local__folder"
            data-active={currentFolder === null || undefined}
          >
            全部歌曲 ({songs.length})
          </div>
          {folders.map(folder => (
            <div
              key={folder.path}
              className="local__folder"
              data-active={currentFolder === folder.path || undefined}
              onClick={() => setCurrentFolder(folder.path)}
              onContextMenu={(e) => {
                e.preventDefault();
                if (confirm(`移除文件夹「${folder.name}」？`)) {
                  handleRemoveFolder(folder.path);
                }
              }}
            >
              <span className="local__folder-name">
                <FolderOpen size={15} />
                <span className="local__folder-label">{folder.name}</span>
              </span>
              <span className="local__folder-count">{folder.songCount}</span>
            </div>
          ))}
          {folders.length === 0 && (
            <div className="local__folders-empty">暂无文件夹，点击上方按钮添加</div>
          )}
        </div>

        {/* 右侧歌曲列表 */}
        <div className="local__songs">
          {displayedSongs.length > 0 ? (
            <div className="local__songs-scroll">
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
            <div className="local__empty">
              <FolderOpen size={48} className="local__empty-icon" />
              <div className="local__empty-title">暂无歌曲</div>
              <div>点击上方按钮选择文件夹开始导入音乐</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LocalMusicPage;
