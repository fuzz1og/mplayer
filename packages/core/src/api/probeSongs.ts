import type { Song, AudioTag } from '../types/index.js';
import { PREVIEW_THRESHOLD, PROBE_TIMEOUT, MAX_REDIRECTS } from './audioProbe.js';

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
  const { concurrency = 20, onResult, resolver } = options;

  if (songs.length === 0) return;

  let currentIndex = 0;
  let activeCount = 0;
  const stopped = false;

  function next(): void {
    if (stopped) return;

    while (activeCount < concurrency && currentIndex < songs.length) {
      const song = songs[currentIndex++];
      activeCount++;
      probeOne(song, resolver)
        .then((tag) => {
          if (!stopped) onResult?.(song.id, tag);
        })
        .catch(() => {
          if (!stopped) onResult?.(song.id, 'valid');
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
  try {
    let url = song.url;
    if (resolver) {
      url = await resolver(song);
    }
    if (!url || !url.startsWith('http')) return 'invalid';

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT);

    let finalUrl = url;
    let contentLength: number | null = null;

    for (let i = 0; i <= MAX_REDIRECTS; i++) {
      const resp = await fetch(finalUrl, {
        method: i === MAX_REDIRECTS ? 'HEAD' : 'GET',
        signal: controller.signal,
        redirect: 'manual',
      });

      if (resp.status >= 300 && resp.status < 400 && resp.headers.get('location')) {
        finalUrl = new URL(resp.headers.get('location')!, finalUrl).href;
        continue;
      }

      if (resp.status >= 400) {
        clearTimeout(timer);
        return 'invalid';
      }

      const cl = resp.headers.get('content-length');
      contentLength = cl ? parseInt(cl, 10) : null;
      break;
    }

    clearTimeout(timer);

    if (contentLength === null) return 'valid';
    if (contentLength < PREVIEW_THRESHOLD) return 'preview';
    return 'valid';
  } catch {
    return 'valid'; // Fail open — better to allow playback than block it
  }
}
