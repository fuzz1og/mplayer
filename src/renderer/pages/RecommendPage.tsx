import React, { useCallback, useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { message } from 'antd';
import { useNavigate } from 'react-router-dom';
import DailyRecommend from '@/renderer/components/DailyRecommend';
import PlaylistGrid from '@/renderer/components/PlaylistGrid';
import { usePlayerStore } from '@/renderer/store/playerStore';
import { IpcClient } from '@/renderer/services/IpcClient';
import type { Song, DiscoverPlaylist } from '@mplayer/core';

const RecommendPage: React.FC = () => {
  const navigate = useNavigate();
  const { play } = usePlayerStore();
  const [recommendedPlaylists, setRecommendedPlaylists] = useState<DiscoverPlaylist[]>([]);
  const [recommendedSongs, setRecommendedSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);

  const fetchRecommended = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [playlists, songs] = await Promise.all([
        IpcClient.invoke<DiscoverPlaylist[]>('musicApi:getRecommendedPlaylists', 30),
        IpcClient.invoke<Song[]>('musicApi:getRecommendedSongs', 30),
      ]);
      setRecommendedPlaylists(playlists || []);
      setRecommendedSongs(songs || []);
    } catch (err: any) {
      setError(err?.message || '加载推荐失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRecommended();
  }, [fetchRecommended]);

  const handleRefresh = () => {
    if (recommendedSongs.length > 0) {
      setOffset(prev => (prev + 5) % recommendedSongs.length);
    }
    fetchRecommended();
  };

  const handlePlay = async (song: Song) => {
    try {
      if (!song.url && song.name) {
        const result = await IpcClient.invoke<Song[]>('musicApi:searchSongs', `${song.name} ${song.artist}`, 1, song.sourceType);
        if (result?.length > 0) {
          await play(result[0]);
          return;
        }
        message.warning('未找到可播放版本，尝试直接播放');
      }
      await play(song);
    } catch (error) {
      console.error('播放失败:', error);
      message.error('播放失败，请检查 API 服务是否运行');
    }
  };

  const handlePlaylistSelect = (playlist: DiscoverPlaylist) => {
    navigate(`/discover-playlist/${playlist.id}`);
  };

  const dailySongs = recommendedSongs.length > 0
    ? Array.from({ length: Math.min(5, recommendedSongs.length) }, (_, i) => recommendedSongs[(offset + i) % recommendedSongs.length])
    : [];

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '12px', padding: '16px 28px 14px', borderBottom: '1px solid var(--divider-color)', backgroundColor: 'var(--content-bg)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Sparkles size={18} color="var(--accent-color)" />
          <h1 style={{ fontSize: '22px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>推荐</h1>
        </div>
        <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>为你找到今天值得听的歌</span>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '20px 28px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
        <DailyRecommend
          songs={dailySongs}
          loading={loading && recommendedSongs.length === 0}
          onPlay={handlePlay}
          onRefresh={handleRefresh}
        />
        <div>
          <h3 style={{ fontSize: '17px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '12px' }}>猜你喜欢</h3>
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
