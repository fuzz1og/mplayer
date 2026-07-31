import type { Song, AudioTag } from '../types/index.js';
import { probeAudioUrl } from './audioProbe.js';

export interface ProbeOptions {
  /** Max concurrent probe requests. Default: 20 */
  concurrency?: number;
  /** Callback fired per song when probe completes */
  onResult?: (songId: string, tag: AudioTag) => void;
  /** Resolve song URL before probing. Required if song.url is not directly playable */
  resolver?: (song: Song) => Promise<string>;
}

/**
 * Batch probe audio quality for a list of songs.
 *
 * Non-blocking pattern: returns immediately, calls onResult per song as results arrive.
 * Uses concurrency limit to avoid overwhelming the network.
 *
 * Usage:
 *   probeSongs(songs, {
 *     concurrency: 20,
 *     resolver: (song) => getAudioUrl(song.url),
 *     onResult: (id, tag) => store.setAudioTag(id, tag)
 *   });
 */
export async function probeSongs(
  songs: Song[],
  options: ProbeOptions = {},
): Promise<void> {
  const { concurrency = 10, onResult, resolver } = options;

  if (songs.length === 0) return;

  let currentIndex = 0;
  let activeCount = 0;

  function next(): void {
    while (activeCount < concurrency && currentIndex < songs.length) {
      const song = songs[currentIndex++];
      activeCount++;
      probeOne(song, resolver)
        .then((tag) => {
          onResult?.(song.id, tag);
        })
        .catch(() => {
          onResult?.(song.id, 'valid');
        })
        .finally(() => {
          activeCount--;
          next();
        });
    }
  }

  next();
}

async function probeOne(
  song: Song,
  resolver?: (song: Song) => Promise<string>,
): Promise<AudioTag> {
  let url = song.url;
  if (resolver) {
    url = await resolver(song);
  }
  if (!url) return 'invalid';
  return probeAudioUrl(url);
}
