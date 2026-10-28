import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AlertCircle, Download, ListPlus, ListMusic, Play, CirclePlus } from 'lucide-react';
import { toast } from '@/renderer/services/toastStore';
import { Button, InfoHint, PageHero, useConfirm } from '@/renderer/ui';
import '@/renderer/styles/songlist.css';
import '@/renderer/styles/detail-page.css';
import SongList from '@/renderer/components/SongList';
import DetailToolbar from '@/renderer/components/DetailToolbar';
import BatchAddToPlaylistModal from '@/renderer/components/BatchAddToPlaylistModal';
import { useDetailSelection } from '@/renderer/hooks/useDetailSelection';
import { createDesktopPlaylistWriter } from '@/renderer/services/playlistWriteAdapter';
import type { DesktopPlaylistWriter } from '@/renderer/services/playlistWriteAdapter';
import { usePlayerStore } from '@/renderer/store/playerStore';
import { useFavoriteStore } from '@/renderer/store/favoriteStore';
import { useDownload } from '@/renderer/hooks/useDownload';
import { callMusicApi } from '@/renderer/services/callMusicApi';
import { resolvePlayableVersionForDesktop } from '@/renderer/services/playableVersionAdapter';
import type { Song, SourceKey, ToplistDetail } from '@mplayer/core';
import { formatPlayCount, pickToplistSongs, TOPLIST_SOURCE_IDS } from '@mplayer/core';

/** 榜单详情页配置：路由 type → 能力面来源 + 榜单组 id（id 契约取自 core，#286）。 */
type HotlistType = 'netease' | 'netease_new' | 'qq' | 'qq_new' | 'kugou' | 'kugou_new';

const HOTLIST_CONFIG: Record<HotlistType, { source: SourceKey; sourceId: number | string; title: string }> = {
  netease: { source: 'netease', sourceId: TOPLIST_SOURCE_IDS.netease.hot, title: '网易云音乐热歌榜' },
  netease_new: { source: 'netease', sourceId: TOPLIST_SOURCE_IDS.netease.new, title: '网易云音乐新歌榜' },
  qq: { source: 'qq', sourceId: TOPLIST_SOURCE_IDS.qq.hot, title: 'QQ音乐热歌榜' },
  qq_new: { source: 'qq', sourceId: TOPLIST_SOURCE_IDS.qq.new, title: 'QQ音乐新歌榜' },
  kugou: { source: 'kugou', sourceId: TOPLIST_SOURCE_IDS.kugou.hot, title: '酷狗音乐热歌榜' },
  kugou_new: { source: 'kugou', sourceId: TOPLIST_SOURCE_IDS.kugou.new, title: '酷狗音乐新歌榜' },
};

/** 桌面唯一的写入 adapter（#552）：新建/批量写入/失败回滚全在它后面。 */
const desktopWriter: DesktopPlaylistWriter = createDesktopPlaylistWriter();

const HotlistDetailPage: React.FC = () => {
  const confirm = useConfirm();
  const { type } = useParams<{ type: HotlistType }>();
  const navigate = useNavigate();
  const hotlistType: HotlistType = type && HOTLIST_CONFIG[type] ? type : 'netease';
  const config = HOTLIST_CONFIG[hotlistType];

  const [hotlist, setHotlist] = useState<Song[]>([]);
  // 榜单元数据（#465 的 getToplistDetail）：Hero 的封面 / 名称 / 简介走这里，缺了再回落到榜首封面
  const [chartMeta, setChartMeta] = useState<ToplistDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingAll, setSavingAll] = useState(false);
  const [addToPlaylistOpen, setAddToPlaylistOpen] = useState(false);

  const play = usePlayerStore((s) => s.play);
  const setCurrentPlaylist = usePlayerStore((s) => s.setCurrentPlaylist);
  const currentSong = usePlayerStore((s) => s.currentSong);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const favoriteIds = useFavoriteStore((s) => s.favoriteIds);
  const toggleFavorite = useFavoriteStore((s) => s.toggleFavorite);
  const { download, downloadBatch } = useDownload();
  const selection = useDetailSelection(hotlist, hotlistType);
  const { visibleSongs, batchMode, selectedIds, setSelectedIds, selectedSongs, visibleSelectedCount } = selection;

  // 加载热榜数据：统一走 IPC 内容方法 getToplists（一次取全组，按 id 拆榜）
  const loadHotlist = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [groups, detail] = await Promise.all([
        callMusicApi('getToplists', config.source),
        // 元数据失败不影响曲目：榜单页先能听，封面/简介缺失走兜底
        callMusicApi('getToplistDetail', config.source, config.sourceId).catch(() => null),
      ]);
      setHotlist(pickToplistSongs(groups, config.source, config.sourceId));
      setChartMeta(detail ?? null);
    } catch (error) {
      console.error(`加载热榜失败:`, error);
      setError('加载热榜失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, [config.source, config.sourceId]);

  useEffect(() => {
    loadHotlist();
  }, [loadHotlist]);

  /**
   * 「保存全部到新歌单」（#493）：确认弹层写明榜单名 + 曲目数，确认后新建本地歌单并一次写入全部曲目。
   * 失败时**删除刚建的空歌单**再报错——不留空歌单（验收标准）。
   */
  const handleSaveAllToNewPlaylist = useCallback(() => {
    if (hotlist.length === 0) return;
    const { title } = config;
    const count = hotlist.length;
    confirm({
      title: '保存全部到新歌单',
      message: `确定把「${title}」的 ${count} 首歌曲保存成新的本地歌单「${title}」吗？`,
      okText: '保存',
      cancelText: '取消',
      onOk: async () => {
        setSavingAll(true);
        try {
          // #552：新建 + 整批写入 + 失败回滚都交给 adapter 背后的 core 编排
          // （整批一次落盘——#493「只触发一次持久化」；failed 时删掉刚建的空歌单）。
          const result = await desktopWriter.createAndAdd({
            name: title,
            songs: hotlist,
            description: `来自榜单: ${title}`,
          });
          if (!result.ok) throw new Error(result.error || '保存失败');
          toast.success(`已保存 ${result.added} 首歌曲到新歌单「${title}」`);
          navigate('/playlists');
        } catch (err) {
          console.error('保存全部到新歌单失败:', err);
          toast.error('保存失败，已取消创建歌单');
        } finally {
          setSavingAll(false);
        }
      },
    });
  }, [config, hotlist, confirm, navigate]);

  const handlePlayAll = useCallback(async () => {
    if (hotlist.length === 0) return;
    setCurrentPlaylist(hotlist, 0);
    await play(await resolvePlayableVersionForDesktop(hotlist[0]));
  }, [hotlist, play, setCurrentPlaylist]);

  const handlePlay = useCallback(async (song: Song, queue: Song[], index: number) => {
    // #697：队列与索引由列表回传，页面统一负责 setQueue + 播放
    setCurrentPlaylist(queue, index);
    // #639 C3：补一个**精确匹配**的可播版本（判据在 core），不再无条件取搜索首条
    await play(await resolvePlayableVersionForDesktop(song));
  }, [play, setCurrentPlaylist]);

  const handleDownloadAll = useCallback(() => {
    if (hotlist.length === 0) return;
    void downloadBatch(hotlist);
  }, [hotlist, downloadBatch]);

  const handleBatchDownload = useCallback(() => {
    if (selectedSongs.length === 0) return;
    void downloadBatch(selectedSongs);
  }, [selectedSongs, downloadBatch]);

  const handleBatchAddToPlaylist = useCallback(() => {
    if (selectedSongs.length > 0) setAddToPlaylistOpen(true);
  }, [selectedSongs]);

  const batchActions = useMemo(() => [
    { key: 'download', label: '批量下载', icon: <Download size={12} />, onClick: handleBatchDownload },
    { key: 'playlist', label: '加入歌单', icon: <CirclePlus size={12} />, onClick: handleBatchAddToPlaylist },
  ], [handleBatchDownload, handleBatchAddToPlaylist]);

  // 封面优先取榜单元数据；该源不给封面时回落到榜首曲目封面，再缺就给榜单图标兜底
  const coverSrc = chartMeta?.coverImgUrl || hotlist[0]?.cover || '';
  const heroTitle = chartMeta?.name || config.title;

  return (
    <div className="detail-page">
      <div className="detail-page__scroll" data-scroll-container>
        <PageHero
          className="detail-page__hero"
          media={
            <div className="detail-page__cover">
              <div className="detail-page__cover-placeholder">
                <ListMusic size={56} />
              </div>
              {coverSrc && (
                <img
                  key={coverSrc}
                  src={coverSrc}
                  alt={config.title}
                  loading="lazy"
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  className="detail-page__cover-img"
                />
              )}
            </div>
          }
          title={heroTitle}
          meta={
            <>
              {[
                `${hotlist.length} 首`,
                chartMeta?.playCount ? `${formatPlayCount(chartMeta.playCount)} 次播放` : '',
              ].filter(Boolean).join(' · ')}
              {chartMeta?.description && <InfoHint label="榜单说明">{chartMeta.description}</InfoHint>}
            </>
          }
          actions={
            <>
              <Button
                variant="primary"
                size="sm"
                icon={<Play size={15} aria-hidden="true" />}
                onClick={() => { void handlePlayAll(); }}
                disabled={hotlist.length === 0 || loading}
              >
                播放全部
              </Button>
              <Button
                size="sm"
                icon={<Download size={15} aria-hidden="true" />}
                onClick={handleDownloadAll}
                disabled={hotlist.length === 0 || loading}
              >
                下载全部
              </Button>
              <Button
                size="sm"
                icon={<ListPlus size={15} aria-hidden="true" />}
                onClick={handleSaveAllToNewPlaylist}
                disabled={hotlist.length === 0 || savingAll}
                title={`把「${config.title}」的 ${hotlist.length} 首歌曲保存到新歌单`}
              >
                {savingAll ? '保存中...' : '保存全部到新歌单'}
              </Button>
            </>
          }
        />

        <div className="detail-page__list">
          {error && hotlist.length === 0 ? (
            <div className="detail-page__error">
              <AlertCircle size={28} className="detail-page__error-icon" />
              <div>{error}</div>
              <button type="button" onClick={() => { void loadHotlist(); }} className="detail-page__error-retry">
                重试
              </button>
            </div>
          ) : (
            <>
              <DetailToolbar
                filterValue={selection.filterQuery}
                onFilterChange={selection.setFilterQuery}
                matchedCount={visibleSongs.length}
                totalCount={hotlist.length}
                selecting={batchMode}
                onToggleSelecting={selection.toggleBatchMode}
                onSelectAll={selection.selectAllVisible}
                allSelected={selection.allVisibleSelected}
                selectedCount={visibleSelectedCount}
                batchActions={batchActions}
              />
              <SongList
                songs={visibleSongs}
                currentSongId={currentSong?.id}
                isPlaying={isPlaying}
                favoriteIds={favoriteIds}
                onPlay={handlePlay}
                onToggleFavorite={toggleFavorite}
                onDownload={download}
                density="library"
                showDuration
                showAlbum={false}
                showCheckbox={batchMode}
                selectedIds={selectedIds}
                onSelectionChange={setSelectedIds}
                loading={loading && hotlist.length === 0}
                emptyText={selection.isFiltering ? `没有匹配「${selection.filterQuery.trim()}」的歌曲` : '暂无热榜歌曲'}
              />
            </>
          )}
        </div>
      </div>
      {/* 批量加入歌单：只在有可见已选项时挂载，弹窗按需加载歌单列表 */}
      {batchMode && selectedSongs.length > 0 && (
        <BatchAddToPlaylistModal
          songs={selectedSongs}
          isVisible={addToPlaylistOpen}
          onClose={() => setAddToPlaylistOpen(false)}
        />
      )}
    </div>
  );
};

export default HotlistDetailPage;
