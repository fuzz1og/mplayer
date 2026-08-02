import { musicApi, probeAudioUrl, probeAudio as coreProbeAudio } from '@mplayer/core';
import type { Song, AudioTag } from '@mplayer/core';

export async function probeAudio(song: Song): Promise<AudioTag> {
  if (song.sourceType === 'soda') {
    try {
      const url = await musicApi.getSodaAudioUrl(song.id);
      if (url) return probeAudioUrl(url);
    } catch {
      // fall through to duration-based classification
    }
  }
  return coreProbeAudio(song);
}

export type { AudioTag } from '@mplayer/core';
