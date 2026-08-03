import React, { useState, useEffect } from 'react';
import { X, ListMusic } from 'lucide-react';
import { message, Modal } from 'antd';
import { checkDuplicate, type DupResult } from '@mplayer/core';
import { IpcClient } from '@/renderer/services/IpcClient';
import type { Song, Playlist } from '@mplayer/core';

interface AddToPlaylistModalProps {
  song: Song;
  isVisible: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

async function addSongToPlaylist(playlistId: number, song: Song): Promise<number> {
  const playlist = await IpcClient.invoke<Playlist | undefined>('playlist:get', playlistId);
  if (!playlist) throw new Error('歌单不存在');
  return IpcClient.invoke<number>('playlist:addSong', playlistId, song);
}

const AddToPlaylistModal: React.FC<AddToPlaylistModalProps> = ({
  song,
  isVisible,
  onClose,
  onSuccess
}) => {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [creating, setCreating] = useState(false);
  const [dupResults, setDupResults] = useState<Map<number, DupResult>>(new Map());

  const loadData = async () => {
    setLoading(true);
    try {
      const playlistsData = await IpcClient.invoke<Playlist[]>('playlist:getAll');
      setPlaylists(playlistsData);

      const results = new Map<number, DupResult>();
      for (const p of playlistsData) {
        const songs = await IpcClient.invoke<Song[]>('playlist:getSongs', p.id);
        results.set(p.id, checkDuplicate(songs, song));
      }
      setDupResults(results);
    } catch (error) {
      console.error('加载歌单失败:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isVisible) {
      loadData();
    }
  }, [isVisible]);

  const handleAddToPlaylist = async (playlistId: number) => {
    const dup = dupResults.get(playlistId);
    if (dup?.status === 'duplicate') {
      message.warning('该歌曲已存在于歌单中');
      return;
    }
    if (dup?.status === 'nameConflict') {
      Modal.confirm({
        title: '同名歌曲',
        content: `该歌单已有同名歌曲「${song.name}」（来自${dup.existingSong?.sourceType === 'netease' ? '网易云' : dup.existingSong?.sourceType === 'kugou' ? '酷狗' : dup.existingSong?.sourceType === 'kuwo' ? '酷我' : dup.existingSong?.sourceType === 'qianqian' ? '千千' : dup.existingSong?.sourceType === 'soda' ? '汽水' : 'QQ'}），是否继续添加？`,
        okText: '继续添加',
        cancelText: '取消',
        onOk: async () => {
          try {
            await addSongToPlaylist(playlistId, song);
            message.success(`已添加到歌单`);
            onClose();
            if (onSuccess) onSuccess();
          } catch (_error) {
            message.error('添加失败，请重试');
          }
        },
      });
      return;
    }

    try {
      await addSongToPlaylist(playlistId, song);
      onClose();
      if (onSuccess) onSuccess();
    } catch (_error) {
      message.error('添加失败，请重试');
    }
  };

  const handleCreateAndAdd = async () => {
    if (!newPlaylistName.trim()) return;

    setCreating(true);
    try {
      const newId = await IpcClient.invoke<number>('playlist:create', newPlaylistName.trim());
      await addSongToPlaylist(newId, song);
      message.success(`已添加到歌单「${newPlaylistName.trim()}」`);
      onClose();
      if (onSuccess) {
        onSuccess();
      }
    } catch (error) {
      console.error('创建并添加失败:', error);
      message.error('操作失败，请重试');
    } finally {
      setCreating(false);
    }
  };

  if (!isVisible) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        animation: 'fadeIn 0.2s ease',
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: 'var(--content-bg)',
          borderRadius: '12px',
          padding: '24px',
          width: '420px',
          maxWidth: '90vw',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)',
          animation: 'slideInDown 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '20px',
          }}
        >
          <h3
            style={{
              fontSize: '18px',
              fontWeight: 600,
              color: 'var(--text-primary)',
              margin: 0,
            }}
          >
            加入歌单
          </h3>
          <button
            onClick={onClose}
            style={{
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              padding: '4px',
              borderRadius: '4px',
              color: 'var(--text-tertiary)',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--hover-bg)';
              e.currentTarget.style.color = 'var(--text-secondary)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.color = 'var(--text-tertiary)';
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* 歌曲信息 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '12px',
            backgroundColor: 'var(--hover-bg)',
            borderRadius: 'var(--radius-md)',
            marginBottom: '20px',
          }}
        >
          {/* 封面 */}
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '6px',
              overflow: 'hidden',
              backgroundColor: 'var(--bg-color)',
              flexShrink: 0,
            }}
          >
            {song.cover ? (
              <img
                src={song.cover}
                alt={song.name}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'linear-gradient(135deg, var(--border-color) 0%, var(--divider-color) 100%)',
                }}
              >
                <ListMusic size={20} color="#999" />
              </div>
            )}
          </div>

          {/* 歌曲信息 */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 'var(--text-base)',
                fontWeight: 500,
                color: 'var(--text-primary)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {song.name}
            </div>
            <div
              style={{
                fontSize: 'var(--text-xs)',
                color: 'var(--text-secondary)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                marginTop: '2px',
              }}
            >
              {song.artist}
            </div>
          </div>
        </div>

        {/* 歌单列表 */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
          }}
        >
          {loading ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '40px 20px',
                color: 'var(--text-tertiary)',
              }}
            >
              <div style={{ fontSize: 'var(--text-base)' }}>加载中...</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {/* 普通歌单 */}
              {playlists.length === 0 ? (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '40px 20px',
                    color: 'var(--text-tertiary)',
                  }}
                >
                  <ListMusic size={32} style={{ marginBottom: '12px' }} />
                  <div style={{ fontSize: 'var(--text-base)' }}>暂无歌单</div>
                </div>
              ) : (
                playlists.map((playlist) => {
                  const dup = dupResults.get(playlist.id);
                  const isDisabled = dup?.status === 'duplicate';
                  return (
                    <div
                      key={playlist.id}
                      onClick={() => !isDisabled && handleAddToPlaylist(playlist.id)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '12px', padding: '12px',
                        borderRadius: 'var(--radius-md)', cursor: isDisabled ? 'not-allowed' : 'pointer',
                        transition: 'all 0.15s ease', opacity: isDisabled ? 0.5 : 1,
                      }}
                      onMouseEnter={(e) => {
                        if (!isDisabled) {
                          e.currentTarget.style.backgroundColor = 'var(--hover-bg)';
                          e.currentTarget.style.transform = 'translateX(4px)';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isDisabled) {
                          e.currentTarget.style.backgroundColor = 'transparent';
                          e.currentTarget.style.transform = 'translateX(0)';
                        }
                      }}
                    >
                      <div style={{ width: '40px', height: '40px', borderRadius: '6px', backgroundColor: 'var(--hover-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <ListMusic size={20} color={isDisabled ? 'var(--text-tertiary)' : 'var(--text-primary)'} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 'var(--text-base)', fontWeight: 500, color: isDisabled ? 'var(--text-tertiary)' : 'var(--text-primary)' }}>
                          {playlist.name}
                        </div>
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          {dup?.status === 'duplicate' && <span style={{ color: 'var(--danger-color)' }}>已存在</span>}
                          {dup?.status === 'nameConflict' && <span style={{ color: '#F0A500' }}>同名（不同平台）</span>}
                          {(!dup || dup?.status === 'ok') && (playlist.description || '歌单')}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* 新建歌单 */}
        <div style={{
          marginTop: '16px',
          paddingTop: '16px',
          borderTop: '1px solid var(--divider-color)',
        }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="text"
              value={newPlaylistName}
              onChange={(e) => setNewPlaylistName(e.target.value)}
              placeholder="新建歌单..."
              style={{
                flex: 1,
                padding: '8px 12px',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                fontSize: 'var(--text-base)',
                backgroundColor: 'var(--bg-color)',
                color: 'var(--text-primary)',
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateAndAdd();
              }}
            />
            <button
              onClick={handleCreateAndAdd}
              disabled={creating || !newPlaylistName.trim()}
              style={{
                padding: '8px 16px',
                backgroundColor: 'var(--accent-color)',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                fontSize: 'var(--text-base)',
                cursor: creating || !newPlaylistName.trim() ? 'not-allowed' : 'pointer',
                opacity: creating || !newPlaylistName.trim() ? 0.5 : 1,
              }}
            >
              {creating ? '创建中...' : '创建并添加'}
            </button>
          </div>
        </div>
      </div>

    </div>
  );
};

export default AddToPlaylistModal;
