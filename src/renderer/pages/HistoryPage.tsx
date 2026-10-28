import React, { useCallback, useEffect, useState } from 'react';
import { Play, Trash2 } from 'lucide-react';
import { toast } from '@/renderer/services/toastStore';
import { usePlayerStore } from '@/renderer/store/playerStore';
import { useFavoriteStore } from '@/renderer/store/favoriteStore';
import { useDownload } from '@/renderer/hooks/useDownload';
import SongList from '@/renderer/components/SongList';
import { IpcClient } from '@/renderer/services/IpcClient';
import { refreshSongCover } from '@/renderer/utils/songCoverRefresh';
import { Button, Dialog, PageHeader } from '@/renderer/ui';
import type { Song, SongBase } from '@mplayer/core';
import '@/renderer/styles/songlist.css';

const HistoryPage: React.FC = () => {
  const [history, setHistory] = useState<Song[]>([]);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const currentSong = usePlayerStore((s) => s.currentSong);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const play = usePlayerStore((s) => s.play);
  const setCurrentPlaylist = usePlayerStore((s) => s.setCurrentPlaylist);
  const favoriteIds = useFavoriteStore((s) => s.favoriteIds);
  const toggleFavorite = useFavoriteStore((s) => s.toggleFavorite);
  const { download, downloadBatch } = useDownload();

  const loadHistory = async () => {
    try {
      const rows = await IpcClient.invoke<any[]>('history:get', 100);
      const songBases = rows.map((h: any) => h.song as SongBase);
      const uniqueMap = new Map<string, SongBase>();
      songBases.forEach((s: SongBase) => uniqueMap.set(s.id, s));
      // 挂载整表扫荡已退役（#317）：去重后直接上屏——播放/歌词懒解析补 url/lrc，
      // 空封面行由行级 songCoverRefresh 懒兜底
      setHistory(Array.from(uniqueMap.values()) as Song[]);
    } catch (error) {
      console.error('加载播放历史失败:', error);
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

  const handlePlay = async (song: Song, queue: Song[], index: number) => {
    // #697：列表只回传展示队列与索引，建队列归页面
    setCurrentPlaylist(queue, index);
    await play(song);
  };

  // 封面加载失败 → 按 ID 重识别换新封面（历史歌曲封面常为过期签名）
  const handleCoverError = (song: Song) => {
    void refreshSongCover(song).then((cover) => {
      if (!cover) return;
      setHistory((prev) => prev.map((s) => (s.id === song.id ? { ...s, cover } : s)));
    });
  };

  const handlePlayAll = useCallback(() => {
    if (history.length > 0) void handlePlay(history[0], history, 0);
  }, [history, handlePlay]);

  const handleClearHistory = async () => {
    try {
      await IpcClient.invoke<void>('history:clear');
      setHistory([]);
      setConfirmClearOpen(false);
      toast.success('播放历史已清空');
    } catch (error) {
      console.error('清空播放历史失败:', error);
      toast.error('清空失败，请重试');
    }
  };

  const handleAddToPlaylist = (_song: Song) => {
    // SongList 内部的 AddToPlaylistModal 已处理添加逻辑，此处无需额外操作
  };

  return (
    <div className="list-page">
      <PageHeader
        title="最近播放"
        lead={<span className="list-page__count">{history.length} 首歌曲</span>}
        actions={
          <>
            <Button
              variant="primary"
              size="sm"
              icon={<Play size={15} aria-hidden="true" />}
              onClick={handlePlayAll}
              disabled={history.length === 0}
            >
              播放全部
            </Button>
            <Button
              variant="danger"
              size="sm"
              icon={<Trash2 size={15} aria-hidden="true" />}
              onClick={() => setConfirmClearOpen(true)}
              disabled={history.length === 0}
            >
              清空历史
            </Button>
          </>
        }
      />

      <div className="list-page__body">
        <SongList
          density="library"
          showDuration
          songs={history}
          currentSongId={currentSong?.id}
          isPlaying={isPlaying}
          favoriteIds={favoriteIds}
          onPlay={handlePlay}
          onToggleFavorite={toggleFavorite}
          onDownload={download}
          onBatchDownload={downloadBatch}
          onAddToPlaylist={handleAddToPlaylist}
          onCoverError={handleCoverError}
          enableBatchDownload={true}
          enableBatchAddToPlaylist={true}
          emptyText="还没有播放记录，听过的歌会出现在这里"
        />
      </div>

      <Dialog
        open={confirmClearOpen}
        title="清空播放历史"
        size="sm"
        onClose={() => setConfirmClearOpen(false)}
        footer={
          <>
            <Button onClick={() => setConfirmClearOpen(false)}>取消</Button>
            <Button variant="danger" onClick={handleClearHistory}>
              清空
            </Button>
          </>
        }
      >
        清空后无法恢复。播放历史只影响「最近播放」列表，不会删除收藏或歌单。
      </Dialog>
    </div>
  );
};

export default HistoryPage;
