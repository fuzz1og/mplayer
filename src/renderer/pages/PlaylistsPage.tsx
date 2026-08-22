import React, { useEffect, useState } from 'react';
import { Plus, FolderOpen } from 'lucide-react';
import { Modal, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import MusicCard from '@/renderer/components/MusicCard';
import { IpcClient } from '@/renderer/services/IpcClient';
import { useCachedCover } from '@/renderer/services/coverCacheService';
import CoverImage from '@/renderer/components/CoverImage';
import type { Playlist } from '@mplayer/core';

interface PlaylistCardProps {
  playlist: Playlist;
  onOpen: () => void;
  onDelete: () => void;
}

const PlaylistCard: React.FC<PlaylistCardProps> = ({ playlist, onOpen, onDelete }) => {
  const cover = useCachedCover(playlist.cover || '');

  return (
    <MusicCard
      title={playlist.name}
      subtitle={playlist.description || `${playlist.songCount ?? 0} 首歌曲`}
      cover={cover}
      onClick={onOpen}
      onDelete={onDelete}
    />
  );
};

const PlaylistsPage: React.FC = () => {
  const navigate = useNavigate();
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(false);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [newPlaylistDesc, setNewPlaylistDesc] = useState('');

  const heroPlaylist = playlists[0];
  const heroCover = useCachedCover(heroPlaylist?.cover || '');
  const totalSongs = playlists.reduce((sum, playlist) => sum + (playlist.songCount || 0), 0);

  const loadData = async () => {
    setLoading(true);
    try {
      const playlistsData = await IpcClient.invoke<Playlist[]>('playlist:getAll');
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

  const handleDeletePlaylist = (playlist: Playlist) => {
    Modal.confirm({
      title: '删除歌单',
      content: `确定要删除歌单「${playlist.name}」吗？此操作不可撤销。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await IpcClient.invoke<void>('playlist:delete', playlist.id);
          loadData();
        } catch (error) {
          console.error('删除歌单失败:', error);
          message.error('删除失败，请重试');
        }
      },
    });
  };

  const handleCreatePlaylist = async () => {
    if (!newPlaylistName.trim()) return;

    try {
      await IpcClient.invoke<number>('playlist:create', newPlaylistName.trim(), newPlaylistDesc.trim());
      setIsModalVisible(false);
      setNewPlaylistName('');
      setNewPlaylistDesc('');
      loadData();
    } catch (error) {
      console.error('创建歌单失败:', error);
    }
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, overflow: 'auto', padding: '24px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-tertiary)' }}>
            加载中...
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '24px', padding: '24px', borderRadius: '8px', background: 'var(--bg-surface)', border: '1px solid var(--border-default)', marginBottom: '28px' }}>
              <div style={{ width: '140px', height: '140px', borderRadius: '8px', overflow: 'hidden', backgroundColor: 'var(--bg-hover)', flexShrink: 0 }}>
                <CoverImage src={heroCover} alt="" variant="playlist" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--accent)', marginBottom: '6px' }}>我的歌单</div>
                <div style={{ fontSize: '26px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '6px' }}>
                  {playlists.length} 个歌单
                </div>
                <div style={{ fontSize: '13px', color: 'var(--text-tertiary)' }}>
                  {totalSongs} 首歌曲 · 把喜欢的歌都收进来
                </div>
              </div>
              <button
                onClick={() => setIsModalVisible(true)}
                style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 18px', backgroundColor: 'var(--accent)', color: 'white', border: 'none', borderRadius: '20px', cursor: 'pointer', fontSize: '14px', fontWeight: 500, flexShrink: 0 }}
              >
                <Plus size={16} />
                新建歌单
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <span style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>全部歌单</span>
              <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>{playlists.length} 个</span>
            </div>

            {playlists.length === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 20px', color: 'var(--text-tertiary)' }}>
                <FolderOpen size={48} style={{ marginBottom: '16px', opacity: 0.5 }} />
                <div style={{ fontSize: '16px', marginBottom: '8px' }}>暂无歌单</div>
                <div style={{ fontSize: '13px' }}>点击上方按钮创建第一个歌单</div>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '20px' }}>
                {playlists.map((playlist) => (
                  <PlaylistCard
                    key={playlist.id}
                    playlist={playlist}
                    onOpen={() => navigate(`/playlist/${playlist.id}`)}
                    onDelete={() => handleDeletePlaylist(playlist)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <Modal
        title="新建歌单"
        open={isModalVisible}
        onOk={handleCreatePlaylist}
        onCancel={() => {
          setIsModalVisible(false);
          setNewPlaylistName('');
          setNewPlaylistDesc('');
        }}
        okText="创建"
        cancelText="取消"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '16px 0' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', color: 'var(--text-secondary)' }}>歌单名称 *</label>
            <input
              type="text"
              value={newPlaylistName}
              onChange={(e) => setNewPlaylistName(e.target.value)}
              placeholder="请输入歌单名称"
              style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border-default)', borderRadius: '6px', fontSize: '14px' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', color: 'var(--text-secondary)' }}>歌单描述</label>
            <textarea
              value={newPlaylistDesc}
              onChange={(e) => setNewPlaylistDesc(e.target.value)}
              placeholder="请输入歌单描述（可选）"
              rows={3}
              style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border-default)', borderRadius: '6px', fontSize: '14px', resize: 'vertical' }}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default PlaylistsPage;
