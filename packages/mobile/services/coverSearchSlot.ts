/**
 * 封面失效兜底搜索的并发闸门（歌单 hero / SongRow 共用一份）。
 *
 * 手机网络带宽有限，整列表封面同时失效时不能并发打满搜索：
 * 这里限制同时最多 MAX_COVER_SEARCHES 个兜底搜索，超出排队。
 */
let activeCoverSearches = 0;
const MAX_COVER_SEARCHES = 4;
const coverSearchWaiters: (() => void)[] = [];

export async function withCoverSearchSlot(fn: () => Promise<void>): Promise<void> {
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
