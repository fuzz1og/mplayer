import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import type { AudioStatus } from 'expo-audio';
import { musicApi, resolvePlayableUrl } from '@mplayer/core';
import type { Song } from '@mplayer/core';
import { usePlayerStore } from '../stores/playerStore';
import { useHistoryStore } from '../stores/historyStore';
import { updateNotification, clearNotification } from './notificationService';

let player: ReturnType<typeof createAudioPlayer> | null = null;
let playerStatusSubscription: { remove: () => void } | null = null;
let playingPromise: Promise<void> | null = null;
let currentPlayId = 0;

export async function initAudio(): Promise<void> {
  await setAudioModeAsync({
    playsInSilentMode: true,
    shouldPlayInBackground: true,
    interruptionMode: 'doNotMix',
  });
}

function disposePlayer(): void {
  playerStatusSubscription?.remove();
  playerStatusSubscription = null;
  player?.remove();
  player = null;
}

export async function playSong(song: Song, retryCount = 0): Promise<void> {
  const playId = ++currentPlayId;

  // Immediately stop the current player instead of waiting for the old run to finish.
  disposePlayer();

  // Wait for a previous playSong call that is still unwinding.
  while (playingPromise) {
    try { await playingPromise; } catch { break; }
  }

  if (playId !== currentPlayId) return;

  const run = async (): Promise<void> => {
    const audioUrl = await resolvePlayableUrl(song, musicApi);
    if (playId !== currentPlayId) throw 'cancelled';

    const nextPlayer = createAudioPlayer({ uri: audioUrl }, { updateInterval: 250 });
    player = nextPlayer;

    const nextPlayerWithEvents = nextPlayer as typeof nextPlayer & {
      addListener(event: 'playbackStatusUpdate', listener: (status: AudioStatus) => void): { remove(): void };
    };

    playerStatusSubscription = nextPlayerWithEvents.addListener('playbackStatusUpdate', (status: AudioStatus) => {
      if (!status.isLoaded) return;

      const s = usePlayerStore.getState();
      if (status.playing && !s.isPlaying) {
        s.resume();
      } else if (!status.playing && s.isPlaying && !status.didJustFinish) {
        s.pause();
      }

      s.setCurrentTime(status.currentTime);
      s.setDuration(status.duration || 0);

      if (status.didJustFinish) {
        if (playId !== currentPlayId) return;
        usePlayerStore.getState().next();
        const nextSong = usePlayerStore.getState().currentSong;
        if (nextSong) playSong(nextSong);
      }
    });

    nextPlayer.setActiveForLockScreen(true, {
      title: song.name,
      artist: song.artist,
      albumTitle: song.album,
      artworkUrl: song.cover || undefined,
    });
    nextPlayer.play();

    useHistoryStore.getState().addHistory(song);
    await updateNotification(song, true);
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
  if (!player) return;
  const song = usePlayerStore.getState().currentSong;

  if (player.playing) {
    player.pause();
    usePlayerStore.getState().pause();
    if (song) await updateNotification(song, false);
  } else {
    player.play();
    usePlayerStore.getState().resume();
    if (song) await updateNotification(song, true);
  }
}

export async function seekTo(timeSec: number): Promise<void> {
  if (player) {
    await player.seekTo(timeSec);
  }
}

export async function cleanup(): Promise<void> {
  disposePlayer();
  await clearNotification();
}
