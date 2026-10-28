import React, { useState, useEffect } from 'react';
import { ListMusic, CirclePlus } from 'lucide-react';
import { IpcClient } from '@/renderer/services/IpcClient';
import { createDesktopPlaylistWriter } from '@/renderer/services/playlistWriteAdapter';
import type { DesktopPlaylistWriter } from '@/renderer/services/playlistWriteAdapter';
import { NAME_CONFLICT_COPY } from '@mplayer/core';
import { toast } from '@/renderer/services/toastStore';
import { Button, Dialog, Input, Row, useConfirm } from '@/renderer/ui';
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
  const confirm = useConfirm();

  const loadData = async () => {
    setLoading(true);
    try {
      setPlaylists(await IpcClient.invoke<Playlist[]>('playlist:getAll'));
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
   * 文案来自 core 的 NAME_CONFLICT_COPY（#560）：与移动端批量腿问的是同一句话。
   */
  const addSongsToPlaylist = async (playlistId: number) => {
    setAdding(true);
    try {
      const result = await desktopWriter.add({
        playlistId,
        songs,
        resolveNameConflict: (conflicts) =>
          new Promise<'add' | 'skip'>((resolve) => {
            confirm({
              title: NAME_CONFLICT_COPY.title,
              message: NAME_CONFLICT_COPY.message(conflicts.length),
              okText: NAME_CONFLICT_COPY.confirmText,
              cancelText: NAME_CONFLICT_COPY.cancelText,
              onOk: () => resolve('add'),
              onCancel: () => resolve('skip'),
            });
          }),
      });
      if (!result.ok) throw new Error(result.error || '添加失败');

      if (result.added === 0) {
        toast.info('所有歌曲已存在于该歌单中');
        return;
      }

      const msg = result.skipped > 0
        ? `已跳过 ${result.skipped} 首重复歌曲，添加 ${result.added} 首`
        : `已添加 ${result.added} 首歌曲`;
      toast.success(msg);
      onClose();
      if (onSuccess) onSuccess();
    } catch (_error) {
      toast.error('添加失败，请重试');
    } finally {
      setAdding(false);
    }
  };

  /** 新建歌单后**立即**把本次批量加入该新歌单（一轮写入，不要求用户再点一次）。 */
  const handleCreateAndAdd = async () => {
    const name = newPlaylistName.trim();
    if (!name) return;
    setCreating(true);
    try {
      // #542/#552：整批写入 + 失败回滚都交给 adapter 背后的 core 编排。
      // 不传 resolveNameConflict：新歌单目标快照为空，冲突结构上不可能发生；core 的「默认并入」缺省在此不会触发（#556 评审 A4）。
      const result = await desktopWriter.createAndAdd({ name, songs });
      if (!result.ok) {
        toast.error(result.rolledBack ? '添加失败，已撤销新建的歌单' : result.error || '操作失败，请重试');
        return;
      }
      // #551：成功反馈与关闭三件套——#542 迁移时弄丢了它们（弹层不关闭 / 无提示 / 新歌单不进列表）。
      setNewPlaylistName('');
      toast.success(`已新建歌单「${name}」并添加 ${result.added} 首`);
      onClose();
      if (onSuccess) onSuccess();
    } catch (_error) {
      toast.error('操作失败，请重试');
    } finally {
      setCreating(false);
    }
  };

  if (!isVisible) return null;

  const busy = adding || creating;

  return (
    <Dialog open={isVisible} title="批量加入歌单" onClose={onClose} size="md">
      <div className="add-to-playlist__song">
        <span className="add-to-playlist__cover">
          <ListMusic size={20} color="var(--text-tertiary)" aria-hidden="true" />
        </span>
        <span className="add-to-playlist__meta">
          <span className="add-to-playlist__name">选择 {songs.length} 首歌曲</span>
          <span className="add-to-playlist__artist">
            {songs.slice(0, 2).map((song) => song.name).join('、')}
            {songs.length > 2 ? ` 等${songs.length}首` : ''}
          </span>
        </span>
      </div>

      <div className="add-to-playlist__list">
        {loading ? (
          <div className="add-to-playlist__empty">加载中…</div>
        ) : playlists.length === 0 ? (
          <div className="add-to-playlist__empty">
            <CirclePlus size={28} aria-hidden="true" />
            <span>还没有歌单</span>
            <span>在下方输入名字即可新建</span>
          </div>
        ) : (
          playlists.map((playlist) => (
            <Row
              key={playlist.id}
              icon={<ListMusic size={13} />}
              label={playlist.name}
              detail={playlist.description || '歌单'}
              chevron={!busy}
              disabled={busy}
              onClick={() => void addSongsToPlaylist(playlist.id)}
            />
          ))
        )}
      </div>

      {adding ? <div className="add-to-playlist__status">正在添加歌曲…</div> : null}

      <div className="add-to-playlist__create">
        <Input
          aria-label="新建歌单名称"
          value={newPlaylistName}
          onChange={(e) => setNewPlaylistName(e.target.value)}
          placeholder="新建歌单…"
          disabled={busy}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleCreateAndAdd();
          }}
        />
        <Button
          variant="primary"
          size="sm"
          disabled={busy || !newPlaylistName.trim()}
          onClick={() => void handleCreateAndAdd()}
        >
          {busy ? '处理中…' : `新建并加入 ${songs.length} 首`}
        </Button>
      </div>
    </Dialog>
  );
};

export default BatchAddToPlaylistModal;
