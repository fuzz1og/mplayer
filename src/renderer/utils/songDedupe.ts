import type { Song } from '@/shared/types/song';

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
