import React, { useEffect, useState, useCallback, useMemo } from 'react';
import '@/renderer/styles/page-playlist-detail.css';
import '@/renderer/styles/detail-page.css';
import { Play, Edit2, Music, Download, Trash2, Upload, GripVertical, CirclePlus } from 'lucide-react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from '@/renderer/services/toastStore';
import { Button, PageHero, useConfirm } from '@/renderer/ui';
import { usePlayerStore } from '@/renderer/store/playerStore';
import { useFavoriteStore } from '@/renderer/store/favoriteStore';
import { useDownload } from '@/renderer/hooks/useDownload';
import SongCover from '@/renderer/components/SongCover';
import SongRow from '@/renderer/components/SongRow';
import SortableSongRow from '@/renderer/components/SortableSongRow';
import VirtualSortableList from '@/renderer/components/VirtualSortableList';
import { moveItem } from '@/renderer/utils/reorder';
import { reorderVisibleSongs } from '@/renderer/utils/playlistReorder';
import { LIBRARY_ROW_HEIGHT } from '@/renderer/components/songRowMetrics';
import { IpcClient } from '@/renderer/services/IpcClient';
import { COVER_SIZE, type Song, type Playlist } from '@mplayer/core';
import { refreshSongCover } from '@/renderer/utils/songCoverRefresh';
import ImportPlaylistModal from '@/renderer/components/ImportPlaylistModal';
import BatchAddToPlaylistModal from '@/renderer/components/BatchAddToPlaylistModal';
import DetailToolbar from '@/renderer/components/DetailToolbar';
import { useDetailSelection } from '@/renderer/hooks/useDetailSelection';

/** overlay 里的静态拖拽把手：只是视觉延续，不接 dnd（overlay 内容整体 pointer-events: none） */
const previewDragHandle = (
  <span aria-hidden className="playlist-detail__drag-handle">
    <GripVertical size={14} />
  </span>
);


const PlaylistDetailPage: React.FC = () => {
  const confirm = useConfirm();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const playlistId = id ? parseInt(id, 10) : undefined;

  const [songs, setSongs] = useState<Song[]>([]);
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [loading, setLoading] = useState(false);
  const [isEditModalVisible, setIsEditModalVisible] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');

  const currentSong = usePlayerStore((s) => s.currentSong);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const play = usePlayerStore((s) => s.play);
  const setCurrentPlaylist = usePlayerStore((s) => s.setCurrentPlaylist);
  const favoriteIds = useFavoriteStore((s) => s.favoriteIds);
  const toggleFavorite = useFavoriteStore((s) => s.toggleFavorite);
  const { download, downloadBatch } = useDownload();
  const [isReordering, setIsReordering] = useState(false);
  // 过滤 + 按需选择（#699/#703 口径）：普通浏览不显示复选框列，点「选择」才进入批量态
  const selection = useDetailSelection(songs, playlistId);
  const {
    filterQuery, setFilterQuery, isFiltering, visibleSongs, batchMode, toggleBatchMode,
    selectedIds, setSelectedIds, selectedIdSet, selectedSongs, visibleSelectedIds,
    visibleSelectedCount, allVisibleSelected, toggleSelect, selectAllVisible,
  } = selection;
  // 行级归属判断 O(1)：避免每行 favoriteIds includes 扫描
  const favoriteIdSet = useMemo(() => new Set(favoriteIds), [favoriteIds]);
  const [importModalVisible, setImportModalVisible] = useState(false);
  // 批量加入歌单（#694）：弹窗自己走桌面 writer 落盘，本页只负责把**可见**的已选项递进去
  const [addToPlaylistOpen, setAddToPlaylistOpen] = useState(false);
  // 歌单头图直链直渲（恒取 playlist.cover / songs[0].cover）：加载失败由容器渐变兜底
  const detailCoverSrc = (playlist?.cover || songs[0]?.cover) || '';

  // 封面加载失败 → 按 ID 重识别换新封面并更新列表状态（旧封面签名过期后同一 URL 永远失败）
  const handleCoverError = useCallback((song: Song) => {
    void refreshSongCover(song).then((cover) => {
      if (!cover) return;
      setSongs((prev) => prev.map((s) => (s.id === song.id ? { ...s, cover } : s)));
    });
  }, []);

  // 拖拽排序：dnd 事件 → (from, to) 由共享 hook 折算，本页只负责映射回全量序 + 乐观更新 + 落库。
  // 过滤态下 (from, to) 是**可见集合**下标：只重排可见行，非可见歌曲的位置与相对顺序保持不动，
  // 再把完整的 id 序回写 playlist:reorderFull（#488/#703：过滤不应写坏整个歌单顺序）。
  const handleReorder = useCallback(async (oldIndex: number, newIndex: number) => {
    if (!playlistId || oldIndex === newIndex) return;
    const nextSongs = isFiltering
      ? reorderVisibleSongs(songs, visibleSongs, oldIndex, newIndex)
      : moveItem(songs, oldIndex, newIndex);
    const newSongIds = nextSongs.map(s => s.id);

    // Optimistically update UI
    setSongs(nextSongs);

    setIsReordering(true);
    try {
      await IpcClient.invoke<void>('playlist:reorderFull', playlistId, newSongIds);
    } catch (error) {
      console.error('Reorder failed:', error);
      loadData();
    } finally {
      setIsReordering(false);
    }
  }, [playlistId, songs, visibleSongs, isFiltering]);

  const loadData = async () => {
    if (!playlistId) return;

    setLoading(true);
    try {
      const [playlistData, songsData] = await Promise.all([
        IpcClient.invoke<Playlist | undefined>('playlist:get', playlistId),
        IpcClient.invoke<Song[]>('playlist:getSongs', playlistId),
      ]);
      setPlaylist(playlistData || null);
      setSongs(songsData);
      setLoading(false);
    } catch (error) {
      console.error('加载歌单详情失败:', error);
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [playlistId]);

  const handlePlay = useCallback(async (song: Song, queue: Song[], index: number) => {
    setCurrentPlaylist(queue, index);
    await play(song);
  }, [play, setCurrentPlaylist]);

  // 「播放全部 / 下载全部」是**歌单级**动作，不受页内过滤影响（#488 只改展示集合，见上）；
  // 受过滤影响的是「勾选 + 批量栏」那条路径，作用域见 visibleSelectedIds
  const handlePlayAll = async () => {
    if (songs.length > 0) {
      await handlePlay(songs[0], songs, 0);
    }
  };

  const handleDownload = useCallback(async (song: Song) => {
    await download(song);
  }, [download]);

  /** 单曲换源：原位替换本地歌单存储并更新列表 */
  const handleSongSwapped = useCallback(async (original: Song, swapped: Song) => {
    if (playlistId == null) return;
    try {
      await IpcClient.invoke<void>('playlist:replaceSong', playlistId, original.id, swapped);
      setSongs(prev => prev.map(s => s.id === original.id ? swapped : s));
    } catch (error) {
      console.error('换源保存到歌单失败:', error);
      toast.error('换源成功，但保存到本地歌单失败');
    }
  }, [playlistId]);

  const handleDownloadAll = async () => {
    if (songs.length === 0) return;
    try {
      await downloadBatch(songs);
    } catch (_error) {
      toast.error('下载全部失败，请重试');
    }
  };

  const handleBatchDownload = async () => {
    // 过滤态只下载**可见**的已选项（#488）：非过滤态 visibleSongs === songs，行为不变
    const toDownload = visibleSongs.filter(s => selectedIdSet.has(s.id));
    if (toDownload.length === 0) return;
    try {
      await downloadBatch(toDownload);
      toast.success(`已添加 ${toDownload.length} 首歌曲到下载队列`);
    } catch (_error) {
      toast.error('批量下载失败');
    }
  };

  const handleBatchDelete = () => {
    // 只移除**可见**的已选项（#488）：界面只显示这些，落库结果必须与界面一致
    const ids = visibleSelectedIds;
    if (ids.length === 0) return;
    confirm({
      title: '批量移除',
      message: `确定要从歌单移除选中的 ${ids.length} 首歌曲吗？`,
      okText: '移除',
      cancelText: '取消',
      onOk: async () => {
        if (!playlistId) return;
        const removedIdSet = new Set(ids);
        try {
          for (const songId of ids) {
            await IpcClient.invoke<void>('playlist:removeSong', playlistId, songId);
          }
          // 只摘掉被移除的这批：被过滤掉的已选项保留（#488）
          setSelectedIds(selectedIds.filter((songId) => !removedIdSet.has(songId)));
          loadData();
          toast.success(`已移除 ${ids.length} 首歌曲`);
        } catch (_error) {
          toast.error('批量移除失败');
        }
      },
    });
  };

  /** 批量加入歌单：作用域同其他批量动作——只递交可见的已选项（#488） */
  const handleBatchAddToPlaylist = () => {
    if (selectedSongs.length > 0) setAddToPlaylistOpen(true);
  };

  /** 进出选择模式同时收起批量弹窗：旧选择不属于新态，也不该继续挂着。 */
  const handleToggleBatchMode = useCallback(() => {
    toggleBatchMode();
    setAddToPlaylistOpen(false);
  }, [toggleBatchMode]);

  const batchActions = useMemo(() => [
    { key: 'download', label: '批量下载', icon: <Download size={12} />, onClick: handleBatchDownload },
    { key: 'playlist', label: '加入歌单', icon: <CirclePlus size={12} />, onClick: handleBatchAddToPlaylist },
    { key: 'delete', label: '批量移除', icon: <Trash2 size={12} />, danger: true, onClick: handleBatchDelete },
  ], [handleBatchDownload, handleBatchAddToPlaylist, handleBatchDelete]);

  const handleRemoveFromPlaylist = useCallback(async (song: Song) => {
    if (!playlistId) return;
    try {
      await IpcClient.invoke<void>('playlist:removeSong', playlistId, song.id);
      loadData();
      toast.success(`已从歌单移除「${song.name}」`);
    } catch (error) {
      console.error('从歌单移除失败:', error);
      toast.error('移除失败，请重试');
    }
    // 只依赖 playlistId：loadData 每次渲染虽是新身份，但内部只用 playlistId 与稳定的 setState
  }, [playlistId]);

  /**
   * 行 props 里与具体歌曲无关的部分（#445）：sortable 行与**非 sortable 的拖拽预览**必须逐项
   * 一致，而本页比队列页多出 14 个 prop，两份渲染器各抄一遍会静默漂移。
   * 两个渲染函数都从这一份展开，差异只剩「谁注册 useSortable / 谁带静态拖拽把手」。
   */
  const sharedRowProps = useMemo(() => ({
    isPlaying,
    // #699/#703：本地歌单沿用 46px 资料库密度（封面 30px），拖拽预览与虚拟测量取同一行高
    variant: 'library' as const,
    // 点播契约（#697）：当前展示队列 = 可见集合（过滤态即过滤结果），行下标是可见集合内下标
    queue: visibleSongs,
    showCheckbox: batchMode,
    onToggleSelect: toggleSelect,
    showRemoveFromPlaylist: true,
    onRemoveFromPlaylist: handleRemoveFromPlaylist,
    showAlbum: false,
    fillTitle: true,
    onPlay: handlePlay,
    onDownload: handleDownload,
    onSwap: handleSongSwapped,
    onToggleFavorite: toggleFavorite,
    onCoverError: handleCoverError,
  }), [
    isPlaying, visibleSongs, batchMode, toggleSelect, handleRemoveFromPlaylist, handlePlay, handleDownload,
    handleSongSwapped, toggleFavorite, handleCoverError,
  ]);

  const buildRowProps = useCallback((song: Song, index: number) => ({
    ...sharedRowProps,
    song,
    index,
    isCurrentSong: currentSong?.id === song.id,
    isSelected: selectedIdSet.has(song.id),
    isFavorite: favoriteIdSet.has(song.id),
  }), [sharedRowProps, currentSong?.id, selectedIdSet, favoriteIdSet]);

  /** 窗口内的可排序行：useSortable 由 SortableSongRow 内部注册，index 是**全量下标** */
  const renderSongRow = useCallback(
    (song: Song, index: number) => <SortableSongRow {...buildRowProps(song, index)} />,
    [buildRowProps],
  );

  /** 拖拽 overlay 里的同一行：**非 sortable**（同一 id 二次注册会冲突） */
  const renderSongDragPreview = useCallback(
    (song: Song, index: number) => <SongRow {...buildRowProps(song, index)} dragHandle={previewDragHandle} />,
    [buildRowProps],
  );

  const handleEditPlaylist = async () => {
    if (!playlistId || !editName.trim()) return;

    try {
      const playlist = await IpcClient.invoke<Playlist | undefined>('playlist:get', playlistId);
      if (!playlist) throw new Error('歌单不存在');
      await IpcClient.invoke<void>('playlist:update', playlistId, { ...playlist, name: editName.trim(), description: editDesc.trim() });
      setIsEditModalVisible(false);
      loadData();
    } catch (error) {
      console.error('更新歌单失败:', error);
    }
  };

  if (!playlist && !loading) {
    return (
      <div className="playlist-detail__missing">
        <div className="playlist-detail__missing-text">
          歌单不存在
        </div>
        <button
          onClick={() => navigate('/playlists')}
          className="playlist-detail__missing-action"
        >
          返回歌单列表
        </button>
      </div>
    );
  }

  return (
    <div className="detail-page">
      {/* hero 与列表同一滚动上下文（#700/#703）：整页一个滚动容器，标题栏是唯一返回所有者 */}
      <div className="detail-page__scroll" data-scroll-container>
        {playlist && (
          <PageHero
            className="detail-page__hero"
            media={
              <div className="detail-page__cover">
                {/* 占位层（无封面/加载失败时显示），与专辑 / 发现歌单 hero 同一套 */}
                <div className="detail-page__cover-placeholder">
                  <Music size={56} aria-hidden="true" />
                </div>
                <SongCover
                  src={detailCoverSrc}
                  alt={playlist.name}
                  thumbSize={COVER_SIZE.hero}
                  variant="none"
                />
              </div>
            }
            eyebrow={
              <div className="playlist-detail__kind-row">
                <span className="playlist-detail__kind">歌单</span>
                <button
                  type="button"
                  aria-label="编辑歌单"
                  title="编辑歌单"
                  onClick={() => {
                    setEditName(playlist.name);
                    setEditDesc(playlist.description || '');
                    setIsEditModalVisible(true);
                  }}
                  className="playlist-detail__edit"
                >
                  <Edit2 size={13} />
                </button>
              </div>
            }
            title={playlist.name}
            meta={<>{songs.length} 首歌曲{playlist.description ? ` · ${playlist.description}` : ''}</>}
            actions={
              <>
                <Button
                  variant="primary"
                  size="sm"
                  icon={<Play size={15} aria-hidden="true" />}
                  onClick={handlePlayAll}
                  disabled={songs.length === 0}
                >
                  播放全部
                </Button>
                <Button
                  size="sm"
                  icon={<Download size={15} aria-hidden="true" />}
                  onClick={handleDownloadAll}
                  disabled={songs.length === 0}
                >
                  下载全部
                </Button>
                <Button
                  size="sm"
                  icon={<Upload size={15} aria-hidden="true" />}
                  onClick={() => setImportModalVisible(true)}
                >
                  导入歌曲
                </Button>
              </>
            }
          />
        )}

        <div className="detail-page__list">
        {loading && songs.length === 0 ? (
          <div className="playlist-detail__skeleton">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={`sk-${i}`} className="playlist-detail__sk-row">
                <div className="playlist-detail__sk-col">
                  <div className="playlist-detail__sk-bar" />
                </div>
                <div className="playlist-detail__sk-col">
                  <div className="playlist-detail__sk-bar" />
                </div>
                <div className="playlist-detail__sk-col">
                  <div className="playlist-detail__sk-bar playlist-detail__sk-bar--num" />
                </div>
                <div className="playlist-detail__sk-body">
                  <div className="playlist-detail__sk-thumb" />
                  <div className="playlist-detail__sk-lines">
                    <div className="playlist-detail__sk-line" />
                    <div className="playlist-detail__sk-line playlist-detail__sk-line--short" />
                  </div>
                </div>
                <div className="playlist-detail__sk-actions">
                  <div className="playlist-detail__sk-circle" />
                  <div className="playlist-detail__sk-circle" />
                </div>
              </div>
            ))}
          </div>
        ) : songs.length === 0 ? (
          <div className="playlist-detail__empty">
            <Music size={48} />
            <div className="playlist-detail__empty-title">歌单暂无歌曲</div>
            <div className="playlist-detail__empty-hint">去发现音乐添加歌曲吧</div>
          </div>
        ) : (
          /* 窗口化 + 可排序收在共享能力里（#445）：页面不再自建 DndContext/SortableContext，
             也不再 items={songs.map(...)}（每帧新建数组，dnd-kit 的排序下标来源必须是稳定引用）。
             items 传**展示集合**（#488/#703）：过滤态也注册 sortable；handleReorder 负责把可见下标
             映射回全量序，只有可见行互换，非可见行位置不动。 */
          <VirtualSortableList
            items={visibleSongs}
            estimateSize={() => LIBRARY_ROW_HEIGHT}
            header={
              <>
                {/* 页内工具条（#694）：过滤 + 计数 + 选择/完成 同处一行 40px，表头已删（行是 46px library 密度）。
                    高度必须恒定：它是 scrollMargin 的测量锚点，三态（浏览 / 过滤 / 批量）变高会让整表错位且不报错。 */}
                <DetailToolbar
                  filterValue={filterQuery}
                  onFilterChange={setFilterQuery}
                  matchedCount={visibleSongs.length}
                  totalCount={songs.length}
                  selecting={batchMode}
                  onToggleSelecting={handleToggleBatchMode}
                  onSelectAll={selectAllVisible}
                  allSelected={allVisibleSelected}
                  selectedCount={visibleSelectedCount}
                  status={isReordering ? '正在保存排序...' : undefined}
                  batchActions={batchActions}
                />
                {/* 过滤态命中为空：没有可渲染的行，给一句明确的空态（#488） */}
                {isFiltering && visibleSongs.length === 0 && (
                  <div className="detail-toolbar__nomatch">
                    没有匹配「{filterQuery.trim()}」的歌曲
                  </div>
                )}
              </>
            }
            renderRow={renderSongRow}
            renderDragPreview={renderSongDragPreview}
            onReorder={handleReorder}
          />
        )}
        </div>
      </div>

      {/* 编辑歌单弹窗 */}
      {isEditModalVisible && (
        <div
          className="playlist-detail__modal-backdrop"
          onClick={() => setIsEditModalVisible(false)}
        >
          <div
            className="playlist-detail__modal"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="playlist-detail__modal-title">
              编辑歌单
            </h3>
            <div className="playlist-detail__form">
              <div>
                <label className="playlist-detail__label">
                  歌单名称
                </label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="playlist-detail__input"
                />
              </div>
              <div>
                <label className="playlist-detail__label">
                  歌单描述
                </label>
                <textarea
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  rows={3}
                  className="playlist-detail__textarea"
                />
              </div>
            </div>
            <div className="playlist-detail__modal-actions">
              <button
                onClick={() => setIsEditModalVisible(false)}
                className="playlist-detail__modal-btn"
              >
                取消
              </button>
              <button
                onClick={handleEditPlaylist}
                className="playlist-detail__modal-btn playlist-detail__modal-btn--primary"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
      {/* 批量加入歌单：只在有可见已选项时挂载，弹窗按需加载歌单列表 */}
      {batchMode && selectedSongs.length > 0 && (
        <BatchAddToPlaylistModal
          songs={selectedSongs}
          isVisible={addToPlaylistOpen}
          onClose={() => setAddToPlaylistOpen(false)}
        />
      )}
      <ImportPlaylistModal
        open={importModalVisible}
        playlistId={playlistId!}
        existingSongs={songs}
        onClose={() => setImportModalVisible(false)}
        onImported={loadData}
      />
    </div>
  );
};

export default PlaylistDetailPage;
