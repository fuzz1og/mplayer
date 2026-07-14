import { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Dimensions,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { musicApi } from '@mplayer/core';
import type { SourceKey, DiscoverPlaylist } from '@mplayer/core';
import LoadingState from './LoadingState';
import { useDiscoverStore, HotlistItem } from '../stores/discoverStore';
import { usePlayerStore } from '../stores/playerStore';
import { playSong as playAudio } from '../services/audioPlayer';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const TABS = [
  { key: 'hotlist', label: '排行榜' },
  { key: 'playlists', label: '歌单' },
  { key: 'artists', label: '歌手' },
];

export default function DiscoverTabs() {
  const [activeIndex, setActiveIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  const onTabPress = (i: number) => {
    setActiveIndex(i);
    scrollRef.current?.scrollTo({ x: i * SCREEN_WIDTH, animated: true });
  };

  const onMomentumEnd = (e: any) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
    setActiveIndex(idx);
  };

  return (
    <View style={styles.container}>
      {/* Bubble tab header */}
      <View style={styles.tabHeader}>
        {TABS.map((t, i) => (
          <TouchableOpacity
            key={t.key}
            onPress={() => onTabPress(i)}
            style={[styles.tabItem, activeIndex === i && styles.tabItemActive]}
          >
            <Text style={[styles.tabLabel, activeIndex === i && styles.tabLabelActive]}>
              {t.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      {/* Swipeable content */}
      <ScrollView
        horizontal
        pagingEnabled
        ref={scrollRef}
        onMomentumScrollEnd={onMomentumEnd}
        showsHorizontalScrollIndicator={false}
      >
        <View style={{ width: SCREEN_WIDTH }}>
          <HotlistContent />
        </View>
        <View style={{ width: SCREEN_WIDTH }}>
          <PlaylistContent />
        </View>
        <View style={{ width: SCREEN_WIDTH }}>
          <ArtistContent />
        </View>
      </ScrollView>
    </View>
  );
}

/* ===== 排行榜 Tab ===== */
function HotlistContent() {
  const loading = useDiscoverStore(s => s.loading);
  const load = useDiscoverStore(s => s.load);
  const getSongs = useCallback((key: string) => {
    const state = useDiscoverStore.getState();
    return (state as any)[key] as HotlistItem[];
  }, []);

  useEffect(() => { load(); }, []);

  if (loading) return <LoadingState />;

  const SECTIONS = [
    { key: 'neteaseHotlist' as const, title: '网易云音乐 · 热歌榜', sourceType: 'netease' as SourceKey },
    { key: 'qqHotlist' as const, title: 'QQ 音乐 · 热歌榜', sourceType: 'qq' as SourceKey },
    { key: 'neteaseNew' as const, title: '网易云音乐 · 新歌榜', sourceType: 'netease' as SourceKey },
    { key: 'qqNew' as const, title: 'QQ 音乐 · 新歌榜', sourceType: 'qq' as SourceKey },
  ];

  return (
    <ScrollView style={styles.tabContent} contentContainerStyle={styles.tabContentInner}>
      {SECTIONS.map(section => (
        <SectionCard
          key={section.key}
          title={section.title}
          songs={getSongs(section.key)}
          routeKey={section.key}
          sourceType={section.sourceType}
        />
      ))}
    </ScrollView>
  );
}

function SectionCard({ title, songs, routeKey, sourceType }: { title: string; songs: HotlistItem[]; routeKey: string; sourceType: SourceKey }) {
  const playSong = useCallback((song: HotlistItem) => {
    const s = {
      id: song.id,
      name: song.name,
      artist: song.artists,
      album: song.album,
      cover: song.cover,
      url: '',
      lrc: '',
      duration: 0,
      sourceType,
    };
    usePlayerStore.getState().setQueue([s], 0);
    playAudio(s);
  }, [sourceType]);

  return (
    <View style={styles.section}>
      <TouchableOpacity onPress={() => router.push(`/hotlist?key=${routeKey}&title=${encodeURIComponent(title)}`)}>
        <Text style={styles.sectionTitle}>{title} ›</Text>
      </TouchableOpacity>
      {songs.slice(0, 5).map((song, i) => (
        <TouchableOpacity key={song.id + String(i)} style={styles.songRow} onPress={() => playSong(song)}>
          <Text style={styles.rank}>{i + 1}</Text>
          {song.cover ? (
            <Image source={{ uri: song.cover }} style={styles.cover} />
          ) : (
            <View style={[styles.cover, { backgroundColor: '#2a2a4a', justifyContent: 'center', alignItems: 'center' }]}>
              <Ionicons name="musical-note" size={20} color="#555" />
            </View>
          )}
          <View style={styles.songInfo}>
            <Text style={styles.songName} numberOfLines={1}>{song.name}</Text>
            <Text style={styles.songArtist} numberOfLines={1}>{song.artists}</Text>
          </View>
        </TouchableOpacity>
      ))}
    </View>
  );
}

/* ===== 歌单 Tab ===== */
function PlaylistContent() {
  const [playlists, setPlaylists] = useState<DiscoverPlaylist[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    musicApi.getNeteasePlaylists('全部', 'hot', 0, 20)
      .then(r => { if (!cancelled) setPlaylists(r.playlists); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) return <LoadingState />;

  return (
    <ScrollView style={styles.tabContent} contentContainerStyle={styles.tabContentInner}>
      <View style={styles.grid}>
        {playlists.map(p => {
          const cardW = (SCREEN_WIDTH - 12 * 2 - 10) / 2;
          return (
            <TouchableOpacity
              key={p.id}
              style={[styles.gridCard, { width: cardW }]}
              activeOpacity={0.7}
              onPress={() => router.push(`/discover-playlist/${p.id}` as any)}
            >
              {p.coverImgUrl ? (
                <Image source={{ uri: p.coverImgUrl }} style={[styles.gridCover, { width: cardW, height: cardW }]} />
              ) : (
                <View style={[styles.gridCover, { width: cardW, height: cardW, backgroundColor: '#2a2a4a', justifyContent: 'center', alignItems: 'center' }]}>
                  <Ionicons name="list-outline" size={32} color="#555" />
                </View>
              )}
              <Text style={styles.gridName} numberOfLines={1}>{p.name}</Text>
              <Text style={styles.gridMeta}>{p.playCount ? `${(p.playCount / 10000).toFixed(0)}万` : ''}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </ScrollView>
  );
}

/* ===== 歌手 Tab ===== */
function ArtistContent() {
  const [artists, setArtists] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    musicApi.getNeteaseArtists(1001, 0, 30)
      .then(r => { if (!cancelled) setArtists(r.artists); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) return <LoadingState />;

  return (
    <ScrollView style={styles.tabContent} contentContainerStyle={styles.tabContentInner}>
      <View style={styles.artistGrid}>
        {artists.map(a => (
          <TouchableOpacity
            key={a.id}
            style={styles.artistCard}
            activeOpacity={0.7}
            onPress={() => router.push(`/artist/${a.id}` as any)}
          >
            {a.cover ? (
              <Image source={{ uri: a.cover }} style={styles.artistAvatar} />
            ) : (
              <View style={[styles.artistAvatar, { backgroundColor: '#2a2a4a', justifyContent: 'center', alignItems: 'center' }]}>
                <Ionicons name="person" size={28} color="#555" />
              </View>
            )}
            <Text style={styles.artistName} numberOfLines={1}>{a.name}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  // Bubble tab header
  tabHeader: {
    flexDirection: 'row',
    backgroundColor: '#1a1a2e',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  tabItem: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#2a2a4a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabItemActive: {
    backgroundColor: '#e74c3c',
  },
  tabLabel: {
    color: '#888',
    fontSize: 14,
    fontWeight: '500',
  },
  tabLabelActive: {
    color: '#fff',
    fontWeight: '600',
  },
  tabContent: { flex: 1 },
  tabContentInner: { paddingBottom: 24 },
  // Hotlist section styles
  section: {
    backgroundColor: '#16213e',
    marginHorizontal: 12,
    marginTop: 12,
    borderRadius: 12,
    padding: 12,
  },
  sectionTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
  },
  songRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  rank: {
    color: '#888',
    fontSize: 14,
    fontWeight: '600',
    width: 28,
    textAlign: 'center',
  },
  cover: {
    width: 44,
    height: 44,
    borderRadius: 6,
    marginRight: 10,
  },
  songInfo: { flex: 1 },
  songName: { color: '#fff', fontSize: 14 },
  songArtist: { color: '#888', fontSize: 12, marginTop: 2 },
  // Playlist grid styles
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 12,
    paddingTop: 12,
    gap: 10,
  },
  gridCard: {
    marginBottom: 4,
  },
  gridCover: {
    borderRadius: 10,
    backgroundColor: '#16213e',
  },
  gridName: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '500',
    marginTop: 6,
  },
  gridMeta: {
    color: '#888',
    fontSize: 11,
    marginTop: 2,
  },
  // Artist grid styles
  artistGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 12,
    paddingTop: 12,
  },
  artistCard: {
    width: (SCREEN_WIDTH - 24) / 3,
    alignItems: 'center',
    marginBottom: 20,
  },
  artistAvatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#16213e',
  },
  artistName: {
    color: '#fff',
    fontSize: 13,
    marginTop: 6,
    textAlign: 'center',
  },
});
