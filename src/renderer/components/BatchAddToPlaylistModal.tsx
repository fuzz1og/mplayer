import React, { useState, useEffect } from 'react';
import { X, ListMusic } from 'lucide-react';
import { message, Modal } from 'antd';
import { IpcClient } from '@/renderer/services/IpcClient';
import { createDesktopPlaylistWriter } from '@/renderer/services/playlistWriteAdapter';
import type { DesktopPlaylistWriter } from '@/renderer/services/playlistWriteAdapter';
import type { Song, Playlist } from '@mplayer/core';

/** 桌面唯一的写入 adapter（#552）：批量腿走 `playlist:addSongs`（一次落盘一次渲染）。 */
const desktopWriter: DesktopPlaylistWriter = createDesktopPlaylistWriter();

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
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [creating, setCreating] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const playlistsData = await IpcClient.invoke<Playlist[]>('playlist:getAll');
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

  /**
   * 把本次批量加入目标歌单（#552）：判据、批内去重、同名裁决、回滚都在 adapter 后面。
   * 批量腿走 adapter 的 `playlist:addSongs`——整批一次落盘，不再逐首 playlist:addSong。
   */
  const addSongsToPlaylist = async (playlistId: number) => {
    setAdding(true);
    try {
      const result = await desktopWriter.add({
        playlistId,
        songs,
        resolveNameConflict: (conflicts) =>
          new Promise<'add' | 'skip'>((resolve) => {
            Modal.confirm({
              title: '同名歌曲',
              content: `有 ${conflicts.length} 首歌曲同名但来自不同平台，是否继续添加？`,
              okText: '继续添加',
              cancelText: '取消',
              onOk: () => resolve('add'),
              onCancel: () => resolve('skip'),
            });
          }),
      });
      if (!result.ok) throw new Error(result.error || '添加失败');

      if (result.added === 0) {
        message.info('所有歌曲已存在于该歌单中');
        return;
      }

      const msg = result.skipped > 0
        ? `已跳过 ${result.skipped} 首重复歌曲，添加 ${result.added} 首`
        : `已添加 ${result.added} 首歌曲`;
      message.success(msg);
      onClose();
      if (onSuccess) onSuccess();
    } catch (_error) {
      message.error('添加失败，请重试');
    } finally {
      setAdding(false);
    }
  };

  const handleAddToPlaylist = (playlistId: number) => addSongsToPlaylist(playlistId);

  /** 新建歌单后**立即**把本次批量加入该新歌单（一轮写入，不要求用户再点一次） */
  const handleCreateAndAdd = async () => {
    const name = newPlaylistName.trim();
    if (!name) return;
    setCreating(true);
    try {
      // #542/#552：整批写入 + 失败回滚都交给 adapter 背后的 core 编排。
      // 不传 resolveNameConflict：新歌单目标快照为空，结构上不存在同名冲突；
      // core 的「默认并入」缺省在此不会触发（#556 评审 A4——缺省值绝不静默丢弃）。
      const result = await desktopWriter.createAndAdd({ name, songs });
      if (!result.ok) {
        message.error(result.rolledBack ? '添加失败，已撤销新建的歌单' : result.error || '操作失败，请重试');
        return;
      }
      // #551：成功反馈与关闭三件套——8dc86fd（#542）迁移时弄丢了它们，
      // 表现为弹层不关闭、无提示、新歌单不进列表（用户可再点一次造出同名歌单）。
      // 口径与「加入已有歌单」（:100-105）以及单曲版 AddToPlaylistModal 一致。
      setNewPlaylistName('');
      message.success(`已新建歌单「${name}」并添加 ${result.added} 首`);
      onClose();
      if (onSuccess) onSuccess();
    } catch (_error) {
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
          backgroundColor: 'var(--bg-surface)',
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
                e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
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
            backgroundColor: 'var(--bg-hover)',
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
              backgroundColor: 'var(--bg-base)',
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
                  <div style={{ fontSize: '14px' }}>还没有歌单</div>
                  <div style={{ fontSize: '12px', marginTop: '4px' }}>在下方输入名字即可新建</div>
                </div>
              ) : (
                playlists.map((playlist) => (
                  <div
                    key={playlist.id}
                    onClick={() => { if (!adding && !creating) handleAddToPlaylist(playlist.id); }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      padding: '12px',
                      borderRadius: '8px',
                      cursor: adding || creating ? 'not-allowed' : 'pointer',
                      transition: 'all 0.15s ease',
                      opacity: adding || creating ? 0.7 : 1,
                      pointerEvents: adding || creating ? 'none' : 'auto',
                    }}
                    onMouseEnter={(e) => {
                      if (!adding && !creating) {
                        e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
                        e.currentTarget.style.transform = 'translateX(4px)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!adding && !creating) {
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
                        backgroundColor: 'var(--bg-hover)',
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
              backgroundColor: 'var(--bg-hover)',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <div style={{ width: '20px', height: '20px', border: '2px solid var(--accent)', borderRadius: '50%', borderTopColor: 'transparent', animation: 'spin 1s linear infinite' }} />
            <span style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>正在添加歌曲...</span>
          </div>
        )}

        {/* 新建歌单（与单曲版 AddToPlaylistModal 同构）：新建后立即把本次批量写入 */}
        <div style={{
          marginTop: '16px',
          paddingTop: '16px',
          borderTop: '1px solid var(--border-subtle)',
        }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="text"
              value={newPlaylistName}
              onChange={(e) => setNewPlaylistName(e.target.value)}
              placeholder="新建歌单..."
              disabled={adding || creating}
              style={{
                flex: 1,
                padding: '8px 12px',
                border: '1px solid var(--border-default)',
                borderRadius: '6px',
                fontSize: '14px',
                backgroundColor: 'var(--bg-base)',
                color: 'var(--text-primary)',
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateAndAdd();
              }}
            />
            <button
              onClick={handleCreateAndAdd}
              disabled={adding || creating || !newPlaylistName.trim()}
              style={{
                padding: '8px 16px',
                backgroundColor: 'var(--accent)',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                fontSize: '14px',
                cursor: adding || creating || !newPlaylistName.trim() ? 'not-allowed' : 'pointer',
                opacity: adding || creating || !newPlaylistName.trim() ? 0.5 : 1,
              }}
            >
              {creating || adding ? '处理中...' : `新建并加入 ${songs.length} 首`}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};

export default BatchAddToPlaylistModal;