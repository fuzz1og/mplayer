import axios from 'axios';
import type { Song } from '@mplayer/core';

// Kugou API endpoints
const BASE_URL = 'https://mobilecdn.kugou.com/api/v3';
const RANK_SONGS_URL = `${BASE_URL}/rank/song`;

// Headers matching mobile app
const KUGOU_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1',
  'Referer': 'https://m.kugou.com/',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'Accept-Encoding': 'gzip, deflate',
  'Connection': 'keep-alive',
};

/**
 * Normalize Kugou song data to standard Song format
 */
function normalizeSong(raw: any): Song {
  const authors = (raw.authors || []).map((a: any) => a.author_name).join(' / ');
  const cover = raw.album_sizable_cover?.replace('{size}', '300x300') || '';

  return {
    id: raw.hash || '',
    name: raw.songname || '',
    artist: authors || '',
    album: raw.albumname || '',
    url: '', // Kugou requires additional lookup for audio URL
    cover,
    lrc: '',
    duration: raw.duration || 0,
    sourceType: 'kugou',
  };
}

/**
 * Fetch Kugou rank songs
 */
export async function getKugouRank(rankId: string, pageSize: number = 50): Promise<Song[]> {
  try {
    const response = await axios.get(RANK_SONGS_URL, {
      params: {
        rankid: rankId,
        page: 1,
        pagesize: pageSize,
      },
      headers: KUGOU_HEADERS,
      timeout: 15000,
      proxy: false,
    });

    const data = response.data;
    if (data.status !== 1) {
      console.error('[KugouApi] getKugouRank failed:', data.error);
      return [];
    }

    const songs = data.data?.info || [];
    return songs.map((song: any) => normalizeSong(song));
  } catch (error) {
    console.error('[KugouApi] getKugouRank error:', error);
    return [];
  }
}

/**
 * Fetch Kugou new songs (via rank endpoint with specific rank ID)
 */
export async function getKugouNewSongs(): Promise<Song[]> {
  // 74534 is the new song chart (新歌榜)
  return getKugouRank('74534', 50);
}
