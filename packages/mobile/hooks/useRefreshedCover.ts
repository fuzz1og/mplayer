import { useEffect, useRef, useState } from 'react';
import type { Song } from '@mplayer/core';
import { invalidateCoverUrl } from '@mplayer/core';
import { searchStrictMatch } from '../services/songResources';

/**
 * 封面渲染 + 过期兜底刷新（与 SongRow 同一套机制）：
 * - 渲染 song.cover；若 URL 已过期（加载失败）→ 立即切回占位，
 *   后台严格匹配搜索补新封面（限并发，防列表全失效时打满带宽）
 * - 搜索完成拿到新封面后自动更新触发重渲染
 * - 返回 cover（可能 undefined，调用方显示占位）与 handleError
 *
 * 用途：歌单详情 hero 用第一首歌封面、以及其他需要"最新封面"的场景。
 */

// 封面失效兜底搜索：限并发（手机网络带宽有限，避免整列表失效时并发打满）
let activeCoverSearches = 0;
const MAX_COVER_SEARCHES = 4;
const coverSearchWaiters: (() => void)[] = [];

async function withCoverSearchSlot(fn: () => Promise<void>): Promise<void> {
  if (activeCoverSearches >= MAX_COVER_SEARCHES) {
    await new Promise<void>((r) => coverSearchWaiters.push(r));
  }
  activeCoverSearches++;
  try {
    await fn();
  } finally {
    activeCoverSearches--;
    coverSearchWaiters.shift()?.();
  }
}

export function useRefreshedCover(song: Song | null | undefined): {
  cover: string | undefined;
  handleError: () => void;
} {
  const [cover, setCover] = useState<string | undefined>(song?.cover || undefined);
  const searched = useRef(false);

  // 歌曲切换/封面更新：重置状态
  useEffect(() => {
    setCover(song?.cover || undefined);
    searched.current = false;
    // 歌单/收藏里保存的歌可能没有封面字段（或封面 URL 为空）：
    // 没有 onError 可触发，主动搜索补一次最新封面
    if (song && song.name && !song.cover) {
      searched.current = true;
      void withCoverSearchSlot(async () => {
        try {
          const fresh = await searchStrictMatch(song);
          if (fresh?.cover?.startsWith('http')) setCover(fresh.cover);
        } catch {
          // 兜底失败保留占位
        }
      });
    }
  }, [song?.cover, song?.id, song?.name]);

  const handleError = () => {
    if (!song || searched.current || !song.name) return;
    searched.current = true;
    // 旧封面已失效：立即切占位，等待搜索补新封面后再渲染（避免闪失效图）
    setCover(undefined);
    // 封面自身失效：先清除解析缓存（归一化 key 命中失效直链会循环失败），
    // 兜底搜索的新签名 URL 才能重新解析出新直链（与 SongRow 同一套机制）
    void invalidateCoverUrl(song.cover || '');
    void withCoverSearchSlot(async () => {
      try {
        const fresh = await searchStrictMatch(song);
        if (fresh?.cover?.startsWith('http')) setCover(fresh.cover);
      } catch {
        // 兜底失败保留占位
      }
    });
  };

  return { cover, handleError };
}
