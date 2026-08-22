import { create } from 'zustand';
const { ipcRenderer } = window.require('electron');
import { cacheCoverImage } from '@/renderer/services/coverCacheService';
import { IpcClient } from '@/renderer/services/IpcClient';
import { callMusicApi } from '@/renderer/services/callMusicApi';
import type { Song, SongBase } from '@mplayer/core';
import { findExactMatch, stripSourceIdPrefix } from '@mplayer/core';
import { mapPacedWithConcurrency } from '@/renderer/utils/async';
import { isLegacyDeadUrl } from '@mplayer/core';

interface FavoriteState {
  favoriteIds: string[];
  favorites: Song[];
  loading: boolean;
  error: string | null;

  // Actions
  loadFavorites: () => Promise<void>;
  toggleFavorite: (song: Song) => Promise<boolean>;
  isFavorite: (songId: string) => boolean;
  addFavorite: (song: Song) => Promise<void>;
  removeFavorite: (songId: string) => Promise<void>;
  /** 单曲换源：原位替换收藏（保持收藏时间与排序） */
  replaceFavorite: (originalId: string, swapped: Song) => Promise<void>;
  refreshSongUrls: (song: SongBase) => Promise<Song | null>;
}

export const useFavoriteStore = create<FavoriteState>((set, get) => ({
  favoriteIds: [],
  favorites: [],
  loading: false,
  error: null,

  refreshSongUrls: async (song: SongBase): Promise<Song | null> => {
    try {
      // 尝试从缓存获取URL
      const cachedUrl = await IpcClient.invoke<{ url: string; cover: string; lrc: string } | null>('cache:getSongResources', song.id);
      if (
        cachedUrl &&
        !isLegacyDeadUrl(cachedUrl.url) &&
        !isLegacyDeadUrl(cachedUrl.cover) &&
        !isLegacyDeadUrl(cachedUrl.lrc)
      ) {
        return {
          ...song,
          url: cachedUrl.url,
          cover: cachedUrl.cover,
          lrc: cachedUrl.lrc
        };
      }

      // 如果缓存中没有（或缓存是旧死链），先按源站 ID 直接识别。
      // 自建 API 退役后 searchSongById 会返回 null，再回退按歌名精确匹配。
      let matchedSong: Song | null = null;
      try {
        matchedSong = await callMusicApi(
          'searchSongById',
          stripSourceIdPrefix(String(song.id)),
          song.sourceType,
          true,
        );
      } catch {
        matchedSong = null;
      }

      if (!matchedSong && song.name) {
        try {
          const results = await callMusicApi(
            'searchSongsRouted',
            `${song.name} ${song.artist}`.trim(),
            1,
            song.sourceType,
          );
          matchedSong = (findExactMatch({ name: song.name, artist: song.artist }, results) as Song | undefined) || null;
        } catch {
          matchedSong = null;
        }
      }

      if (matchedSong) {
        const fresh = matchedSong as Song;
        const updated: Song = {
          ...song,
          name: fresh.name || song.name,
          artist: fresh.artist || song.artist,
          album: fresh.album || song.album || '',
          duration: fresh.duration || song.duration || 0,
          url: fresh.url || '',
          cover: fresh.cover || '',
          lrc: fresh.lrc || '',
          sourceType: fresh.sourceType || song.sourceType,
        };

        // 写入缓存
        await IpcClient.invoke<void>('cache:setSongResources', song.id, {
          url: updated.url,
          cover: updated.cover,
          lrc: updated.lrc
        });

        // 写回 DB（下次启动不用重新搜索）
        ipcRenderer.invoke('favorite:updateSongData', song.id, {
          name: updated.name,
          artist: updated.artist,
          album: updated.album,
          duration: updated.duration,
          url: updated.url,
          cover: updated.cover,
          lrc: updated.lrc,
          sourceType: updated.sourceType,
        }).catch(() => {}); // fire-and-forget

        if (updated.cover) cacheCoverImage(updated.cover).catch(() => {});

        return updated;
      }
      return null;
    } catch (error) {
      console.error('刷新歌曲URL失败:', error);
      return null;
    }
  },

  loadFavorites: async () => {
    set({ loading: true, error: null });
    try {
      const songBases = await IpcClient.invoke<SongBase[]>('favorite:getAll');
      // 先从缓存加载，然后异步刷新缺失 URL 的歌曲
      const cachedSongs: Song[] = [];
      const needsRefresh: SongBase[] = [];

      for (const songBase of songBases) {
        const cachedUrl = await IpcClient.invoke<{ url: string; cover: string; lrc: string } | null>('cache:getSongResources', songBase.id);
        if (
          cachedUrl &&
          !isLegacyDeadUrl(cachedUrl.url) &&
          !isLegacyDeadUrl(cachedUrl.cover) &&
          !isLegacyDeadUrl(cachedUrl.lrc)
        ) {
          cachedSongs.push({
            ...songBase,
            url: cachedUrl.url,
            cover: cachedUrl.cover,
            lrc: cachedUrl.lrc
          });
        } else {
          // 缓存中没有，先加入列表（URL 为空），后续异步刷新
          cachedSongs.push(songBase as Song);
          needsRefresh.push(songBase);
        }
      }

      const ids = cachedSongs.map(s => s.id);
      set({
        favorites: cachedSongs,
        favoriteIds: ids,
        loading: false
      });

      // 异步刷新缺失 URL 的歌曲（不阻塞界面加载）
      if (needsRefresh.length > 0) {
        // Bug #8: 分批刷新（每批 3 首 + 批间间隔 + 限流退避），
        // 避免请求风暴（上游服务端对同 IP 并发/速率有硬限制）
        const refreshResults = await mapPacedWithConcurrency(
          needsRefresh,
          3,
          songBase => get().refreshSongUrls(songBase)
        );

        // Bug #5: 用 Map<id, result> 查找，避免索引错位
        const resultMap = new Map<string, Song>();
        refreshResults.forEach((r, i) => {
          if (r.status === 'fulfilled' && r.value) {
            resultMap.set(needsRefresh[i].id, r.value);
          }
        });

        // Bug #12: 合并时检查当前状态，避免竞态覆盖用户修改
        const currentFavorites = get().favorites;
        const currentIds = new Set(currentFavorites.map(f => f.id));
        const updatedFavorites = currentFavorites.map(fav => {
          const refreshed = resultMap.get(fav.id);
          if (refreshed && currentIds.has(fav.id)) {
            return refreshed;
          }
          return fav;
        });

        // Bug #6: 同时更新 favoriteIds，保持两者同步
        set({
          favorites: updatedFavorites,
          favoriteIds: updatedFavorites.map(f => f.id),
        });
      }
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : '加载收藏失败',
        loading: false
      });
    }
  },

  toggleFavorite: async (song: Song) => {
    const { favoriteIds } = get();
    const isCurrentlyFavorite = favoriteIds.includes(song.id);

    try {
      if (isCurrentlyFavorite) {
        await IpcClient.invoke<void>('favorite:remove', song.id);
        set((state) => {
          const newIds = state.favoriteIds.filter(id => id !== song.id);
          const newFavorites = state.favorites.filter(f => f.id !== song.id);
          return { favoriteIds: newIds, favorites: newFavorites };
        });
        return false;
      } else {
        await IpcClient.invoke<number>('favorite:add', song);
        set((state) => {
          const newIds = [...state.favoriteIds, song.id];
          const newFavorites = [...state.favorites, song];
          return { favoriteIds: newIds, favorites: newFavorites };
        });
        return true;
      }
    } catch (error) {
      console.error('收藏操作失败:', error);
      throw error;
    }
  },

  isFavorite: (songId: string) => {
    return get().favoriteIds.includes(songId);
  },

  addFavorite: async (song: Song) => {
    const { favoriteIds } = get();
    if (favoriteIds.includes(song.id)) return;

    try {
      await IpcClient.invoke<number>('favorite:add', song);
      set((state) => {
        const newIds = [...state.favoriteIds, song.id];
        const newFavorites = [...state.favorites, song];
        return { favoriteIds: newIds, favorites: newFavorites };
      });
    } catch (error) {
      console.error('添加收藏失败:', error);
      throw error;
    }
  },

  removeFavorite: async (songId: string) => {
    const { favoriteIds } = get();
    if (!favoriteIds.includes(songId)) return;

    try {
      await IpcClient.invoke<void>('favorite:remove', songId);
      set((state) => {
        const newIds = state.favoriteIds.filter(id => id !== songId);
        const newFavorites = state.favorites.filter(f => f.id !== songId);
        return { favoriteIds: newIds, favorites: newFavorites };
      });
    } catch (error) {
      console.error('移除收藏失败:', error);
      throw error;
    }
  },

  replaceFavorite: async (originalId: string, swapped: Song) => {
    try {
      await IpcClient.invoke<void>('favorite:replaceSong', originalId, swapped);
      set((state) => ({
        favorites: state.favorites.map(f => f.id === originalId ? swapped : f),
        favoriteIds: state.favoriteIds.map(id => id === originalId ? swapped.id : id),
      }));
    } catch (error) {
      console.error('换源保存到收藏失败:', error);
      throw error;
    }
  },
}));
