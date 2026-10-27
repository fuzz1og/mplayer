import React, { useCallback, useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { toast } from '@/renderer/services/toastStore';
import { useNavigate } from 'react-router-dom';
import DailyRecommend from '@/renderer/components/DailyRecommend';
import '@/renderer/styles/songlist.css';
import PlaylistGrid from '@/renderer/components/PlaylistGrid';
import { usePlayerStore } from '@/renderer/store/playerStore';
import { callMusicApi } from '@/renderer/services/callMusicApi';
import { resolvePlayableVersionForDesktop } from '@/renderer/services/playableVersionAdapter';
import { pickRandomBatch, type Song, type DiscoverPlaylist } from '@mplayer/core';

const RecommendPage: React.FC = () => {
  const navigate = useNavigate();
  const play = usePlayerStore((s) => s.play);
  const [recommendedPlaylists, setRecommendedPlaylists] = useState<DiscoverPlaylist[]>([]);
  const [recommendedSongs, setRecommendedSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 当前展示的随机批次 + 本轮已用过的池索引(抽完一轮自动重置)
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
      const { batch: firstBatch, used } = pickRandomBatch(songs || [], [], 5);
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

  // 换一批:从大池子随机抽 5 首(本轮不重复,抽完一轮自动重置)
  const handleRefresh = () => {
    if (recommendedSongs.length === 0) return;
    const { batch: nextBatch, used } = pickRandomBatch(recommendedSongs, usedIndices, 5);
    setBatch(nextBatch);
    setUsedIndices(used);
  };

  const handlePlay = async (song: Song) => {
    try {
      // #639 C3：缺地址时补一个**精确匹配**的可播版本（判据在 core）。此前直接取 `result[0]` 整首顶替——会播同名不同歌手的歌、
      // 还换掉歌名/封面。未命中返回原歌，交给 play 的解析链与失败归因（不再预先 warning，避免与失败 toast 叠两条）。
      await play(await resolvePlayableVersionForDesktop(song));
    } catch (error) {
      console.error('播放失败:', error);
      toast.error('播放失败，请检查网络连接或稍后重试');
    }
  };

  const handlePlaylistSelect = (playlist: DiscoverPlaylist) => {
    navigate(`/discover-playlist/${playlist.id}`);
  };

  const dailySongs = batch;

  return (
    <div className="rec">
      <div className="rec__head">
        <div className="rec__title-group">
          <Sparkles size={18} color="var(--accent)" />
          <h1 className="rec__title">推荐</h1>
        </div>
        <span className="rec__subtitle">为你找到今天值得听的歌</span>
      </div>

      <div className="rec__body">
        <DailyRecommend
          songs={dailySongs}
          loading={loading && recommendedSongs.length === 0}
          onPlay={handlePlay}
          onRefresh={handleRefresh}
        />
        <div>
          <h3 className="rec__section-title">猜你喜欢</h3>
          <PlaylistGrid
            playlists={recommendedPlaylists}
            loading={loading && recommendedPlaylists.length === 0}
            error={error}
            onRetry={fetchRecommended}
            onPlaylistSelect={handlePlaylistSelect}
          />
        </div>
      </div>
    </div>
  );
};

export default RecommendPage;
