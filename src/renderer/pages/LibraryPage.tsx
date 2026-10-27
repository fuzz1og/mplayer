import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Disc3, FolderOpen, Heart, History, Mic2, Play, Trash2 } from 'lucide-react';
import { useFavoriteStore } from '@/renderer/store/favoriteStore';
import { usePlayerStore } from '@/renderer/store/playerStore';
import { useDownload } from '@/renderer/hooks/useDownload';
import { IpcClient } from '@/renderer/services/IpcClient';
import { toast } from '@/renderer/services/toastStore';
import { refreshSongCover } from '@/renderer/utils/songCoverRefresh';
import SongList from '@/renderer/components/SongList';
import { Button, Group, Row, Section } from '@/renderer/ui';
import type { Song, SongBase } from '@mplayer/core';
import '@/renderer/styles/library.css';

/**
 * 资料库（#685）：1.9.0 把「本地音乐 / 下载管理 / 我的收藏 / 播放历史」四个并列入口收进本页。
 *
 * 采用**聚合视图**而非真合并：本地、收藏、历史各自是独立数据源，删除与移除的语义互不相同。
 * 真合并成一个列表后，用户在某一行的「删除」到底删的是本地文件、收藏记录还是历史记录，
 * 界面上无从判断——所以这里并列展示，各自带自己的操作与说明。
 * 旧入口仍各自可点（每节右上角链接 + 下方分组行），老路由继续可用。
 */
const LibraryPage: React.FC = () => {
  const navigate = useNavigate();
  const favorites = useFavoriteStore((s) => s.favorites);
  const toggleFavorite = useFavoriteStore((s) => s.toggleFavorite);
  const loadFavorites = useFavoriteStore((s) => s.loadFavorites);
  const currentSong = usePlayerStore((s) => s.currentSong);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const play = usePlayerStore((s) => s.play);
  const setCurrentPlaylist = usePlayerStore((s) => s.setCurrentPlaylist);
  const { download } = useDownload();

  const [history, setHistory] = useState<Song[]>([]);

  useEffect(() => {
    loadFavorites();
  }, [loadFavorites]);

  const loadHistory = useCallback(async () => {
    try {
      const rows = await IpcClient.invoke<{ song: SongBase }[]>('history:get', 20);
      // IPC 可能返回 undefined（未实现 / 首次启动）：按空历史处理，不抛错
      const unique = new Map<string, SongBase>();
      (rows ?? []).forEach((row) => { if (row?.song) unique.set(row.song.id, row.song); });
      setHistory(Array.from(unique.values()) as Song[]);
    } catch (error) {
      console.error('加载播放历史失败:', error);
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const favoriteIds = useMemo(() => favorites.map((song) => song.id), [favorites]);
  const recentFavorites = useMemo(() => favorites.slice(0, 20), [favorites]);

  const handlePlayAll = useCallback(async (list: Song[]) => {
    if (list.length === 0) return;
    setCurrentPlaylist(list, 0);
    await play(list[0]);
  }, [play, setCurrentPlaylist]);

  const handleToggleFavorite = useCallback(async (song: Song) => {
    try {
      await toggleFavorite(song);
    } catch (error) {
      console.error('收藏操作失败:', error);
    }
  }, [toggleFavorite]);

  const handleCoverError = useCallback((song: Song) => {
    void refreshSongCover(song).then((cover) => {
      if (!cover) return;
      useFavoriteStore.setState((state) => ({
        favorites: state.favorites.map((item) => (item.id === song.id ? { ...item, cover } : item)),
      }));
    });
  }, []);

  const clearHistory = useCallback(async () => {
    try {
      await IpcClient.invoke('history:clear');
      setHistory([]);
      toast.success('播放历史已清空');
    } catch (error) {
      console.error('清空播放历史失败:', error);
      toast.error('清空失败，请重试');
    }
  }, []);

  const listProps = {
    currentSongId: currentSong?.id,
    isPlaying,
    showIndex: true,
    showAlbum: false,
    favoriteIds,
    onPlay: (song: Song) => void play(song),
    onToggleFavorite: handleToggleFavorite,
    onDownload: (song: Song) => void download(song),
    onCoverError: handleCoverError,
  };

  return (
    <div className="library">
      <header className="library__header">
        <div>
          <h1 className="library__title">资料库</h1>
          <p className="library__subtitle">收藏、最近播放与本地音乐并列；每一行的删除只作用于它自己的来源。</p>
        </div>
      </header>

      <div className="library__body">
        <section className="library__section">
          <div className="library__section-head">
            <h2 className="library__section-title">
              <Heart size={15} aria-hidden="true" />
              我喜欢的音乐
              <span className="library__section-count">{favorites.length} 首</span>
            </h2>
            <div className="library__section-head-actions">
              <Button
                size="sm"
                variant="primary"
                icon={<Play size={13} />}
                disabled={favorites.length === 0}
                onClick={() => void handlePlayAll(favorites)}
              >
                播放全部
              </Button>
              <Link className="library__section-action" to="/favorites">
                打开完整页
              </Link>
            </div>
          </div>

          {recentFavorites.length === 0 ? (
            <div className="library__empty">还没有收藏。在任意列表点小心心就会出现在这里。</div>
          ) : (
            <SongList songs={recentFavorites} {...listProps} />
          )}
        </section>

        <section className="library__section">
          <div className="library__section-head">
            <h2 className="library__section-title">
              <History size={15} aria-hidden="true" />
              最近播放
              <span className="library__section-count">{history.length} 首</span>
            </h2>
            <div className="library__section-head-actions">
              {history.length > 0 && (
                <Button size="sm" variant="danger" icon={<Trash2 size={13} />} onClick={() => void clearHistory()}>
                  清空历史
                </Button>
              )}
              <Link className="library__section-action" to="/history">
                打开完整页
              </Link>
            </div>
          </div>

          {history.length === 0 ? (
            <div className="library__empty">播放过的歌会出现在这里。</div>
          ) : (
            <SongList songs={history} {...listProps} />
          )}
        </section>

        <section className="library__section">
          <div className="library__section-head">
            <h2 className="library__section-title">
              <FolderOpen size={15} aria-hidden="true" />
              本地与浏览
            </h2>
          </div>
          <Section footer="本地曲目的扫描与删除在独立页完成；歌手与专辑按来源聚合，随发现页一起浏览。">
            <Group>
              <Row icon={<FolderOpen size={13} />} label="本地音乐" detail="扫描目录、播放与删除本地曲目" chevron onClick={() => navigate('/local')} />
              <Row icon={<Mic2 size={13} />} label="歌手" detail="浏览已识别的歌手" chevron onClick={() => navigate('/artists')} />
              <Row icon={<Disc3 size={13} />} label="专辑" detail="从歌手页进入专辑详情" chevron onClick={() => navigate('/artists')} />
            </Group>
          </Section>
        </section>
      </div>
    </div>
  );
};

export default LibraryPage;
