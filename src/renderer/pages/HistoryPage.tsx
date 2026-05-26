import React, { useEffect, useState } from 'react';
import { History, Trash2 } from 'lucide-react';
import { message } from 'antd';
import { historyService } from '@/renderer/services/historyService';
import { usePlayerStore } from '@/renderer/store/playerStore';
import { useDownload } from '@/renderer/hooks/useDownload';
import SongList from '@/renderer/components/SongList';
import type { Song } from '@/shared/types/song';

const HistoryPage: React.FC = () => {
  const [history, setHistory] = useState<Song[]>([]);
  const { currentSong, isPlaying, play } = usePlayerStore();
  const { download, downloadBatch } = useDownload();

  const loadHistory = async () => {
    try {
      const songs = await historyService.getHistory(100);
      setHistory(songs);
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

  const handleClearHistory = async () => {
    try {
      await historyService.clearHistory();
      setHistory([]);
      message.success('播放历史已清空');
    } catch (error) {
      console.error('清空播放历史失败:', error);
      message.error('清空失败，请重试');
    }
  };

  const handleAddToPlaylist = (song: Song) => {
    message.success(`已成功将 "${song.name}" 加入歌单！`);
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
            <h1 style={{ fontSize: '24px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
              播放历史
            </h1>
            <span style={{ fontSize: '14px', color: 'var(--text-tertiary)', marginLeft: '8px' }}>
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
              fontSize: '14px',
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
          onPlay={handlePlay}
          onDownload={download}
          onBatchDownload={downloadBatch}
          onAddToPlaylist={handleAddToPlaylist}
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
