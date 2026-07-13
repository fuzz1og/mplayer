import { useEffect, useState } from 'react';
import {
  View, Text, Image, TouchableOpacity, StyleSheet, Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, router } from 'expo-router';
import Slider from '@react-native-community/slider';
import { usePlayerStore } from '../stores/playerStore';
import { togglePlay, seekTo } from '../services/audioPlayer';

const { width } = Dimensions.get('window');

export default function PlayerPage() {
  const song = usePlayerStore(s => s.currentSong);
  const isPlaying = usePlayerStore(s => s.isPlaying);
  const currentTime = usePlayerStore(s => s.currentTime);
  const duration = usePlayerStore(s => s.duration);
  const next = usePlayerStore(s => s.next);
  const prev = usePlayerStore(s => s.prev);
  const [lyrics, setLyrics] = useState<string[]>([]);

  useEffect(() => {
    if (!song) router.back();
  }, [song]);

  if (!song) return null;

  return (
    <View style={styles.container}>
      <Stack.Screen options={{
        headerShown: true,
        title: '',
        headerStyle: { backgroundColor: '#1a1a2e' },
        headerTintColor: '#fff',
        headerLeft: () => (
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="chevron-down" size={28} color="#fff" />
          </TouchableOpacity>
        ),
      }} />

      {/* 专辑封面 */}
      <View style={styles.coverWrap}>
        <Image
          source={{ uri: song.cover || 'https://via.placeholder.com/300' }}
          style={styles.cover}
        />
      </View>

      {/* 歌曲信息 */}
      <View style={styles.infoWrap}>
        <Text style={styles.title}>{song.name}</Text>
        <Text style={styles.artist}>{song.artist}</Text>
      </View>

      {/* 进度条 */}
      <View style={styles.progressWrap}>
        <Slider
          style={{ width: width - 48 }}
          minimumValue={0}
          maximumValue={duration || 1}
          value={currentTime}
          onSlidingComplete={seekTo}
          minimumTrackTintColor="#e74c3c"
          maximumTrackTintColor="#444"
          thumbTintColor="#e74c3c"
        />
        <View style={styles.timeRow}>
          <Text style={styles.time}>{formatTime(currentTime)}</Text>
          <Text style={styles.time}>{formatTime(duration)}</Text>
        </View>
      </View>

      {/* 控制按钮 */}
      <View style={styles.controls}>
        <TouchableOpacity onPress={prev}>
          <Ionicons name="play-skip-back" size={32} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity onPress={togglePlay} style={styles.playBtn}>
          <Ionicons
            name={isPlaying ? 'pause-circle' : 'play-circle'}
            size={64}
            color="#e74c3c"
          />
        </TouchableOpacity>
        <TouchableOpacity onPress={next}>
          <Ionicons name="play-skip-forward" size={32} color="#fff" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e', alignItems: 'center' },
  coverWrap: { marginTop: 40 },
  cover: { width: 280, height: 280, borderRadius: 16 },
  infoWrap: { marginTop: 24, alignItems: 'center' },
  title: { color: '#fff', fontSize: 20, fontWeight: '700' },
  artist: { color: '#888', fontSize: 14, marginTop: 6 },
  progressWrap: { marginTop: 32, alignItems: 'center' },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', width: width - 48, marginTop: 4 },
  time: { color: '#666', fontSize: 12 },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 32,
    gap: 40,
  },
  playBtn: { marginHorizontal: 8 },
});
