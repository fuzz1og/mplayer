/**
 * 把 list[from] 挪到 to 位置（其余元素相对顺序不变）。
 * 拖拽排序的索引数学只此一份：队列页、本地歌单页、playerStore.reorderQueue 共用。
 */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return [...list];
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * 把 item 插到 afterIndex **之后**（afterIndex = -1 即插到列表开头）。
 * 与 moveItem 同属「列表索引数学只此一份」：桌面队列的「下一首播放」用它算插入位。
 * 越界下标一律夹到合法区间（UI 调用方，宁可插错也不能崩）。
 */
export function insertAfter<T>(list: readonly T[], afterIndex: number, item: T): T[] {
  const next = [...list];
  const at = Math.max(-1, Math.min(afterIndex, next.length - 1)) + 1;
  next.splice(at, 0, item);
  return next;
}

/**
 * dnd-kit 的 active/over id → 语义下标。任一侧找不到（拖到列表外/自己身上）返回 null。
 */
export function reorderIndices<T extends { id: string }>(
  items: readonly T[],
  activeId: string | number,
  overId: string | number,
): { from: number; to: number } | null {
  const from = items.findIndex(item => item.id === String(activeId));
  const to = items.findIndex(item => item.id === String(overId));
  if (from === -1 || to === -1 || from === to) return null;
  return { from, to };
}

/**
 * 删除 `removedAt` 之后的**游标新位**（#639 C1）。与 `moveItem` / `insertAfter` 同属「列表索引数学只此一处」：
 * 队列删歌时「当前曲下标」与随机序游标必须**同步**变（分开写就是那三次游标脱节 bug 的来源）；
 * 返回的 `{ playlist, index }` 是**原子产出**，调用方没有机会配错。
 */
export function removeAt<T>(
  list: readonly T[],
  removedAt: number,
  currentIndex: number,
): { playlist: T[]; index: number } {
  const playlist = list.filter((_, i) => i !== removedAt);
  if (playlist.length === 0) return { playlist, index: -1 };
  let index = currentIndex;
  if (removedAt < currentIndex) index = currentIndex - 1;
  else if (removedAt === currentIndex) index = removedAt < playlist.length ? removedAt : 0;
  return { playlist, index };
}

/**
 * 把 `from` 挪到 `to` 之后的**游标新位**（#639 C1）。
 *
 * 与 `moveItem` 同源（数组数学复用它），额外负责「当前曲下标随移动平移」——
 * 三分支与 `playerStore.reorderQueue` 原先内联的实现逐条一致。
 */
export function moveTo<T>(
  list: readonly T[],
  from: number,
  to: number,
  currentIndex: number,
): { playlist: T[]; index: number } {
  const playlist = moveItem(list, from, to);
  if (from === to) return { playlist, index: currentIndex };
  let index = currentIndex;
  if (currentIndex === from) index = to;
  else if (from < currentIndex && to >= currentIndex) index = currentIndex - 1;
  else if (from > currentIndex && to <= currentIndex) index = currentIndex + 1;
  return { playlist, index };
}
