import { beforeEach, describe, expect, it } from 'vitest';
import type { Song } from '@mplayer/core';
import { useFavoriteStore } from '../stores/favoriteStore';

function song(id: string): Song {
  return {
    id,
    name: 'x' + id,
    artist: 'y',
    album: '',
    url: '',
    cover: '',
    lrc: '',
    duration: 1,
    sourceType: 'netease',
  };
}

/**
 * #490 批量收藏：一次 set = 一次持久化 + 一次渲染；已存在的 id 跳过。
 * 用 store 订阅计数把「一轮写入」钉死（逐首 addFavorite 会是 N 次）。
 */
describe('批量收藏（#490）', () => {
  beforeEach(() => {
    useFavoriteStore.setState({ favorites: [], favoriteIds: [] });
  });

  it('N 首 = 1 次 store 更新，且双数组不变量同步', () => {
    let updates = 0;
    const unsub = useFavoriteStore.subscribe(() => { updates += 1; });
    try {
      useFavoriteStore.getState().addFavorites([song('a'), song('b'), song('c')]);
    } finally {
      unsub();
    }
    expect(updates).toBe(1);
    const state = useFavoriteStore.getState();
    expect(state.favoriteIds).toEqual(['a', 'b', 'c']);
    // favorites 与 favoriteIds 必须同序（addFavorite / removeFavorite 维护的同一对不变量）
    expect(state.favorites.map((s) => s.id)).toEqual(state.favoriteIds);
  });

  it('已存在的 id 跳过，批量入参内部重复也只收一条', () => {
    useFavoriteStore.setState({ favorites: [song('a')], favoriteIds: ['a'] });
    let updates = 0;
    const unsub = useFavoriteStore.subscribe(() => { updates += 1; });
    try {
      useFavoriteStore.getState().addFavorites([song('a'), song('b'), song('b'), song('c')]);
    } finally {
      unsub();
    }
    expect(updates).toBe(1);
    const state = useFavoriteStore.getState();
    expect(state.favoriteIds).toEqual(['b', 'c', 'a']);
    expect(state.favorites.map((s) => s.id)).toEqual(state.favoriteIds);
  });

  it('全部已存在时返回同一 state，不触发更新', () => {
    useFavoriteStore.setState({ favorites: [song('a')], favoriteIds: ['a'] });
    let updates = 0;
    const unsub = useFavoriteStore.subscribe(() => { updates += 1; });
    try {
      useFavoriteStore.getState().addFavorites([song('a')]);
    } finally {
      unsub();
    }
    expect(updates).toBe(0);
  });
});
