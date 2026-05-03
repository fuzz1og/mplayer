import React, { useEffect, useState } from 'react';
import { History, Play, Trash2 } from 'lucide-react';
import { ipcRenderer } from 'electron';
import { message } from 'antd';
import { historyService } from '@/renderer/services/historyService';
import { usePlayerStore } from '@/renderer/store/playerStore';
import { useDownloadStore } from '@/renderer/store/downloadStore';
import SongList from '@/renderer/components/SongList';
import type { Song } from '@/shared/types/song';

interface HistoryPageProps {
  onPlay: (song: Song) => void;
  onAddToPlaylist?: (song: Song) => void;
}

const HistoryPage: React.FC<HistoryPageProps> = ({ onPlay, onAddToPlaylist }) => {
  const [history, setHistory] = useState<Song[]>([]);
  const { currentSong, isPlaying } = usePlayerStore();
  const { addSingleDownload } = useDownloadStore();

  const loadHistory = async () => {
    console.log('[HistoryPage] loadHistory 被调用');
    try {
      const songs = await historyService.getHistory(100);
      console.log('[HistoryPage] 获取到历史记录数量:', songs.length);
      console.log('[HistoryPage] 历史记录详情:', songs.map(s => ({ name: s.name, id: s.id })));
      setHistory(songs);
    } catch (error) {
      console.error('[HistoryPage] 加载播放历史失败:', error);
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

  const handleClearAll = async () => {
    try {
      await historyService.clearHistory();
      setHistory([]);
    } catch (error) {
      console.error('清空历史失败:', error);
    }
  };

  const handlePlayAll = () => {
    if (history.length > 0) {
      onPlay(history[0]);
    }
  };

  const handleDownload = async (song: Song) => {
    try {
      const task = await ipcRenderer.invoke('download:start', song);
      if (task) {
        addSingleDownload(task);
      }
    } catch (error) {
      console.error('下载失败:', error);
      message.error('下载失败，请重试');
    }
  };

  const handleBatchDelete = async (selectedSongs: Song[]) => {
    try {
      await Promise.all(selectedSongs.map(song => historyService.removeFromHistory(song.id)));
      await loadHistory();
      message.success(`已成功删除 ${selectedSongs.length} 首歌曲的播放记录`);
    } catch (error) {
      console.error('批量删除失败:', error);
      message.error('批量删除失败，请重试');
    }
  };

  return (
    <div style={{ padding: '24px', height: '100%', overflow: 'auto' }}>
      {/* 页面头部 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: '24px',
          marginBottom: '32px',
          paddingBottom: '24px',
          borderBottom: '1px solid var(--divider-color)',
        }}
      >
        {/* 封面 */}
        <div
          style={{
            width: '180px',
            height: '180px',
            borderRadius: '8px',
            background: 'linear-gradient(135deg, #74B9FF 0%, #0984E3 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 8px 24px rgba(9, 132, 227, 0.3)',
            flexShrink: 0,
          }}
        >
          <History size={64} color="white" />
        </div>

        {/* 信息 */}
        <div style={{ flex: 1, paddingBottom: '8px' }}>
          <div
            style={{
              fontSize: '12px',
              color: 'var(--text-tertiary)',
              textTransform: 'uppercase',
              letterSpacing: '1px',
              marginBottom: '8px',
            }}
          >
            播放记录
          </div>
          <h1
            style={{
              fontSize: '32px',
              fontWeight: 700,
              color: 'var(--text-primary)',
              marginBottom: '12px',
            }}
          >
            播放历史
          </h1>
          <div
            style={{
              fontSize: '14px',
              color: 'var(--text-secondary)',
              marginBottom: '16px',
            }}
          >
            共 {history.length} 首歌曲
          </div>

          {/* 操作按钮 */}
          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={handlePlayAll}
              disabled={history.length === 0}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '10px 24px',
                backgroundColor: history.length > 0 ? 'var(--primary-color)' : 'var(--text-light)',
                color: 'white',
                border: 'none',
                borderRadius: '24px',
                fontSize: '14px',
                fontWeight: 600,
                cursor: history.length > 0 ? 'pointer' : 'not-allowed',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                if (history.length > 0) {
                  e.currentTarget.style.backgroundColor = 'var(--primary-hover)';
                  e.currentTarget.style.transform = 'scale(1.02)';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = history.length > 0 ? 'var(--primary-color)' : 'var(--text-light)';
                e.currentTarget.style.transform = 'scale(1)';
              }}
            >
              <Play size={18} fill="white" />
              播放全部
            </button>

            {history.length > 0 && (
              <button
                onClick={handleClearAll}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '10px 20px',
                  backgroundColor: 'transparent',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '24px',
                  fontSize: '14px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = '#FF6B6B';
                  e.currentTarget.style.color = '#FF6B6B';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--border-color)';
                  e.currentTarget.style.color = 'var(--text-secondary)';
                }}
              >
                <Trash2 size={16} />
                清空历史
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 歌曲列表 */}
      <SongList
        songs={history}
        currentSongId={currentSong?.id}
        isPlaying={isPlaying}
        onPlay={onPlay}
        onDownload={handleDownload}
        showCheckbox={true}
        enableBatchDelete={true}
        onBatchDelete={handleBatchDelete}
        onAddToPlaylist={onAddToPlaylist}
        emptyText="暂无播放记录"
      />
    </div>
  );
};

export default HistoryPage;
