import React, { useEffect, useState } from 'react';
import { History, Trash2 } from 'lucide-react';
import { message } from 'antd';
import { usePlayerStore } from '@/renderer/store/playerStore';
import { useFavoriteStore } from '@/renderer/store/favoriteStore';
import { useDownload } from '@/renderer/hooks/useDownload';
import SongList from '@/renderer/components/SongList';
import { IpcClient } from '@/renderer/services/IpcClient';
import { callMusicApi } from '@/renderer/services/callMusicApi';
import { mapPacedWithConcurrency } from '@/renderer/utils/async';
import { refreshSongCover } from '@/renderer/utils/songCoverRefresh';
import type { Song, SongBase } from '@mplayer/core';

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
      const uniqueSongs = Array.from(uniqueMap.values());
      // 分批刷新（每批 3 首 + 批间间隔 + 限流退避）：上游服务端对同 IP 有窗口配额
      const results = await mapPacedWithConcurrency(
        uniqueSongs,
        3,
        async (songBase) => {
          const songs = await callMusicApi('searchSongsRouted', `${songBase.name} ${songBase.artist}`, 1, songBase.sourceType);
          if (songs.length > 0) return songs[0];
          return { ...songBase, url: '', cover: '', lrc: '' } as Song;
        },
      );
      // 失败/无结果时回退到原始歌曲对象（保留 id/name/artist），而不是错误对象
      const songsWithCover = results.map((r, i) =>
        r.status === 'fulfilled' ? r.value : { ...uniqueSongs[i], url: '', cover: '', lrc: '' } as Song
      );
      setHistory(songsWithCover);
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
      message.success('播放历史已清空');
    } catch (error) {
      console.error('清空播放历史失败:', error);
      message.error('清空失败，请重试');
    }
  };

  const handleAddToPlaylist = (_song: Song) => {
    // SongList 内部的 AddToPlaylistModal 已处理添加逻辑，此处无需额外操作
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 页面标题 */}
      <div
        style={{
          padding: '24px 24px 16px',
          borderBottom: '1px solid var(--divider-color)',
          backgroundColor: 'var(--content-bg)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <History size={24} color="var(--accent-color)" />
            <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
              播放历史
            </h1>
            <span style={{ fontSize: 'var(--text-base)', color: 'var(--text-tertiary)', marginLeft: '8px' }}>
              {history.length} 首歌曲
            </span>
          </div>
          <button
            onClick={handleClearHistory}
            disabled={history.length === 0}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 16px',
              backgroundColor: 'transparent',
              color: history.length > 0 ? 'var(--text-secondary)' : 'var(--text-tertiary)',
              border: '1px solid var(--border-color)',
              borderRadius: '20px',
              cursor: history.length > 0 ? 'pointer' : 'not-allowed',
              fontSize: 'var(--text-base)',
            }}
          >
            <Trash2 size={16} />
            清空历史
          </button>
        </div>
      </div>

      {/* 歌曲列表 */}
      <div style={{ flex: 1, overflow: 'auto' }}>
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
