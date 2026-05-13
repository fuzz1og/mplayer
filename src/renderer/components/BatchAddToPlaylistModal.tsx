import React, { useState, useEffect } from 'react';
import { X, ListMusic } from 'lucide-react';
import { message, Modal } from 'antd';
import { playlistService } from '@/renderer/services/playlistService';
import { filterDuplicates } from '@/renderer/utils/songDedupe';
import type { Song, Playlist } from '@/shared/types/song';

interface BatchAddToPlaylistModalProps {
  songs: Song[];
  isVisible: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

const BatchAddToPlaylistModal: React.FC<BatchAddToPlaylistModalProps> = ({
  songs,
  isVisible,
  onClose,
  onSuccess
}) => {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const playlistsData = await playlistService.getPlaylists();
      setPlaylists(playlistsData);
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
    setAdding(true);
    try {
      const existingSongs = await playlistService.getPlaylistSongs(playlistId);
      const filtered = filterDuplicates(existingSongs, songs);

      const skipCount = filtered.duplicates.length;
      const conflictCount = filtered.conflicts.length;

      if (filtered.ok.length === 0 && filtered.conflicts.length === 0) {
        message.info('所有歌曲已存在于该歌单中');
        setAdding(false);
        return;
      }

      if (conflictCount > 0) {
        Modal.confirm({
          title: '同名歌曲',
          content: `有 ${conflictCount} 首歌曲同名但来自不同平台，是否继续添加？`,
          okText: '继续添加',
          cancelText: '取消',
          onOk: async () => {
            const toAdd = [...filtered.ok, ...filtered.conflicts];
            for (const song of toAdd) {
              await playlistService.addSongToPlaylist(playlistId, song);
            }
            const msg = skipCount > 0
              ? `已跳过 ${skipCount} 首重复歌曲，添加 ${toAdd.length} 首`
              : `已添加 ${toAdd.length} 首歌曲`;
            message.success(msg);
            onClose();
            if (onSuccess) onSuccess();
          },
        });
        setAdding(false);
        return;
      }

      for (const song of filtered.ok) {
        await playlistService.addSongToPlaylist(playlistId, song);
      }
      const msg = skipCount > 0
        ? `已跳过 ${skipCount} 首重复歌曲，添加 ${filtered.ok.length} 首`
        : `已添加 ${filtered.ok.length} 首歌曲`;
      message.success(msg);
      onClose();
      if (onSuccess) onSuccess();
    } catch (error) {
      message.error('添加失败，请重试');
    } finally {
      setAdding(false);
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
            批量加入歌单
          </h3>
          <button
            onClick={onClose}
            disabled={adding}
            style={{
              border: 'none',
              background: 'transparent',
              cursor: adding ? 'not-allowed' : 'pointer',
              padding: '4px',
              borderRadius: '4px',
              color: 'var(--text-tertiary)',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              if (!adding) {
                e.currentTarget.style.backgroundColor = 'var(--hover-bg)';
                e.currentTarget.style.color = 'var(--text-secondary)';
              }
            }}
            onMouseLeave={(e) => {
              if (!adding) {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.color = 'var(--text-tertiary)';
              }
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
            borderRadius: '8px',
            marginBottom: '20px',
          }}
        >
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '6px',
              overflow: 'hidden',
              backgroundColor: 'var(--bg-color)',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ListMusic size={24} color="var(--text-tertiary)" />
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: '14px',
                fontWeight: 500,
                color: 'var(--text-primary)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              选择 {songs.length} 首歌曲
            </div>
            <div
              style={{
                fontSize: '12px',
                color: 'var(--text-secondary)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                marginTop: '2px',
              }}
            >
              {songs.slice(0, 2).map(song => song.name).join('、')}{songs.length > 2 ? ` 等${songs.length}首` : ''}
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
              <div style={{ fontSize: '14px' }}>加载中...</div>
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
                  <div style={{ fontSize: '14px' }}>暂无歌单</div>
                </div>
              ) : (
                playlists.map((playlist) => (
                  <div
                    key={playlist.id}
                    onClick={() => handleAddToPlaylist(playlist.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      padding: '12px',
                      borderRadius: '8px',
                      cursor: adding ? 'not-allowed' : 'pointer',
                      transition: 'all 0.15s ease',
                      opacity: adding ? 0.7 : 1,
                      pointerEvents: adding ? 'none' : 'auto',
                    }}
                    onMouseEnter={(e) => {
                      if (!adding) {
                        e.currentTarget.style.backgroundColor = 'var(--hover-bg)';
                        e.currentTarget.style.transform = 'translateX(4px)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!adding) {
                        e.currentTarget.style.backgroundColor = 'transparent';
                        e.currentTarget.style.transform = 'translateX(0)';
                      }
                    }}
                  >
                    <div
                      style={{
                        width: '40px',
                        height: '40px',
                        borderRadius: '6px',
                        backgroundColor: 'var(--hover-bg)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <ListMusic size={20} color="var(--text-tertiary)" />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: '14px',
                          fontWeight: 500,
                          color: 'var(--text-primary)',
                        }}
                      >
                        {playlist.name}
                      </div>
                      <div
                        style={{
                          fontSize: '12px',
                          color: 'var(--text-secondary)',
                        }}
                      >
                        {playlist.description || '歌单'}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {adding && (
          <div
            style={{
              marginTop: '16px',
              padding: '12px',
              backgroundColor: 'var(--hover-bg)',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <div style={{ width: '20px', height: '20px', border: '2px solid var(--primary-color)', borderRadius: '50%', borderTopColor: 'transparent', animation: 'spin 1s linear infinite' }} />
            <span style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>正在添加歌曲...</span>
          </div>
        )}

      </div>
    </div>
  );
};

export default BatchAddToPlaylistModal;