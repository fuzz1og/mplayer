import type { Song, AudioTag } from '../types/index.js';
import { probeAudioUrl } from './audioProbe.js';
import { traceNow } from '../shared/playbackTrace.js';

export interface ProbeOptions {
  /** Max concurrent probe requests. Default: 10 */
  concurrency?: number;
  /** Callback fired per song when probe completes */
  onResult?: (songId: string, tag: AudioTag) => void;
  /** Resolve song URL before probing. Required if song.url is not directly playable */
  resolver?: (song: Song) => Promise<string>;
  /** Per-song structured trace (#363): 解析腿与 URL 校验腿分开计时（不并入解析腿）。 */
  onProbe?: (songId: string, resolveMs: number, validateMs: number, tag: AudioTag) => void;
}

/**
 * Batch probe audio quality for a list of songs.
 *
 * Resolves when ALL probes settle (concurrency-limited), calling onResult
 * per song as each finishes. Use with fire-and-forget for non-blocking UI.
 *
 * Usage:
 *   probeSongs(songs, {
 *     concurrency: 10,
 *     resolver: (song) => getAudioUrl(song.url),
 *     onResult: (id, tag) => store.setAudioTag(id, tag)
 *   });
 */
export async function probeSongs(
  songs: Song[],
  options: ProbeOptions = {},
): Promise<void> {
  const { concurrency = 5, onResult, resolver, onProbe } = options;

  if (songs.length === 0) return;

  let currentIndex = 0;
  let activeCount = 0;
  let pendingCount = 0;
  let resolveAll: () => void = () => {};
  const allDone = new Promise<void>((r) => { resolveAll = r; });

  function maybeFinish(): void {
    if (pendingCount === 0 && currentIndex >= songs.length) resolveAll();
  }

  function next(): void {
    while (activeCount < concurrency && currentIndex < songs.length) {
      const song = songs[currentIndex++];
      activeCount++;
      pendingCount++;
      probeOne(song, resolver, onProbe)
        .then((tag) => {
          onResult?.(song.id, tag);
        })
        .catch(() => {
          onResult?.(song.id, 'valid');
        })
        .finally(() => {
          activeCount--;
          pendingCount--;
          maybeFinish();
          next();
        });
    }
    maybeFinish();
  }

  next();
  await allDone;
}

async function probeOne(
  song: Song,
  resolver?: (song: Song) => Promise<string>,
  onProbe?: (songId: string, resolveMs: number, validateMs: number, tag: AudioTag) => void,
): Promise<AudioTag> {
  let url = song.url;
  let resolveMs = 0;
  if (resolver) {
    const t0 = onProbe ? traceNow() : 0;
    url = await resolver(song);
    if (onProbe) resolveMs = traceNow() - t0;
  }
  if (!url) return 'valid'; // fail open — don't block playback
  const t1 = onProbe ? traceNow() : 0;
  const tag = await probeAudioUrl(url);
  if (onProbe) onProbe(song.id, resolveMs, traceNow() - t1, tag);
  return tag;
}
