import React, { useEffect, useState } from 'react';
import { Plus, FolderOpen } from 'lucide-react';
import { toast } from '@/renderer/services/toastStore';
import { Button, Dialog, Input, PageHeader, useConfirm } from '@/renderer/ui';
import '@/renderer/styles/songlist.css';
import { useNavigate } from 'react-router-dom';
import MusicCard from '@/renderer/components/MusicCard';
import { IpcClient } from '@/renderer/services/IpcClient';
import type { Playlist } from '@mplayer/core';

interface PlaylistCardProps {
  playlist: Playlist;
  onOpen: () => void;
  onDelete: () => void;
}

const PlaylistCard: React.FC<PlaylistCardProps> = ({ playlist, onOpen, onDelete }) => {
  return (
    <MusicCard
      title={playlist.name}
      subtitle={playlist.description || `${playlist.songCount ?? 0} 首歌曲`}
      cover={playlist.cover || ''}
      onClick={onOpen}
      onDelete={onDelete}
    />
  );
};

const PlaylistsPage: React.FC = () => {
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(false);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [newPlaylistDesc, setNewPlaylistDesc] = useState('');

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
    confirm({
      title: '删除歌单',
      message: `确定要删除歌单「${playlist.name}」吗？此操作不可撤销。`,
      okText: '删除',
      danger: true,
      cancelText: '取消',
      onOk: async () => {
        try {
          await IpcClient.invoke<void>('playlist:delete', playlist.id);
          loadData();
        } catch (error) {
          console.error('删除歌单失败:', error);
          toast.error('删除失败，请重试');
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
    <div className="playlists">
      <PageHeader
        title="我的歌单"
        lead={<span className="playlists__lead">{playlists.length} 个歌单 · {totalSongs} 首歌曲</span>}
        actions={
          <Button
            variant="primary"
            size="sm"
            icon={<Plus size={15} aria-hidden="true" />}
            onClick={() => setIsModalVisible(true)}
          >
            新建歌单
          </Button>
        }
      />
      <div className="playlists__scroll">
        {loading ? (
          <div className="playlists__loading">加载中...</div>
        ) : (
          <>
            <div className="playlists__head">
              <span className="playlists__head-title">全部歌单</span>
              <span className="playlists__head-count">{playlists.length} 个</span>
            </div>

            {playlists.length === 0 ? (
              <div className="playlists__empty">
                <FolderOpen size={48} className="playlists__empty-icon" />
                <div className="playlists__empty-title">暂无歌单</div>
                <div>点击上方按钮创建第一个歌单</div>
              </div>
            ) : (
              <div className="playlists__grid">
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

      <Dialog
        open={isModalVisible}
        title="新建歌单"
        onClose={() => {
          setIsModalVisible(false);
          setNewPlaylistName('');
          setNewPlaylistDesc('');
        }}
        size="sm"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setIsModalVisible(false);
                setNewPlaylistName('');
                setNewPlaylistDesc('');
              }}
            >
              取消
            </Button>
            <Button variant="primary" onClick={handleCreatePlaylist}>
              创建
            </Button>
          </>
        }
      >
        <div className="playlist-form">
          <label className="playlist-form__label">
            歌单名称 *
            <Input
              value={newPlaylistName}
              onChange={(e) => setNewPlaylistName(e.target.value)}
              placeholder="请输入歌单名称"
              aria-label="歌单名称"
            />
          </label>
          <label className="playlist-form__label">
            歌单描述
            <textarea
              className="playlist-form__textarea"
              value={newPlaylistDesc}
              onChange={(e) => setNewPlaylistDesc(e.target.value)}
              placeholder="请输入歌单描述（可选）"
              rows={3}
              aria-label="歌单描述"
            />
          </label>
        </div>
      </Dialog>
    </div>
  );
};

export default PlaylistsPage;