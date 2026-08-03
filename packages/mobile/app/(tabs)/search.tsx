import { useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Image,
  Dimensions,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { musicApi } from '@mplayer/core';
import { useSearchStore } from '../../stores/searchStore';
import { useSourceStore } from '../../stores/sourceStore';
import SongRow from '../../components/SongRow';
import LoadMoreFooter from '../../components/LoadMoreFooter';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type SearchTab = 'songs' | 'artists';

export default function SearchPage() {
  const params = useLocalSearchParams<{ q: string }>();
  const q = Array.isArray(params.q) ? params.q[0] : params.q;
  const results = useSearchStore((s) => s.results);
  const loading = useSearchStore((s) => s.loading);
  const loadingMore = useSearchStore((s) => s.loadingMore);
  const hasMore = useSearchStore((s) => s.hasMore);
  const error = useSearchStore((s) => s.error);
  const search = useSearchStore((s) => s.search);
  const loadMore = useSearchStore((s) => s.loadMore);
  const query = useSearchStore((s) => s.query);
  const source = useSourceStore((s) => s.selectedSource);

  const [activeTab, setActiveTab] = useState<SearchTab>('songs');
  const [artists, setArtists] = useState<any[]>([]);
  const [artistsLoading, setArtistsLoading] = useState(false);
  const [artistsError, setArtistsError] = useState(false);

  const searchArtists = async (kw: string) => {
    if (!kw) return;
    setArtistsLoading(true);
    setArtistsError(false);
    try {
      const r = await musicApi.searchNeteaseArtists(kw, 30);
      setArtists(r);
    } catch (e: any) {
      console.error('[Search] artists error:', e.message);
      setArtistsError(true);
    } finally {
      setArtistsLoading(false);
    }
  };

  useEffect(() => {
    if (q && q !== query) {
      search(q);
    }
    if (q) searchArtists(q);
  }, [q]);

  // 切换源时重新搜索（歌手仅网易云，不随源变）
  useEffect(() => {
    if (q) search(q);
  }, [source]);

  return (
    <View style={styles.container}>
      {/* 气泡 tab：歌曲 / 歌手 */}
      <View style={styles.tabHeader}>
        {([
          { key: 'songs', label: '歌曲' },
          { key: 'artists', label: '歌手' },
        ] as { key: SearchTab; label: string }[]).map((t) => (
          <TouchableOpacity
            key={t.key}
            onPress={() => setActiveTab(t.key)}
            style={[styles.tabItem, activeTab === t.key && styles.tabItemActive]}
          >
            <Text style={[styles.tabLabel, activeTab === t.key && styles.tabLabelActive]}>
              {t.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {activeTab === 'songs' ? (
        loading ? (
          <ActivityIndicator color="#e74c3c" style={{ marginTop: 40 }} />
        ) : error ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="alert-circle-outline" size={48} color="#e74c3c" />
            <Text style={[styles.emptyText, { color: '#e74c3c' }]}>{error}</Text>
          </View>
        ) : results.length > 0 ? (
          // 多源/单源分开渲染:全部源按歌分组(同歌各源合并),单源按源分组
          source === 'all' ? (
            <MultiSourceResults results={results} loadMore={loadMore} loadingMore={loadingMore} hasMore={hasMore} />
          ) : (
            <SingleSourceResults results={results} loadMore={loadMore} loadingMore={loadingMore} hasMore={hasMore} />
          )
        ) : (
          <View style={styles.emptyContainer}>
            <Ionicons name="musical-notes-outline" size={48} color="#444" />
            <Text style={styles.emptyText}>搜索歌曲和歌手</Text>
          </View>
        )
      ) : artistsLoading ? (
        <ActivityIndicator color="#e74c3c" style={{ marginTop: 40 }} />
      ) : artistsError ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="alert-circle-outline" size={48} color="#e74c3c" />
          <Text style={[styles.emptyText, { color: '#e74c3c' }]}>歌手搜索失败</Text>
        </View>
      ) : artists.length > 0 ? (
        <FlatList
          key="artist-results"
          data={artists}
          keyExtractor={(item) => String(item.id)}
          numColumns={3}
          contentContainerStyle={styles.artistGrid}
          renderItem={({ item: a }) => (
            <TouchableOpacity
              style={styles.artistCard}
              activeOpacity={0.7}
              onPress={() => router.push(`/artist/${a.id}?name=${encodeURIComponent(a.name)}&pic=${encodeURIComponent(a.picUrl || '')}` as any)}
            >
              {a.picUrl ? (
                <Image source={{ uri: a.picUrl }} style={styles.artistAvatar} />
              ) : (
                <View style={[styles.artistAvatar, styles.artistAvatarFallback]}>
                  <Ionicons name="person" size={28} color="#555" />
                </View>
              )}
              <Text style={styles.artistName} numberOfLines={1}>{a.name}</Text>
            </TouchableOpacity>
          )}
        />
      ) : (
        <View style={styles.emptyContainer}>
          <Ionicons name="person-outline" size={48} color="#444" />
          <Text style={styles.emptyText}>未找到相关歌手</Text>
        </View>
      )}
    </View>
  );
}

interface ResultsListProps {
  results: import('@mplayer/core').SongGroup[];
  loadMore: () => Promise<void>;
  loadingMore: boolean;
  hasMore: boolean;
}

/**
 * 多源搜索(全部源)结果:按歌分组,标题 = 歌名 — 歌手,组内为各源版本
 */
function MultiSourceResults({ results, loadMore, loadingMore, hasMore }: ResultsListProps) {
  return (
    <FlatList
      key="song-results"
      data={results}
      keyExtractor={(item) => item.key}
      renderItem={({ item: group }) => (
        <View style={styles.groupSection}>
          {(group.name || group.artist) ? (
            <Text style={styles.groupHeader}>
              {group.name}
              {group.artist ? <Text style={styles.groupArtist}> — {group.artist}</Text> : null}
            </Text>
          ) : null}
          {group.songs.map((song, i) => (
            <SongRow key={`${song.id}-${i}`} song={song} showSource queueSongs={group.songs} />
          ))}
        </View>
      )}
      onEndReached={loadMore}
      onEndReachedThreshold={0.5}
      ListFooterComponent={<LoadMoreFooter loadingMore={loadingMore} hasMore={hasMore} hasData={results.length > 0} />}
    />
  );
}

/**
 * 单源搜索结果:按源分组,标题 = 源名,组内为该源歌曲列表
 */
function SingleSourceResults({ results, loadMore, loadingMore, hasMore }: ResultsListProps) {
  return (
    <FlatList
      key="song-results"
      data={results}
      keyExtractor={(item) => item.key}
      renderItem={({ item: group }) => (
        <View style={styles.groupSection}>
          {group.name ? <Text style={styles.groupHeader}>{group.name}</Text> : null}
          {group.songs.map((song, i) => (
            <SongRow key={`${song.id}-${i}`} song={song} showSource queueSongs={group.songs} />
          ))}
        </View>
      )}
      onEndReached={loadMore}
      onEndReachedThreshold={0.5}
      ListFooterComponent={<LoadMoreFooter loadingMore={loadingMore} hasMore={hasMore} hasData={results.length > 0} />}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
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
  groupSection: { marginBottom: 8 },
  groupHeader: {
    color: '#aaa',
    fontSize: 13,
    fontWeight: '600',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#16213e',
    marginTop: 8,
    marginHorizontal: 12,
    borderRadius: 8,
    overflow: 'hidden',
  },
  groupArtist: { color: '#666', fontWeight: '400' },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: { color: '#444', fontSize: 16, marginTop: 12 },
  artistGrid: {
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 24,
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
  artistAvatarFallback: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#2a2a4a',
  },
  artistName: {
    color: '#fff',
    fontSize: 13,
    marginTop: 6,
    textAlign: 'center',
  },
});
