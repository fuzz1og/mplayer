import React, { useState, useEffect } from 'react';
import { ListMusic, CirclePlus } from 'lucide-react';
import { classifySong, SOURCE_DISPLAY_NAMES, type DupResult } from '@mplayer/core';
import { IpcClient } from '@/renderer/services/IpcClient';
import { createDesktopPlaylistWriter } from '@/renderer/services/playlistWriteAdapter';
import type { DesktopPlaylistWriter } from '@/renderer/services/playlistWriteAdapter';
import SongCover from '@/renderer/components/SongCover';
import { toast } from '@/renderer/services/toastStore';
import { Button, Dialog, Input, Row, useConfirm } from '@/renderer/ui';
import type { Song, Playlist } from '@mplayer/core';

interface AddToPlaylistModalProps {
  song: Song;
  isVisible: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

/** 桌面唯一的写入 adapter（#552）：IPC 形状与编排都在它后面，这里只留文案与关闭时机。 */
const desktopWriter: DesktopPlaylistWriter = createDesktopPlaylistWriter();

/** 来源中文名（#556 评审 C）：用 core 的 SOURCE_DISPLAY_NAMES，不再本地维护第三份表。 */
function sourceLabelZh(sourceType?: string): string {
  return SOURCE_DISPLAY_NAMES[sourceType ?? ''] ?? '未知';
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
  const confirm = useConfirm();

  const loadData = async () => {
    setLoading(true);
    try {
      const playlistsData = await IpcClient.invoke<Playlist[]>('playlist:getAll');
      setPlaylists(playlistsData);

      const results = new Map<number, DupResult>();
      for (const p of playlistsData) {
        const target = await desktopWriter.readTarget(p.id);
        results.set(p.id, classifySong(target.songs, song));
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

  /** 把「同名异源」交给用户裁决（adapter 的第二个回调）。 */
  const askNameConflict = (existingLabel: string): Promise<'add' | 'skip'> =>
    new Promise((resolve) => {
      confirm({
        title: '同名歌曲',
        message: `该歌单已有同名歌曲「${existingLabel}」，是否继续添加？`,
        okText: '继续添加',
        cancelText: '取消',
        onOk: () => resolve('add'),
        onCancel: () => resolve('skip'),
      });
    });

  const handleAddToPlaylist = async (playlistId: number) => {
    const dup = dupResults.get(playlistId);
    if (dup?.status === 'duplicate') {
      toast.warning('该歌曲已存在于歌单中');
      return;
    }
    try {
      // #552：编排（判据 / 单曲写入 / 同名裁决）全在 adapter 后面；这里只留文案与关闭时机。
      const result = await desktopWriter.add({
        playlistId,
        songs: [song],
        resolveNameConflict: async (conflicts) =>
          askNameConflict(
            `${conflicts[0]?.existingSong?.name ?? song.name}（来自${sourceLabelZh(conflicts[0]?.existingSong?.sourceType)}）`,
          ),
      });
      if (!result.ok) throw new Error(result.error || '添加失败');
      if (result.added === 0) {
        toast.warning('该歌曲已存在于歌单中');
        return;
      }
      toast.success('已添加到歌单');
      onClose();
      if (onSuccess) onSuccess();
    } catch (_error) {
      toast.error('添加失败，请重试');
    }
  };

  const handleCreateAndAdd = async () => {
    if (!newPlaylistName.trim()) return;

    setCreating(true);
    try {
      // 不传 resolveNameConflict：新歌单目标快照为空，冲突结构上不可能发生；core「默认并入」缺省在此不会触发（#556 评审 A4）。
      const result = await desktopWriter.createAndAdd({
        name: newPlaylistName.trim(),
        songs: [song],
      });
      if (!result.ok) {
        toast.error(result.rolledBack ? '添加失败，已撤销新建的歌单' : result.error || '操作失败，请重试');
        return;
      }
      toast.success(`已添加到歌单「${newPlaylistName.trim()}」`);
      onClose();
      if (onSuccess) {
        onSuccess();
      }
    } catch (error) {
      console.error('创建并添加失败:', error);
      toast.error('操作失败，请重试');
    } finally {
      setCreating(false);
    }
  };

  if (!isVisible) return null;

  return (
    <Dialog open={isVisible} title="加入歌单" onClose={onClose} size="md">
      <div className="add-to-playlist__song">
        <span className="add-to-playlist__cover">
          <SongCover src={song.cover} alt={song.name} variant="icon" iconSize={18} />
        </span>
        <span className="add-to-playlist__meta">
          <span className="add-to-playlist__name">{song.name}</span>
          <span className="add-to-playlist__artist">{song.artist}</span>
        </span>
      </div>

      <div className="add-to-playlist__list">
        {loading ? (
          <div className="add-to-playlist__empty">加载中…</div>
        ) : playlists.length === 0 ? (
          <div className="add-to-playlist__empty">
            <CirclePlus size={28} aria-hidden="true" />
            <span>暂无歌单，先新建一个</span>
          </div>
        ) : (
          playlists.map((playlist) => {
            const dup = dupResults.get(playlist.id);
            const isDisabled = dup?.status === 'duplicate';
            const detail =
              dup?.status === 'duplicate'
                ? '已存在'
                : dup?.status === 'nameConflict'
                  ? '同名（不同平台）'
                  : playlist.description || '歌单';
            return (
              <Row
                key={playlist.id}
                disabled={isDisabled}
                icon={<ListMusic size={13} />}
                label={playlist.name}
                detail={detail}
                chevron={!isDisabled}
                onClick={() => void handleAddToPlaylist(playlist.id)}
              />
            );
          })
        )}
      </div>

      <div className="add-to-playlist__create">
        <Input
          aria-label="新建歌单名称"
          value={newPlaylistName}
          onChange={(e) => setNewPlaylistName(e.target.value)}
          placeholder="新建歌单…"
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleCreateAndAdd();
          }}
        />
        <Button
          variant="primary"
          size="sm"
          disabled={creating || !newPlaylistName.trim()}
          onClick={() => void handleCreateAndAdd()}
        >
          {creating ? '创建中…' : '创建并添加'}
        </Button>
      </div>
    </Dialog>
  );
};

export default AddToPlaylistModal;
