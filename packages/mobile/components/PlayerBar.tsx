import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { usePlayerStore } from '../stores/playerStore';
import { togglePlay } from '../services/audioPlayer';

export default function PlayerBar() {
  const currentSong = usePlayerStore(s => s.currentSong);
  const isPlaying = usePlayerStore(s => s.isPlaying);

  return (
    <TouchableOpacity
      style={[styles.container, !currentSong && styles.containerEmpty]}
      onPress={() => currentSong && router.push('/player')}
      activeOpacity={0.8}
      disabled={!currentSong}
    >
      <View style={styles.info}>
        <Text style={[styles.title, !currentSong && styles.textEmpty]} numberOfLines={1}>
          {currentSong ? currentSong.name : '未在播放'}
        </Text>
        <Text style={[styles.artist, !currentSong && styles.textEmpty]} numberOfLines={1}>
          {currentSong ? currentSong.artist : '选择一个歌曲开始播放'}
        </Text>
      </View>
      {currentSong && (
        <TouchableOpacity
          onPress={(e) => { e.stopPropagation(); togglePlay(); }}
          style={styles.playBtn}
        >
          <Ionicons
            name={isPlaying ? 'pause-circle' : 'play-circle'}
            size={36}
            color="#e74c3c"
          />
        </TouchableOpacity>
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
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2a2a4a',
  },
  containerEmpty: {
    opacity: 0.6,
  },
  info: { flex: 1, marginRight: 12 },
  title: { color: '#fff', fontSize: 14, fontWeight: '600' },
  artist: { color: '#888', fontSize: 12, marginTop: 2 },
  textEmpty: { color: '#555' },
  playBtn: { padding: 4 },
});
