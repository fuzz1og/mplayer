import type { Song } from '../types/index.js';

export type DupStatus = 'duplicate' | 'nameConflict' | 'ok';

export interface DupResult {
  status: DupStatus;
  existingSong?: Song;
}

export interface FilterResult {
  ok: Song[];
  duplicates: Song[];
  conflicts: Song[];
}

export function checkDuplicate(targetSongs: Song[], newSong: Song): DupResult {
  const sameNameSameSource = targetSongs.find(
    s => s.name === newSong.name && s.sourceType === newSong.sourceType
  );
  if (sameNameSameSource) {
    return { status: 'duplicate', existingSong: sameNameSameSource };
  }

  const sameNameDiffSource = targetSongs.find(
    s => s.name === newSong.name && s.sourceType !== newSong.sourceType
  );
  if (sameNameDiffSource) {
    return { status: 'nameConflict', existingSong: sameNameDiffSource };
  }

  return { status: 'ok' };
}

export function filterDuplicates(targetSongs: Song[], newSongs: Song[]): FilterResult {
  const result: FilterResult = { ok: [], duplicates: [], conflicts: [] };

  for (const newSong of newSongs) {
    const check = checkDuplicate(targetSongs, newSong);
    switch (check.status) {
      case 'duplicate':
        result.duplicates.push(newSong);
        break;
      case 'nameConflict':
        result.conflicts.push(newSong);
        break;
      case 'ok':
        result.ok.push(newSong);
        break;
    }
  }

  return result;
}

// Legacy dedup function — still used by searchService and searchStore
export const dedupeSongs = (existingSongs: Song[], newSongs: Song[]): Song[] => {
  const idSet = new Set<string>();
  const nameArtistSet = new Set<string>();

  existingSongs.forEach((song) => {
    idSet.add(song.id);
    nameArtistSet.add(`${song.name}|${song.artist}`);
  });

  const uniqueNewSongs = newSongs.filter((song) => {
    const nameArtistKey = `${song.name}|${song.artist}`;
    const isDuplicateById = idSet.has(song.id);
    const isDuplicateByNameArtist = nameArtistSet.has(nameArtistKey);

    if (!isDuplicateById && !isDuplicateByNameArtist) {
      idSet.add(song.id);
      nameArtistSet.add(nameArtistKey);
      return true;
    }

    return false;
  });

  return uniqueNewSongs;
};
