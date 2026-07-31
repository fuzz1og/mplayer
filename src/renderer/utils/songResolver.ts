import { IpcClient } from '@/renderer/services/IpcClient';
import { createResolveSongUrls, type SearchFn } from '@mplayer/core';
import type { Song } from '@mplayer/core';

const searchFn: SearchFn = async (keyword, page, sourceType) => {
  return IpcClient.invoke<Song[]>('musicApi:searchSongs', keyword, page, sourceType);
};

export const resolveSongUrls = createResolveSongUrls(searchFn);