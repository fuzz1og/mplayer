import { Audio } from 'expo-av';
import { musicApi } from '@mplayer/core';
import type { Song } from '@mplayer/core';
import { usePlayerStore } from '../stores/playerStore';

let sound: Audio.Sound | null = null;

export async function initAudio(): Promise<void> {
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: false,
    staysActiveInBackground: true,
    playsInSilentModeIOS: true,
    shouldDuckAndroid: true,
    playThroughEarpieceAndroid: false,
  });
}

export async function playSong(song: Song): Promise<void> {
  try {
    // 解析音频 URL
    let audioUrl = song.url;
    if (!audioUrl.startsWith('http://') && !audioUrl.startsWith('https://')) {
      // 汽水音乐需特殊处理
      if (song.sourceType === 'soda' && song.id) {
        const sodaUrl = await musicApi.getSodaAudioUrl(song.id);
        if (sodaUrl.startsWith('http://') || sodaUrl.startsWith('https://')) {
          audioUrl = sodaUrl;
        }
      }
      if (!audioUrl.startsWith('http://') && !audioUrl.startsWith('https://')) {
        const resolved = await musicApi.getAudioUrl(audioUrl);
        audioUrl = resolved || audioUrl;
      }
    }

    // 卸载旧实例
    if (sound) {
      await sound.unloadAsync();
      sound = null;
    }

    const { sound: newSound } = await Audio.Sound.createAsync(
      { uri: audioUrl },
      { shouldPlay: true, progressUpdateIntervalMillis: 250 }
    );

    sound = newSound;
    sound.setOnPlaybackStatusUpdate((status) => {
      if (!status.isLoaded) return;
      usePlayerStore.getState().setCurrentTime(status.positionMillis / 1000);
      usePlayerStore.getState().setDuration(
        (status.durationMillis ?? 0) / 1000
      );
      if (status.didJustFinish) {
        usePlayerStore.getState().next();
        const nextSong = usePlayerStore.getState().currentSong;
        if (nextSong) playSong(nextSong);
      }
    });
  } catch (err) {
    console.error('playSong error:', err);
    // 出错自动切下一首
    usePlayerStore.getState().next();
    const nextSong = usePlayerStore.getState().currentSong;
    if (nextSong) playSong(nextSong);
  }
}

export async function togglePlay(): Promise<void> {
  if (!sound) return;
  const state = await sound.getStatusAsync();
  if (!state.isLoaded) return;
  if (state.isPlaying) {
    await sound.pauseAsync();
    usePlayerStore.getState().pause();
  } else {
    await sound.playAsync();
    usePlayerStore.getState().resume();
  }
}

export async function seekTo(timeSec: number): Promise<void> {
  if (sound) {
    await sound.setPositionAsync(timeSec * 1000);
  }
}

export async function cleanup(): Promise<void> {
  if (sound) {
    await sound.unloadAsync();
    sound = null;
  }
}
