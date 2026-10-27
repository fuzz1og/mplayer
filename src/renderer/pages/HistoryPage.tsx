import React, { useEffect, useState } from 'react';
import { History, Trash2 } from 'lucide-react';
import { toast } from '@/renderer/services/toastStore';
import { usePlayerStore } from '@/renderer/store/playerStore';
import { useFavoriteStore } from '@/renderer/store/favoriteStore';
import { useDownload } from '@/renderer/hooks/useDownload';
import SongList from '@/renderer/components/SongList';
import { IpcClient } from '@/renderer/services/IpcClient';
import { refreshSongCover } from '@/renderer/utils/songCoverRefresh';
import type { Song, SongBase } from '@mplayer/core';
import '@/renderer/styles/songlist.css';

const HistoryPage: React.FC = () => {
  const [history, setHistory] = useState<Song[]>([]);
  const currentSong = usePlayerStore((s) => s.currentSong);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const play = usePlayerStore((s) => s.play);
  const favoriteIds = useFavoriteStore((s) => s.favoriteIds);
  const toggleFavorite = useFavoriteStore((s) => s.toggleFavorite);
  const { download, downloadBatch } = useDownload();

  const loadHistory = async () => {
    try {
      const history = await IpcClient.invoke<any[]>('history:get', 100);
      const songBases = history.map((h: any) => h.song as SongBase);
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

  const handlePlay = async (song: Song) => {
    await play(song);
  };

  // 封面加载失败 → 按 ID 重识别换新封面（历史歌曲封面常为过期签名）
  const handleCoverError = (song: Song) => {
    void refreshSongCover(song).then((cover) => {
      if (!cover) return;
      setHistory((prev) => prev.map((s) => (s.id === song.id ? { ...s, cover } : s)));
    });
  };

  const handleClearHistory = async () => {
    try {
      await IpcClient.invoke<void>('history:clear');
      setHistory([]);
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
      {/* 页面标题 */}
      <div className="list-page__head">
        <div className="list-page__head-row">
          <div className="list-page__title-group">
            <History size={20} color="var(--accent)" />
            <h1 className="list-page__title">播放历史</h1>
            <span className="list-page__count">{history.length} 首歌曲</span>
          </div>
          <button onClick={handleClearHistory} disabled={history.length === 0} className="list-page__action">
            <Trash2 size={15} />
            清空历史
          </button>
        </div>
      </div>

      {/* 歌曲列表 */}
      <div className="list-page__body">
        <SongList
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
          showCheckbox={true}
          enableBatchDownload={true}
          enableBatchAddToPlaylist={true}
          emptyText="暂无播放历史"
        />
      </div>
    </div>
  );
};

export default HistoryPage;
