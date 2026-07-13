import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { usePlayerStore } from '../stores/playerStore';
import { togglePlay } from '../services/audioPlayer';

export default function PlayerBar() {
  const currentSong = usePlayerStore(s => s.currentSong);
  const isPlaying = usePlayerStore(s => s.isPlaying);
  const next = usePlayerStore(s => s.next);
  const prev = usePlayerStore(s => s.prev);

  return (
    <TouchableOpacity
      style={[styles.container, !currentSong && styles.containerEmpty]}
      onPress={() => currentSong && router.push('/player')}
      activeOpacity={0.8}
      disabled={!currentSong}
    >
      {/* 专辑封面 */}
      <View style={styles.coverWrap}>
        {currentSong?.cover ? (
          <Image source={{ uri: currentSong.cover }} style={styles.cover} />
        ) : (
          <Ionicons name="musical-note" size={24} color="#555" />
        )}
      </View>

      {/* 歌曲信息 */}
      <View style={styles.info}>
        <Text style={[styles.title, !currentSong && styles.textEmpty]} numberOfLines={1}>
          {currentSong ? currentSong.name : '未在播放'}
        </Text>
        <Text style={[styles.artist, !currentSong && styles.textEmpty]} numberOfLines={1}>
          {currentSong ? currentSong.artist : '选择一个歌曲开始播放'}
        </Text>
      </View>

      {/* 控制按钮 */}
      {currentSong && (
        <View style={styles.controls}>
          <TouchableOpacity
            onPress={(e) => { e.stopPropagation(); prev(); }}
            style={styles.btn}
          >
            <Ionicons name="play-skip-back" size={24} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={(e) => { e.stopPropagation(); togglePlay(); }}
            style={styles.btn}
          >
            <Ionicons
              name={isPlaying ? 'pause-circle' : 'play-circle'}
              size={36}
              color="#e74c3c"
            />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={(e) => { e.stopPropagation(); next(); }}
            style={styles.btn}
          >
            <Ionicons name="play-skip-forward" size={24} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={(e) => {
              e.stopPropagation();
              router.push('/player');
            }}
            style={styles.btn}
          >
            <Ionicons name="list-outline" size={24} color="#fff" />
          </TouchableOpacity>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#16213e',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2a2a4a',
  },
  containerEmpty: {
    opacity: 0.6,
  },
  coverWrap: {
    width: 44,
    height: 44,
    borderRadius: 6,
    backgroundColor: '#2a2a4a',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    marginRight: 12,
  },
  cover: {
    width: 44,
    height: 44,
    borderRadius: 6,
  },
  info: { flex: 1, marginRight: 12 },
  title: { color: '#fff', fontSize: 14, fontWeight: '600' },
  artist: { color: '#888', fontSize: 12, marginTop: 2 },
  textEmpty: { color: '#555' },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  btn: { padding: 4 },
});
