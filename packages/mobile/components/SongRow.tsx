import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { type Song, SourceKey } from '@mplayer/core';
import { usePlayerStore } from '../stores/playerStore';
import { useFavoriteStore } from '../stores/favoriteStore';
import { playSong } from '../services/audioPlayer';

interface SongRowProps {
  song: Song;
  rank?: number;
  onPress?: (song: Song) => void;
  showSource?: boolean;
  defaultFavorited?: boolean;
}

const SOURCE_COLORS: Record<SourceKey, string> = {
  netease: '#e74c3c',
  qq: '#3498db',
  kugou: '#9b59b6',
  migu: '#e67e22',
  kuwo: '#1abc9c',
  qianqian: '#95a5a6',
  soda: '#2ecc71',
  local: '#7f8c8d',
};

const SOURCE_LABELS: Record<SourceKey, string> = {
  netease: '网易云',
  qq: 'QQ',
  kugou: '酷狗',
  migu: '咪咕',
  kuwo: '酷我',
  qianqian: '千千',
  soda: '汽水',
  local: '本地',
};

export default function SongRow({
  song,
  rank,
  onPress,
  showSource = false,
  defaultFavorited = false,
}: SongRowProps) {
  const isFav = useFavoriteStore((s) => s.isFavorite(song.id));
  const addFavorite = useFavoriteStore((s) => s.addFavorite);
  const removeFavorite = useFavoriteStore((s) => s.removeFavorite);

  const favorited = defaultFavorited || isFav;

  const handlePress = () => {
    if (onPress) {
      onPress(song);
    } else {
      usePlayerStore.getState().setQueue([song], 0);
      playSong(song);
    }
  };

  const handleFavorite = (e: any) => {
    e.stopPropagation();
    if (favorited) {
      removeFavorite(song.id);
    } else {
      addFavorite(song);
    }
  };

  const sourceKey = song.sourceType as SourceKey;

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={handlePress}
      activeOpacity={0.6}
    >
      {rank !== undefined && (
        <Text style={styles.rank}>{rank}</Text>
      )}

      <Image
        source={{ uri: song.cover }}
        style={styles.cover}
      />

      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {song.name}
        </Text>
        <Text style={styles.artist} numberOfLines={1}>
          {song.artist}
        </Text>
      </View>

      {showSource && (
        <View style={[styles.sourceBadge, { backgroundColor: SOURCE_COLORS[sourceKey] || '#666' }]}>
          <Text style={styles.sourceText}>
            {SOURCE_LABELS[sourceKey] || sourceKey}
          </Text>
        </View>
      )}

      <TouchableOpacity
        onPress={handleFavorite}
        style={styles.favoriteBtn}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Ionicons
          name={favorited ? 'heart' : 'heart-outline'}
          size={20}
          color={favorited ? '#e74c3c' : '#666'}
        />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#1a1a2e',
  },
  rank: {
    color: '#888',
    fontSize: 14,
    fontWeight: '600',
    width: 28,
    textAlign: 'center',
    marginRight: 4,
  },
  cover: {
    width: 44,
    height: 44,
    borderRadius: 6,
    marginRight: 12,
  },
  info: {
    flex: 1,
    marginRight: 8,
  },
  name: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  artist: {
    color: '#888',
    fontSize: 12,
    marginTop: 2,
  },
  sourceBadge: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginRight: 8,
  },
  sourceText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '600',
  },
  favoriteBtn: {
    padding: 4,
  },
});
