/**
 * 歌单页「选择模式」的状态机（#490）—— 纯逻辑，**不得** import react / react-native，
 * 由 __tests__/playlistSelection.test.ts 在 node 环境直接单测（与 components/collapsingChrome.ts、
 * components/songListLayout.ts 同款分工：阈值/集合运算留在可测的纯模块里，组件只做接线）。
 *
 * 为什么模式与已选集合是**一个**对象：长按进入模式与选中该行是同一次用户动作，
 * 拆成两个 useState 会渲染两次，并在两次渲染之间露出「已进入模式但一行都没选」的中间态。
 *
 * 退出只有两条路：顶部条「完成」/「取消全选」清空后留在模式内，行内取消选中也不退出。
 * 退出模式统一由调用方落到 {@link NO_SELECTION}（引用恒定，React 可跳过同引用重渲染）。
 */
export interface PlaylistSelection {
  mode: boolean;
  /** 已选曲目 id（调用方保证只从当前列表取，UI 计数一律以列表交集为准） */
  ids: ReadonlySet<string>;
}

/** 未进入选择模式（空选择常量的唯一实例） */
export const NO_SELECTION: PlaylistSelection = { mode: false, ids: new Set() };

/**
 * 长按任意歌曲行：进入选择模式并选中该行；已在模式内则**并入**（不切换、不退出）——
 * 票面明确「再长按另一行加入选择（不退出模式）」。
 */
export function enterSelection(current: PlaylistSelection, songId: string): PlaylistSelection {
  const ids = new Set(current.ids);
  ids.add(songId);
  return { mode: true, ids };
}

/** 选择模式下的常规点击：切换命中行（清空不等于退出，退出只认「完成」/返回键） */
export function toggleSelection(current: PlaylistSelection, songId: string): PlaylistSelection {
  // 不在模式内时点击不产生选择（行点击只有在选择模式下才被页面接管）
  if (!current.mode) return current;
  const ids = new Set(current.ids);
  if (!ids.delete(songId)) ids.add(songId);
  return { mode: true, ids };
}

/**
 * 全选。入参必须是**当前完整列表**的 id（非窗口化的可见行）——
 * 调用方从 playlist.songs 取，FlatList 的可见窗口不参与。
 */
export function selectAll(ids: readonly string[]): PlaylistSelection {
  return { mode: true, ids: new Set(ids) };
}

/** 取消全选：清空但**留在**选择模式（与「完成」的区别就在这里） */
export function deselectAll(): PlaylistSelection {
  return { mode: true, ids: new Set() };
}

/** 顶部条右按钮的两种形态：全部已选 → 取消全选，否则 → 全选（空列表恒 false） */
export function areAllSelected(
  current: PlaylistSelection,
  items: readonly { id: string }[],
): boolean {
  return items.length > 0 && items.every((it) => current.ids.has(it.id));
}

/** 已选曲目：按**列表顺序**返回（不是点选顺序），批量写入的顺序因此可预期 */
export function pickSelected<T extends { id: string }>(
  items: readonly T[],
  current: PlaylistSelection,
): T[] {
  return items.filter((it) => current.ids.has(it.id));
}
