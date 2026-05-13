import React, { useEffect, useState } from 'react';
import { ListMusic, Plus, FolderOpen } from 'lucide-react';
import { Modal, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import { playlistService } from '@/renderer/services/playlistService';
import MusicCard from '@/renderer/components/MusicCard';
import type { Playlist } from '@/shared/types/song';

const PlaylistsPage: React.FC = () => {
  const navigate = useNavigate();
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

  const handleDeletePlaylist = (playlist: Playlist) => {
    Modal.confirm({
      title: '删除歌单',
      content: `确定要删除歌单「${playlist.name}」吗？此操作不可撤销。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await playlistService.deletePlaylist(playlist.id);
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
      await playlistService.createPlaylist(newPlaylistName.trim(), newPlaylistDesc.trim());
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
            <ListMusic size={24} color="var(--accent-color)" />
            <h1 style={{ fontSize: '24px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
              我的歌单
            </h1>
            <span style={{ fontSize: '14px', color: 'var(--text-tertiary)', marginLeft: '8px' }}>
              {playlists.length} 个歌单
            </span>
          </div>
          <button
            onClick={() => setIsModalVisible(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 16px',
              backgroundColor: 'var(--accent-color)',
              color: 'white',
              border: 'none',
              borderRadius: '20px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 500,
            }}
          >
            <Plus size={16} />
            新建歌单
          </button>
        </div>
      </div>

      {/* 歌单列表 */}
      <div style={{ flex: 1, overflow: 'auto', padding: '24px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-tertiary)' }}>
            加载中...
          </div>
        ) : playlists.length === 0 ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '60px 20px',
              color: 'var(--text-tertiary)',
            }}
          >
            <FolderOpen size={48} style={{ marginBottom: '16px', opacity: 0.5 }} />
            <div style={{ fontSize: '16px', marginBottom: '8px' }}>暂无歌单</div>
            <div style={{ fontSize: '14px' }}>点击上方按钮创建第一个歌单</div>
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
              gap: '20px',
            }}
          >
            {playlists.map((playlist) => (
              <MusicCard
                key={playlist.id}
                title={playlist.name}
                subtitle={playlist.description || '暂无描述'}
                onClick={() => navigate(`/playlist/${playlist.id}`)}
                onDelete={() => handleDeletePlaylist(playlist)}
              />
            ))}
          </div>
        )}
      </div>

      {/* 新建歌单弹窗 */}
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
            <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', color: 'var(--text-secondary)' }}>
              歌单名称 *
            </label>
            <input
              type="text"
              value={newPlaylistName}
              onChange={(e) => setNewPlaylistName(e.target.value)}
              placeholder="请输入歌单名称"
              style={{
                width: '100%',
                padding: '8px 12px',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                fontSize: '14px',
              }}
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', color: 'var(--text-secondary)' }}>
              歌单描述
            </label>
            <textarea
              value={newPlaylistDesc}
              onChange={(e) => setNewPlaylistDesc(e.target.value)}
              placeholder="请输入歌单描述（可选）"
              rows={3}
              style={{
                width: '100%',
                padding: '8px 12px',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                fontSize: '14px',
                resize: 'vertical',
              }}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default PlaylistsPage;
