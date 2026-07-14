import { Audio } from 'expo-av';
import { musicApi } from '@mplayer/core';
import type { Song } from '@mplayer/core';
import { usePlayerStore } from '../stores/playerStore';
import { useHistoryStore } from '../stores/historyStore';
import { updateNotification, clearNotification } from './notificationService';

let sound: Audio.Sound | null = null;
let playingPromise: Promise<void> | null = null;

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
  // 排队而非并发: 等上一个 playSong 完成
  while (playingPromise) {
    try { await playingPromise; } catch { break; }
  }

  const run = async (): Promise<void> => {
    let audioUrl = song.url;

    if (!audioUrl || (!audioUrl.startsWith('http://') && !audioUrl.startsWith('https://'))) {
      if (song.name) {
        const searchResults = await musicApi.searchSongs(song.name, 1, song.sourceType);
        if (searchResults.length > 0) {
          audioUrl = searchResults[0].url || audioUrl;
          // 只补字段, 不替换 currentSong 的 id
          const store = usePlayerStore.getState();
          if (store.currentIndex >= 0 && store.queue[store.currentIndex]?.id === song.id) {
            const updatedQueue = [...store.queue];
            const merged = { ...updatedQueue[store.currentIndex], ...searchResults[0], id: song.id };
            updatedQueue[store.currentIndex] = merged;
            usePlayerStore.setState({ queue: updatedQueue, currentSong: merged });
          }
        }
      }
    }

    if (!audioUrl || (!audioUrl.startsWith('http://') && !audioUrl.startsWith('https://'))) {
      if (song.sourceType === 'soda' && song.id) {
        const sodaUrl = await musicApi.getSodaAudioUrl(song.id);
        if (sodaUrl?.startsWith('http://') || sodaUrl?.startsWith('https://')) {
          audioUrl = sodaUrl;
        }
      }
      if (!audioUrl?.startsWith('http://') && !audioUrl?.startsWith('https://')) {
        const resolved = await musicApi.getAudioUrl(audioUrl);
        audioUrl = resolved || audioUrl;
      }
    }

    if (!audioUrl?.startsWith('http')) throw new Error('no playable URL');

    if (sound) {
      await sound.unloadAsync();
      sound = null;
    }

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
        if (nextSong) run();
      }
    });
  };

  try {
    playingPromise = run();
    await playingPromise;
  } catch (err) {
    console.error(`[playSong] error for song ${song.id} (${song.name}):`, err);
    const nextRetryCount = retryCount + 1;
    const queue = usePlayerStore.getState().queue;
    if (nextRetryCount >= queue.length) return;
    usePlayerStore.getState().next();
    const nextSong = usePlayerStore.getState().currentSong;
    if (nextSong) await playSong(nextSong, nextRetryCount);
  } finally {
    playingPromise = null;
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
