import { Audio } from 'expo-av';
import { musicApi, resolvePlayableUrl } from '@mplayer/core';
import type { Song } from '@mplayer/core';
import { usePlayerStore } from '../stores/playerStore';
import { useHistoryStore } from '../stores/historyStore';
import { updateNotification, clearNotification } from './notificationService';

let sound: Audio.Sound | null = null;
let playingPromise: Promise<void> | null = null;
let currentPlayId = 0;

export async function initAudio(): Promise<void> {
  await Audio.setAudioModeAsync({
    staysActiveInBackground: true,
    shouldDuckAndroid: false,
    playThroughEarpieceAndroid: false,
  });
}

export async function playSong(song: Song, retryCount = 0): Promise<void> {
  const playId = ++currentPlayId;

  // 立即停掉当前声音 — 不等旧 run() 完成
  if (sound) {
    await sound.unloadAsync();
    sound = null;
  }

  // 等上一个 playSong 完成（旧 run() 检测到 playId 变化后会退出）
  while (playingPromise) {
    try { await playingPromise; } catch { break; }
  }

  if (playId !== currentPlayId) return;

  const run = async (): Promise<void> => {
    const audioUrl = await resolvePlayableUrl(song, musicApi);
    if (playId !== currentPlayId) throw 'cancelled';


    const { sound: newSound } = await Audio.Sound.createAsync(
      { uri: audioUrl },
      { shouldPlay: true, progressUpdateIntervalMillis: 250 }
    );

    if (playId !== currentPlayId) {
      await newSound.unloadAsync();
      throw 'cancelled';
    }

    sound = newSound;
    useHistoryStore.getState().addHistory(song);
    await updateNotification(song, true);
    sound.setOnPlaybackStatusUpdate((status) => {
      if (!status.isLoaded) return;

      // 系统音频焦点打断同步（PauseOthers 自动暂停/恢复 sound）
      const s = usePlayerStore.getState();
      if (status.isPlaying && !s.isPlaying) {
        s.resume();
      } else if (!status.isPlaying && s.isPlaying && !status.didJustFinish) {
        s.pause();
      }

      usePlayerStore.getState().setCurrentTime(status.positionMillis / 1000);
      usePlayerStore.getState().setDuration(
        (status.durationMillis ?? 0) / 1000
      );
      if (status.didJustFinish) {
        if (playId !== currentPlayId) return;
        usePlayerStore.getState().next();
        const nextSong = usePlayerStore.getState().currentSong;
        if (nextSong) playSong(nextSong);
      }
    });
  };

  try {
    playingPromise = run();
    await playingPromise;
  } catch (err) {
    if (err === 'cancelled') return;
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
