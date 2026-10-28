import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AlertCircle, ListPlus } from 'lucide-react';
import { toast } from '@/renderer/services/toastStore';
import { Button, PageHeader, useConfirm } from '@/renderer/ui';
import '@/renderer/styles/songlist.css';
import SongList from '@/renderer/components/SongList';
import { createDesktopPlaylistWriter } from '@/renderer/services/playlistWriteAdapter';
import type { DesktopPlaylistWriter } from '@/renderer/services/playlistWriteAdapter';
import { usePlayerStore } from '@/renderer/store/playerStore';
import { useFavoriteStore } from '@/renderer/store/favoriteStore';
import { useDownload } from '@/renderer/hooks/useDownload';
import { callMusicApi } from '@/renderer/services/callMusicApi';
import { resolvePlayableVersionForDesktop } from '@/renderer/services/playableVersionAdapter';
import type { Song, SourceKey } from '@mplayer/core';
import { pickToplistSongs, TOPLIST_SOURCE_IDS } from '@mplayer/core';

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingAll, setSavingAll] = useState(false);

  const play = usePlayerStore((s) => s.play);
  const setCurrentPlaylist = usePlayerStore((s) => s.setCurrentPlaylist);
  const currentSong = usePlayerStore((s) => s.currentSong);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const favoriteIds = useFavoriteStore((s) => s.favoriteIds);
  const toggleFavorite = useFavoriteStore((s) => s.toggleFavorite);
  const { download, downloadBatch } = useDownload();

  // 加载热榜数据：统一走 IPC 内容方法 getToplists（一次取全组，按 id 拆榜）
  const loadHotlist = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const groups = await callMusicApi('getToplists', config.source);
      setHotlist(pickToplistSongs(groups, config.source, config.sourceId));
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
  const handleSaveAllToNewPlaylist = () => {
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
  };

  const handlePlayAll = async () => {
    if (hotlist.length === 0) return;
    setCurrentPlaylist(hotlist, 0);
    await play(await resolvePlayableVersionForDesktop(hotlist[0]));
  };

  const handlePlay = async (song: Song, queue: Song[], index: number) => {
    // #697：队列与索引由列表回传，页面统一负责 setQueue + 播放
    setCurrentPlaylist(queue, index);
    // #639 C3：补一个**精确匹配**的可播版本（判据在 core）。此前无条件搜索并取
    // `searchResults[0]`：歌已有 url 时也白搜一次，且会整首顶替成同名不同歌手的歌。
    // 搜索源用歌曲自身来源（等价于 `config.source`，但不依赖页面上下文）。
    await play(await resolvePlayableVersionForDesktop(song));
  };

  return (
    <div className="detail-page">

      {/* 内容区域 */}
      <div className="detail-page__body">
        <PageHeader
          title={config.title}
          lead="实时更新，最热门的 100 首歌曲"
          actions={
            <>
              <Button
                variant="primary"
                size="sm"
                onClick={handlePlayAll}
                disabled={hotlist.length === 0 || loading}
              >
                播放全部
              </Button>
              <Button
                size="sm"
                icon={<ListPlus size={15} aria-hidden="true" />}
                onClick={handleSaveAllToNewPlaylist}
                disabled={hotlist.length === 0 || savingAll}
                title={`把「${config.title}」的 ${hotlist.length} 首歌曲保存到新歌单`}
              >
                {savingAll ? '保存中...' : `保存全部到新歌单（${hotlist.length}）`}
              </Button>
            </>
          }
        />

        {/* 热榜歌曲列表 */}
        {loading ? (
          <div>
            {/* 骨架屏 */}
            {Array.from({ length: 10 }).map((_, index) => (
              <div key={`skeleton-${index}`} className="detail-skeleton__row">
                <div className="detail-skeleton__index">
                  <div className="skeleton-shimmer detail-skeleton__index-bar" />
                </div>
                <div className="detail-skeleton__main">
                  <div className="skeleton-shimmer detail-skeleton__cover" />
                  <div className="detail-skeleton__lines">
                    <div className="skeleton-shimmer detail-skeleton__title" />
                    <div className="skeleton-shimmer detail-skeleton__sub" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="detail-error">
            <AlertCircle size={28} className="detail-error__icon" />
            <div className="detail-error__text">{error}</div>
            <button onClick={() => { loadHotlist(); }} className="detail-error__retry">
              重试
            </button>
          </div>
        ) : (
          <SongList
            songs={hotlist}
            currentSongId={currentSong?.id}
            isPlaying={isPlaying}
            favoriteIds={favoriteIds}
            onPlay={handlePlay}
            onToggleFavorite={toggleFavorite}
            showHeader={true}
            showIndex={true}
            enableBatchDownload={true}
            onDownload={download}
            onBatchDownload={downloadBatch}
            enableBatchAddToPlaylist={true}
            emptyText="暂无热榜歌曲"
          />
        )}
      </div>
    </div>
  );
};

export default HotlistDetailPage;
