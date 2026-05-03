import React, { useEffect, useState } from 'react';
import { ListMusic, Plus, FolderOpen, Trash2 } from 'lucide-react';
import { Modal } from 'antd';
import { playlistService } from '@/renderer/services/playlistService';
import MusicCard from '@/renderer/components/MusicCard';
import type { Playlist } from '@/shared/types/song';

interface PlaylistsPageProps {
  onNavigateToPlaylistDetail?: (playlistId?: number) => void;
}

const PlaylistsPage: React.FC<PlaylistsPageProps> = ({ onNavigateToPlaylistDetail }) => {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(false);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [newPlaylistDesc, setNewPlaylistDesc] = useState('');

  const loadData = async () => {
    setLoading(true);
    try {
      const playlistsData = await playlistService.getPlaylists();
      setPlaylists(playlistsData);
    } catch (error) {
      console.error('加载数据失败:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreatePlaylist = async () => {
    if (!newPlaylistName.trim()) return;
    try {
      await playlistService.createPlaylist(newPlaylistName.trim(), newPlaylistDesc.trim() || undefined);
      setIsModalVisible(false);
      setNewPlaylistName('');
      setNewPlaylistDesc('');
      loadData();
    } catch (error) {
      console.error('创建歌单失败:', error);
    }
  };

  const handleDeletePlaylist = async (playlistId: number, playlistName: string) => {
    Modal.confirm({
      title: '删除歌单',
      content: `确定要删除歌单 "${playlistName}" 吗？此操作不可恢复。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await playlistService.deletePlaylist(playlistId);
          loadData();
        } catch (error) {
          console.error('删除歌单失败:', error);
        }
      },
    });
  };

  return (
    <div style={{ padding: '24px', height: '100%', overflow: 'auto' }}>
      {/* 页面头部 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '32px',
          paddingBottom: '24px',
          borderBottom: '1px solid var(--divider-color)',
        }}
      >
        <div>
          <h1
            style={{
              fontSize: '28px',
              fontWeight: 700,
              color: 'var(--text-primary)',
              marginBottom: '8px',
            }}
          >
            我的歌单
          </h1>
          <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
            管理你的音乐收藏
          </p>
        </div>

        <button
          onClick={() => setIsModalVisible(true)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 20px',
            backgroundColor: 'var(--primary-color)',
            color: 'white',
            border: 'none',
            borderRadius: '24px',
            fontSize: '14px',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--primary-hover)';
            e.currentTarget.style.transform = 'scale(1.02)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--primary-color)';
            e.currentTarget.style.transform = 'scale(1)';
          }}
        >
          <Plus size={18} />
          新建歌单
        </button>
      </div>

      {/* 歌单网格 */}
      {loading ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '80px 20px',
            color: 'var(--text-tertiary)',
          }}
        >
          <div style={{ fontSize: '16px' }}>加载中...</div>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: '24px',
          }}
        >
          {/* 普通歌单卡片 */}
          {playlists.length === 0 ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '40px 20px',
                color: 'var(--text-tertiary)',
                gridColumn: '1 / -1',
              }}
            >
              <div
                style={{
                  width: '80px',
                  height: '80px',
                  borderRadius: '50%',
                  backgroundColor: 'var(--hover-bg)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: '20px',
                }}
              >
                <ListMusic size={36} color="var(--text-tertiary)" />
              </div>
              <div style={{ fontSize: '16px', marginBottom: '8px' }}>暂无歌单</div>
              <div style={{ fontSize: '14px' }}>创建你的第一个歌单，整理喜欢的音乐</div>
            </div>
          ) : (
            playlists.map((playlist) => (
              <div key={playlist.id} style={{ position: 'relative' }}>
                <div onClick={() => onNavigateToPlaylistDetail?.(playlist.id)} style={{ cursor: 'pointer' }}>
                  <MusicCard
                    title={playlist.name}
                    subtitle={playlist.description || '歌单'}
                    size="medium"
                  />
                </div>

                {/* 操作按钮 */}
                <div
                  style={{
                    position: 'absolute',
                    top: '8px',
                    right: '8px',
                    display: 'flex',
                    gap: '4px',
                    opacity: 0,
                    transition: 'opacity 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.opacity = '1';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.opacity = '0';
                  }}
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onNavigateToPlaylistDetail?.(playlist.id);
                    }}
                    style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '50%',
                      backgroundColor: 'rgba(255,255,255,0.95)',
                      border: 'none',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                    }}
                  >
                    <FolderOpen size={16} color="var(--text-secondary)" />
                  </button>
                  <button
                    onClick={() => handleDeletePlaylist(playlist.id, playlist.name)}
                    style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '50%',
                      backgroundColor: 'rgba(255,255,255,0.95)',
                      border: 'none',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                    }}
                  >
                    <Trash2 size={16} color="#FF6B6B" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* 新建歌单弹窗 */}
      {isModalVisible && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setIsModalVisible(false)}
        >
          <div
            style={{
              width: '400px',
              backgroundColor: 'var(--content-bg)',
              borderRadius: '12px',
              padding: '24px',
              boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              style={{
                fontSize: '18px',
                fontWeight: 600,
                color: 'var(--text-primary)',
                marginBottom: '20px',
              }}
            >
              新建歌单
            </h3>

            <div style={{ marginBottom: '16px' }}>
              <label
                style={{
                  display: 'block',
                  fontSize: '13px',
                  color: 'var(--text-secondary)',
                  marginBottom: '6px',
                }}
              >
                歌单名称
              </label>
              <input
                type="text"
                placeholder="请输入歌单名称"
                value={newPlaylistName}
                onChange={(e) => setNewPlaylistName(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  fontSize: '14px',
                  outline: 'none',
                  backgroundColor: 'var(--bg-color)',
                }}
              />
            </div>

            <div style={{ marginBottom: '24px' }}>
              <label
                style={{
                  display: 'block',
                  fontSize: '13px',
                  color: 'var(--text-secondary)',
                  marginBottom: '6px',
                }}
              >
                歌单描述（可选）
              </label>
              <textarea
                placeholder="请输入歌单描述"
                value={newPlaylistDesc}
                onChange={(e) => setNewPlaylistDesc(e.target.value)}
                rows={3}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  fontSize: '14px',
                  outline: 'none',
                  backgroundColor: 'var(--bg-color)',
                  resize: 'none',
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setIsModalVisible(false)}
                style={{
                  padding: '8px 16px',
                  backgroundColor: 'transparent',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  fontSize: '14px',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                取消
              </button>
              <button
                onClick={handleCreatePlaylist}
                disabled={!newPlaylistName.trim()}
                style={{
                  padding: '8px 16px',
                  backgroundColor: newPlaylistName.trim() ? 'var(--primary-color)' : 'var(--text-light)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '14px',
                  cursor: newPlaylistName.trim() ? 'pointer' : 'not-allowed',
                  transition: 'all 0.15s ease',
                }}
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PlaylistsPage;
