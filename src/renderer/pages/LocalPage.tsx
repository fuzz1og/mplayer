import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, FolderOpen, FolderPlus, RefreshCw, X } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import type { Song } from '@mplayer/core';
import { useFavoriteStore } from '@/renderer/store/favoriteStore';
import { useLocalStore } from '@/renderer/store/localStore';
import { usePlayerStore } from '@/renderer/store/playerStore';
import { useDownload } from '@/renderer/hooks/useDownload';
import { toast } from '@/renderer/services/toastStore';
import { refreshSongCover } from '@/renderer/utils/songCoverRefresh';
import SongList from '@/renderer/components/SongList';
import CollectionGrid from '@/renderer/components/CollectionGrid';
import DownloadsDialog from '@/renderer/components/DownloadsDialog';
import { Button, PageHeader, Segmented } from '@/renderer/ui';
import '@/renderer/styles/library.css';

/**
 * 本地（#694）：原「资料库」聚合页的本地段独立成页。
 * 内容库三视角（歌曲/专辑/歌手）+ 导入文件夹 / 扫描 / 空态；下载管理收进页头「已下载」。
 */
const VIEW_OPTIONS = ['歌曲', '专辑', '歌手'];

const LocalPage: React.FC = () => {
  const folders = useLocalStore((s) => s.folders);
  const songs = useLocalStore((s) => s.songs);
  const isScanning = useLocalStore((s) => s.isScanning);
  const scanProgress = useLocalStore((s) => s.scanProgress);
  const currentFolder = useLocalStore((s) => s.currentFolder);
  const initialize = useLocalStore((s) => s.initialize);
  const addFolder = useLocalStore((s) => s.addFolder);
  const removeFolder = useLocalStore((s) => s.removeFolder);
  const refresh = useLocalStore((s) => s.refresh);
  const setCurrentFolder = useLocalStore((s) => s.setCurrentFolder);

  const favoriteIds = useFavoriteStore((s) => s.favoriteIds);
  const toggleFavorite = useFavoriteStore((s) => s.toggleFavorite);
  const updateFavoriteCover = useFavoriteStore((s) => s.updateFavoriteCover);

  const currentSong = usePlayerStore((s) => s.currentSong);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const play = usePlayerStore((s) => s.play);
  const setCurrentPlaylist = usePlayerStore((s) => s.setCurrentPlaylist);
  const { download, downloadBatch } = useDownload();

  const [view, setView] = useState(VIEW_OPTIONS[0]);
  // 旧深链 /download → /local?downloads=1：下载管理是本地页的次级入口，不再独占分段/页面。
  const [searchParams] = useSearchParams();
  const [downloadsOpen, setDownloadsOpen] = useState(() => searchParams.get('downloads') === '1');

  useEffect(() => {
    void initialize();
  }, [initialize]);

  const localDisplayed = useMemo(
    () => (currentFolder
      ? songs.filter((song) => song.url.includes(currentFolder.replace(/\\/g, '/')))
      : songs),
    [songs, currentFolder],
  );

  const handlePlay = useCallback((song: Song, queue: Song[], index: number) => {
    setCurrentPlaylist(queue, index);
    void play(song);
  }, [play, setCurrentPlaylist]);

  const handlePlayCollection = useCallback((groupSongs: Song[], index: number) => {
    const song = groupSongs[index];
    if (song) handlePlay(song, groupSongs, index);
  }, [handlePlay]);

  const handleToggleFavorite = useCallback(async (song: Song) => {
    try {
      await toggleFavorite(song);
    } catch (error) {
      console.error('收藏操作失败:', error);
    }
  }, [toggleFavorite]);

  const handleCoverError = useCallback((song: Song) => {
    void refreshSongCover(song).then((cover) => {
      if (cover) updateFavoriteCover(song.id, cover);
    });
  }, [updateFavoriteCover]);

  const handleAddFolder = useCallback(() => {
    void addFolder().catch((error) => {
      console.error('导入本地文件夹失败:', error);
      toast.error('导入失败，请重试');
    });
  }, [addFolder]);

  const handleRefresh = useCallback(() => {
    void refresh().catch((error) => {
      console.error('扫描本地文件夹失败:', error);
      toast.error('扫描失败，请重试');
    });
  }, [refresh]);

  const handleRemoveFolder = useCallback((folderPath: string, folderName: string) => {
    void removeFolder(folderPath).then(() => toast.success('已移除「' + folderName + '」'));
  }, [removeFolder]);

  return (
    <div className="library">
      <PageHeader
        className="library__header"
        title="本地"
        lead={
          <span className="library__stats">
            {localDisplayed.length} 首 · {folders.length} 个文件夹
          </span>
        }
        actions={
          <>
            <Button
              size="sm"
              icon={<Download size={15} aria-hidden="true" />}
              onClick={() => setDownloadsOpen(true)}
            >
              已下载
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={<FolderPlus size={15} aria-hidden="true" />}
              onClick={handleAddFolder}
              disabled={isScanning}
            >
              导入文件夹
            </Button>
          </>
        }
      />

      <div className="library__tabs-row">
        <Segmented
          options={VIEW_OPTIONS}
          value={view}
          onChange={setView}
          ariaLabel="本地视图"
        />
      </div>

      <div className="library__scroll">
        <div className="library__chips">
          <button
            type="button"
            className="library__chip"
            data-active={currentFolder === null || undefined}
            onClick={() => setCurrentFolder(null)}
          >
            全部歌曲
            <span className="library__chip-count">{songs.length}</span>
          </button>
          {folders.map((folder) => (
            <span key={folder.path} className="library__chip-wrap">
              <button
                type="button"
                className="library__chip"
                data-active={currentFolder === folder.path || undefined}
                onClick={() => setCurrentFolder(folder.path)}
              >
                <FolderOpen size={14} aria-hidden="true" />
                {folder.name}
                <span className="library__chip-count">{folder.songCount}</span>
              </button>
              <button
                type="button"
                className="library__chip-remove"
                aria-label={'移除文件夹: ' + folder.name}
                onClick={() => handleRemoveFolder(folder.path, folder.name)}
              >
                <X size={12} aria-hidden="true" />
              </button>
            </span>
          ))}
          <button type="button" className="library__chip" onClick={handleAddFolder} disabled={isScanning}>
            <FolderPlus size={14} aria-hidden="true" />
            添加文件夹
          </button>
          <button type="button" className="library__chip" onClick={handleRefresh} disabled={isScanning}>
            <RefreshCw size={14} aria-hidden="true" />
            扫描
          </button>
          {isScanning && (
            <span className="library__scan">
              扫描中{scanProgress ? ' ' + scanProgress.current + '/' + scanProgress.total : ''}…
            </span>
          )}
        </div>

        {view === '歌曲' ? (
          <div className="library__card">
            <SongList
              density="library"
              showHeader
              showDuration
              songs={localDisplayed}
              currentSongId={currentSong?.id}
              isPlaying={isPlaying}
              favoriteIds={favoriteIds}
              onPlay={handlePlay}
              onToggleFavorite={handleToggleFavorite}
              onDownload={download}
              onBatchDownload={downloadBatch}
              onCoverError={handleCoverError}
              enableBatchDownload={true}
              enableBatchAddToPlaylist={true}
              loading={isScanning && localDisplayed.length === 0}
              emptyText="还没有本地歌曲——导入一个音乐目录后会自动出现在这里。"
            />
          </div>
        ) : (
          <CollectionGrid
            view={view === '专辑' ? 'albums' : 'artists'}
            songs={localDisplayed}
            onPlayCollection={handlePlayCollection}
          />
        )}

        <div className="library__footnote">移除文件夹只会从本地库移除索引，不会删除磁盘上的文件。</div>
      </div>

      <DownloadsDialog open={downloadsOpen} onClose={() => setDownloadsOpen(false)} />
    </div>
  );
};

export default LocalPage;
