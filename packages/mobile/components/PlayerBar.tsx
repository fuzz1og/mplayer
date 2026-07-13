import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { usePlayerStore } from '../stores/playerStore';
import { togglePlay } from '../services/audioPlayer';

export default function PlayerBar() {
  const currentSong = usePlayerStore(s => s.currentSong);
  const isPlaying = usePlayerStore(s => s.isPlaying);

  if (!currentSong) return null;

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={() => router.push('/player')}
      activeOpacity={0.8}
    >
      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={1}>
          {currentSong.name}
        </Text>
        <Text style={styles.artist} numberOfLines={1}>
          {currentSong.artist}
        </Text>
      </View>
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
    borderTopWidth: 1,
    borderTopColor: '#2a2a4a',
  },
  info: { flex: 1, marginRight: 12 },
  title: { color: '#fff', fontSize: 14, fontWeight: '600' },
  artist: { color: '#888', fontSize: 12, marginTop: 2 },
  playBtn: { padding: 4 },
});
