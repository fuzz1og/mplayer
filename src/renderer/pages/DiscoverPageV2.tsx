import React, { useState, useEffect, useCallback, useRef } from 'react';
import { message } from 'antd';
import { usePlayerStore } from '@/renderer/store/playerStore';
import ChartPanel from '@/renderer/components/ChartPanel';
import type { AggregatedSongGroup } from '@/main/services/chartAggregator';
import type { Song } from '@/shared/types/song';

const { ipcRenderer } = window.require('electron');

type TabKey = 'charts' | 'albums' | 'recommend' | 'playlists';

interface TabDef {
  key: TabKey;
  label: string;
}

const TABS: TabDef[] = [
  { key: 'charts', label: '排行榜' },
  { key: 'albums', label: '新碟上架' },
  { key: 'recommend', label: '猜你喜欢' },
  { key: 'playlists', label: '歌单' },
];

const SOURCES = ['netease', 'qq', 'kugou'];

interface ChartCache {
  hot: AggregatedSongGroup[] | null;
  new: AggregatedSongGroup[] | null;
  hotTimestamp: number;
  newTimestamp: number;
}

const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

const DiscoverPageV2: React.FC = () => {
  const { currentSong, play } = usePlayerStore();

  const [activeTab, setActiveTab] = useState<TabKey>('charts');
  const [hotGroups, setHotGroups] = useState<AggregatedSongGroup[]>([]);
  const [newGroups, setNewGroups] = useState<AggregatedSongGroup[]>([]);
  const [hotLoading, setHotLoading] = useState(true);
  const [newLoading, setNewLoading] = useState(true);
  const [hotError, setHotError] = useState<string | null>(null);
  const [newError, setNewError] = useState<string | null>(null);

  const cacheRef = useRef<ChartCache>({ hot: null, new: null, hotTimestamp: 0, newTimestamp: 0 });
  const mountedRef = useRef(true);

  const fetchChart = useCallback(async (type: 'hot' | 'new') => {
    const cache = cacheRef.current;
    const cached = type === 'hot' ? cache.hot : cache.new;
    const timestamp = type === 'hot' ? cache.hotTimestamp : cache.newTimestamp;

    // Use cache if fresh
    if (cached && Date.now() - timestamp < CACHE_TTL) {
      if (type === 'hot') {
        setHotGroups(cached);
        setHotLoading(false);
      } else {
        setNewGroups(cached);
        setNewLoading(false);
      }
      return;
    }

    if (type === 'hot') {
      setHotLoading(true);
      setHotError(null);
    } else {
      setNewLoading(true);
      setNewError(null);
    }

    try {
      const result = await ipcRenderer.invoke('musicApi:getAggregatedChart', type, SOURCES);
      if (!mountedRef.current) return;

      const groups = (result?.songs || []) as AggregatedSongGroup[];

      if (type === 'hot') {
        setHotGroups(groups);
        cacheRef.current.hot = groups;
        cacheRef.current.hotTimestamp = Date.now();
      } else {
        setNewGroups(groups);
        cacheRef.current.new = groups;
        cacheRef.current.newTimestamp = Date.now();
      }
    } catch (err: any) {
      if (!mountedRef.current) return;
      const errorMsg = err?.message || '加载失败';
      if (type === 'hot') {
        setHotError(errorMsg);
      } else {
        setNewError(errorMsg);
      }
    } finally {
      if (!mountedRef.current) return;
      if (type === 'hot') setHotLoading(false);
      else setNewLoading(false);
    }
  }, []);

  // Load charts on mount
  useEffect(() => {
    mountedRef.current = true;
    fetchChart('hot');
    fetchChart('new');
    return () => { mountedRef.current = false; };
  }, [fetchChart]);

  const handlePlaySong = async (song: Song) => {
    try {
      await play(song);
    } catch (error) {
      console.error('播放失败:', error);
      message.error('播放失败，请检查网络连接和 API 设置');
    }
  };

  const isCurrentSong = (songId: string) => currentSong?.id === songId;

  const handleRetryHot = () => {
    cacheRef.current.hot = null;
    cacheRef.current.hotTimestamp = 0;
    fetchChart('hot');
  };

  const handleRetryNew = () => {
    cacheRef.current.new = null;
    cacheRef.current.newTimestamp = 0;
    fetchChart('new');
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Tab bar */}
      <div
        style={{
          display: 'flex',
          gap: 'var(--space-1)',
          padding: '0 var(--space-6)',
          borderBottom: '1px solid var(--divider-color)',
          backgroundColor: 'var(--content-bg)',
          flexShrink: 0,
        }}
      >
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: 'var(--space-3) var(--space-5)',
              border: 'none',
              borderBottom: activeTab === tab.key ? '2px solid var(--accent-color)' : '2px solid transparent',
              background: 'transparent',
              cursor: 'pointer',
              fontSize: 'var(--text-base)',
              fontWeight: activeTab === tab.key ? 600 : 400,
              color: activeTab === tab.key ? 'var(--accent-color)' : 'var(--text-secondary)',
              transition: 'all 0.15s ease',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: 'hidden', padding: 'var(--space-5) var(--space-6)' }}>
        {activeTab === 'charts' && (
          <div style={{ height: '100%', display: 'flex', gap: 'var(--space-6)' }}>
            <ChartPanel
              title="🔥 热歌榜"
              groups={hotGroups}
              loading={hotLoading}
              error={hotError}
              onPlay={handlePlaySong}
              isCurrentSong={isCurrentSong}
              onRetry={handleRetryHot}
            />
            <ChartPanel
              title="🎵 新歌榜"
              groups={newGroups}
              loading={newLoading}
              error={newError}
              onPlay={handlePlaySong}
              isCurrentSong={isCurrentSong}
              onRetry={handleRetryNew}
            />
          </div>
        )}

        {activeTab === 'albums' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-tertiary)' }}>
            <div style={{ fontSize: '64px', marginBottom: '20px' }}>💿</div>
            <div style={{ fontSize: '18px', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '8px' }}>
              新碟上架
            </div>
            <div style={{ fontSize: '14px' }}>功能开发中，敬请期待</div>
          </div>
        )}

        {activeTab === 'recommend' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-tertiary)' }}>
            <div style={{ fontSize: '64px', marginBottom: '20px' }}>✨</div>
            <div style={{ fontSize: '18px', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '8px' }}>
              猜你喜欢
            </div>
            <div style={{ fontSize: '14px' }}>功能开发中，敬请期待</div>
          </div>
        )}

        {activeTab === 'playlists' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-tertiary)' }}>
            <div style={{ fontSize: '64px', marginBottom: '20px' }}>📚</div>
            <div style={{ fontSize: '18px', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '8px' }}>
              歌单
            </div>
            <div style={{ fontSize: '14px' }}>功能开发中，敬请期待</div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DiscoverPageV2;