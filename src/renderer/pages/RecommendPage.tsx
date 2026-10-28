import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ListMusic, Play, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  COVER_SIZE,
  formatPlayCount,
  pickRandomBatch,
  type DiscoverPlaylist,
  type Song,
} from '@mplayer/core';
import { Button, PageHeader } from '@/renderer/ui';
import SongList from '@/renderer/components/SongList';
import SongCover from '@/renderer/components/SongCover';
import { usePlayerStore } from '@/renderer/store/playerStore';
import { callMusicApi } from '@/renderer/services/callMusicApi';
import { resolvePlayableVersionForDesktop } from '@/renderer/services/playableVersionAdapter';
import { toast } from '@/renderer/services/toastStore';
import '@/renderer/styles/songlist.css';

/** 每次「换一批」抽取的歌曲数：今日主打取前 2 首，其余进入推荐歌曲 plain list。 */
const RECOMMEND_BATCH_SIZE = 5;
/** 推荐歌单首屏展示上限：与原型一致，避免 30 张卡把页面拉得过长。 */
const PLAYLIST_VISIBLE_LIMIT = 12;

const RecommendPage: React.FC = () => {
  const navigate = useNavigate();
  const play = usePlayerStore((s) => s.play);
  const setCurrentPlaylist = usePlayerStore((s) => s.setCurrentPlaylist);
  const currentSong = usePlayerStore((s) => s.currentSong);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  const [recommendedPlaylists, setRecommendedPlaylists] = useState<DiscoverPlaylist[]>([]);
  const [recommendedSongs, setRecommendedSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 当前展示的随机批次 + 本轮已用过的池索引（抽完一轮自动重置）
  const [batch, setBatch] = useState<Song[]>([]);
  const [usedIndices, setUsedIndices] = useState<number[]>([]);

  const fetchRecommended = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [playlists, songs] = await Promise.all([
        callMusicApi('getRecommendedPlaylists', 'netease', 30),
        callMusicApi('getRecommendedSongs', 'netease', 100),
      ]);
      setRecommendedPlaylists(playlists || []);
      setRecommendedSongs(songs || []);
      const { batch: firstBatch, used } = pickRandomBatch(songs || [], [], RECOMMEND_BATCH_SIZE);
      setBatch(firstBatch);
      setUsedIndices(used);
    } catch (err: any) {
      setError(err?.message || '加载推荐失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRecommended();
  }, [fetchRecommended]);

  // 换一批：从大池子随机抽 5 首（本轮不重复，抽完一轮自动重置），今日主打同步换
  const handleRefresh = useCallback(() => {
    if (recommendedSongs.length === 0) return;
    const { batch: nextBatch, used } = pickRandomBatch(recommendedSongs, usedIndices, RECOMMEND_BATCH_SIZE);
    setBatch(nextBatch);
    setUsedIndices(used);
  }, [recommendedSongs, usedIndices]);

  /** 点播契约（#697/#D2）：页面建立当前展示队列与下标，SongList 自身不写 playerStore。 */
  const handlePlaySong = useCallback(async (song: Song, queue: Song[], index: number) => {
    setCurrentPlaylist(queue, index);
    try {
      // #639 C3：缺地址时补一个精确匹配的可播版本，未命中交给 play 的解析链与失败归因。
      await play(await resolvePlayableVersionForDesktop(song));
    } catch (playError) {
      console.error('播放失败:', playError);
      toast.error('播放失败，请检查网络连接或稍后重试');
    }
  }, [play, setCurrentPlaylist]);

  const handlePlayAll = useCallback(() => {
    if (batch.length === 0) return;
    void handlePlaySong(batch[0], batch, 0);
  }, [batch, handlePlaySong]);

  const handlePlaylistSelect = useCallback((playlist: DiscoverPlaylist) => {
    navigate(`/discover-playlist/${playlist.id}`);
  }, [navigate]);

  const featuredSongs = useMemo(() => batch.slice(0, 2), [batch]);
  const visiblePlaylists = useMemo(
    () => recommendedPlaylists.slice(0, PLAYLIST_VISIBLE_LIMIT),
    [recommendedPlaylists],
  );

  const showEmptyError = Boolean(error) && batch.length === 0 && recommendedPlaylists.length === 0;

  return (
    <div className="rec">
      <PageHeader
        className="rec__header"
        title="推荐"
        lead="每天 6:00 按你的口味更新"
        actions={
          <>
            <Button
              variant="ghost"
              icon={<RefreshCw size={14} />}
              onClick={handleRefresh}
              disabled={loading || recommendedSongs.length === 0}
            >
              换一批
            </Button>
            <Button
              variant="primary"
              icon={<Play size={14} fill="currentColor" />}
              onClick={handlePlayAll}
              disabled={batch.length === 0}
            >
              播放推荐歌曲
            </Button>
          </>
        }
      />

      <div className="rec__flow" data-scroll-container>
        {showEmptyError ? (
          <div className="rec__state" role="alert">
            <div className="rec__state-title">推荐加载失败</div>
            <div className="rec__state-text">{error}</div>
            <Button onClick={fetchRecommended}>重试</Button>
          </div>
        ) : (
          <>
            <section className="rec__section" aria-labelledby="rec-featured-title">
              <h2 id="rec-featured-title" className="rec__section-title">今日主打</h2>
              {loading && batch.length === 0 ? (
                <div className="rec__featured" aria-hidden="true">
                  {[0, 1].map((item) => (
                    <div className="rec-featured rec-featured--skeleton" key={item}>
                      <span className="skeleton-shimmer rec-featured__cover" />
                      <span className="rec-featured__body">
                        <span className="skeleton-shimmer rec-featured__line rec-featured__line--title" />
                        <span className="skeleton-shimmer rec-featured__line rec-featured__line--meta" />
                      </span>
                    </div>
                  ))}
                </div>
              ) : featuredSongs.length > 0 ? (
                <div className="rec__featured">
                  {featuredSongs.map((song, index) => {
                    const meta = [song.artist, song.album].filter(Boolean).join(' · ');
                    return (
                      <button
                        key={song.id}
                        type="button"
                        className="rec-featured"
                        aria-label={`播放 ${song.name}`}
                        onClick={() => void handlePlaySong(song, batch, index)}
                      >
                        <span className="rec-featured__cover">
                          <SongCover
                            src={song.cover}
                            alt={song.name}
                            variant="gradient"
                            thumbSize={COVER_SIZE.hero}
                          />
                        </span>
                        <span className="rec-featured__body">
                          <span className="rec-featured__name">{song.name}</span>
                          {meta && <span className="rec-featured__meta">{meta}</span>}
                          <span className="rec-featured__play">
                            <Play size={12} fill="currentColor" />
                            播放
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="rec__empty">暂无今日主打</div>
              )}
            </section>

            <section className="rec__section" aria-labelledby="rec-songs-title">
              <h2 id="rec-songs-title" className="rec__section-title">推荐歌曲</h2>
              <SongList
                songs={batch}
                loading={loading && batch.length === 0}
                density="library"
                showHeader
                showDuration
                currentSongId={currentSong?.id}
                isPlaying={isPlaying}
                emptyText="暂无推荐歌曲"
                onPlay={(song, queue, index) => void handlePlaySong(song, queue, index)}
              />
            </section>

            <section className="rec__section" aria-labelledby="rec-playlists-title">
              <h2 id="rec-playlists-title" className="rec__section-title">推荐歌单</h2>
              {loading && visiblePlaylists.length === 0 ? (
                <div className="rec-playlists" aria-hidden="true">
                  {Array.from({ length: 6 }).map((_, item) => (
                    <div className="rec-playlist" key={item}>
                      <span className="skeleton-shimmer rec-playlist__cover" />
                      <span className="skeleton-shimmer rec-playlist__line" />
                      <span className="skeleton-shimmer rec-playlist__line rec-playlist__line--short" />
                    </div>
                  ))}
                </div>
              ) : visiblePlaylists.length > 0 ? (
                <div className="rec-playlists">
                  {visiblePlaylists.map((playlist) => {
                    const meta = [playlist.creator.nickname, `${formatPlayCount(playlist.playCount)} 次播放`]
                      .filter(Boolean)
                      .join(' · ');
                    return (
                      <button
                        key={playlist.id}
                        type="button"
                        className="rec-playlist"
                        aria-label={`打开歌单 ${playlist.name}`}
                        onClick={() => handlePlaylistSelect(playlist)}
                      >
                        <span className="rec-playlist__cover">
                          <SongCover
                            src={playlist.coverImgUrl}
                            alt={playlist.name}
                            variant="gradient"
                            thumbSize={COVER_SIZE.thumb}
                          />
                        </span>
                        <span className="rec-playlist__name">{playlist.name}</span>
                        {meta && <span className="rec-playlist__meta">{meta}</span>}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="rec__empty">
                  <ListMusic size={26} className="rec__empty-icon" />
                  暂无推荐歌单
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
};

export default RecommendPage;
