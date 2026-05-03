import { getFileStorage } from './fileStorage';
import type { Song, Favorite, PlayHistory, Playlist, PlaylistSong } from '@/shared/types/song';

// 使用文件存储替代 IndexedDB
export const db = getFileStorage();

// 为了保持兼容性，保留原有的类型导出
export type { Song, Favorite, PlayHistory, Playlist, PlaylistSong };
