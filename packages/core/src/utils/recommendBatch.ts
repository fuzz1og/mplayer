/**
 * 推荐池随机抽样工具
 *
 * 背景:网易云 /personalized/newsong(推荐新歌)是公开池,列表顺序基本固定;
 * 客户端一次拉满整个池子后,如果按 offset 顺序 5 首/批展示,换一批只是把窗口
 * 往后挪,前几批看到的永远是同一批歌。这里改为:每次从池中随机抽 size 首
 * (记录已用索引、不放回),一轮抽完后自动重置,再开始新的一轮。
 * 这样一轮之内不重复,又不会出现"总看到前五首"。
 */

export interface RandomBatchResult<T> {
  /** 本次抽出的歌曲批次 */
  batch: T[];
  /** 本轮已用过的池索引(追加本次选中项),供下一次调用传入 */
  used: number[];
}

/**
 * 从池中不放回地随机抽取 size 首。
 * - 池不足 size 时返回整个池;
 * - 剩余未用索引不足 size 时自动重置 used,从全池重新随机;
 * - 空池返回空批次。
 */
export function pickRandomBatch<T>(
  pool: readonly T[],
  used: number[],
  size: number
): RandomBatchResult<T> {
  const total = pool.length;
  if (total === 0) return { batch: [], used: [] };

  const k = Math.min(size, total);
  const usedSet = new Set(used.filter((i) => i >= 0 && i < total));
  let available: number[] = [];
  for (let i = 0; i < total; i++) {
    if (!usedSet.has(i)) available.push(i);
  }

  let nextUsed = used;
  if (available.length < k) {
    // 一轮已抽完:重置,从全池重新随机
    available = Array.from({ length: total }, (_, i) => i);
    nextUsed = [];
  }

  // 部分 Fisher–Yates:只需洗出前 k 个位置
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(Math.random() * (available.length - i));
    const tmp = available[i];
    available[i] = available[j];
    available[j] = tmp;
  }

  const picked = available.slice(0, k);
  return {
    batch: picked.map((i) => pool[i]),
    used: nextUsed.concat(picked),
  };
}
