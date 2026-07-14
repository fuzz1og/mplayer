import { Audio } from 'expo-av';
import { musicApi, getApiBaseUrl } from '@mplayer/core';
import type { Song } from '@mplayer/core';
import { usePlayerStore } from '../stores/playerStore';
import { useHistoryStore } from '../stores/historyStore';
import { updateNotification, clearNotification } from './notificationService';

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

export async function playSong(song: Song, retryCount = 0): Promise<void> {
  try {
    // 解析音频 URL
    let audioUrl = song.url;
    console.log(`[playSong] start: id=${song.id}, sourceType=${song.sourceType}, url=${audioUrl}, retry=${retryCount}`);
    if (!audioUrl.startsWith('http://') && !audioUrl.startsWith('https://')) {
      // 汽水音乐需特殊处理
      if (song.sourceType === 'soda' && song.id) {
        const sodaUrl = await musicApi.getSodaAudioUrl(song.id);
        console.log(`[playSong] sodaUrl result: ${sodaUrl}`);
        if (sodaUrl.startsWith('http://') || sodaUrl.startsWith('https://')) {
          audioUrl = sodaUrl;
        }
      }
      if (!audioUrl.startsWith('http://') && !audioUrl.startsWith('https://')) {
        console.log(`[playSong] calling getAudioUrl with: ${audioUrl}`);
        const resolved = await musicApi.getAudioUrl(audioUrl);
        console.log(`[playSong] getAudioUrl returned: ${resolved}`);
        audioUrl = resolved || audioUrl;
      }
    }

    console.log(`[playSong] final audioUrl: ${audioUrl}`);

    // 卸载旧实例
    if (sound) {
      await sound.unloadAsync();
      sound = null;
    }

    if (!audioUrl.startsWith('http')) throw new Error('no playable URL');

    const { sound: newSound } = await Audio.Sound.createAsync(
      { uri: audioUrl },
      { shouldPlay: true, progressUpdateIntervalMillis: 250 }
    );

    sound = newSound;
    useHistoryStore.getState().addHistory(song);
    await updateNotification(song, true);
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
    console.error(`[playSong] error for song ${song.id} (${song.name}):`, err);
    console.log(`[playSong] apiBaseUrl=${getApiBaseUrl()}, song.url=${song.url}`);
    const nextRetryCount = retryCount + 1;
    const queue = usePlayerStore.getState().queue;
    if (nextRetryCount > queue.length) {
      console.error('playSong: max retries reached, stopping');
      return;
    }
    // 出错自动切下一首
    usePlayerStore.getState().next();
    const nextSong = usePlayerStore.getState().currentSong;
    if (nextSong) playSong(nextSong, nextRetryCount);
  }
}

export async function togglePlay(): Promise<void> {
  if (!sound) return;
  const state = await sound.getStatusAsync();
  if (!state.isLoaded) return;
  if (state.isPlaying) {
    await sound.pauseAsync();
    usePlayerStore.getState().pause();
    const song = usePlayerStore.getState().currentSong;
    if (song) await updateNotification(song, false);
  } else {
    await sound.playAsync();
    usePlayerStore.getState().resume();
    const song = usePlayerStore.getState().currentSong;
    if (song) await updateNotification(song, true);
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
  await clearNotification();
}
