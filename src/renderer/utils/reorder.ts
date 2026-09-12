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
