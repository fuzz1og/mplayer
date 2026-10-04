import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer, type VirtualItem } from '@tanstack/react-virtual';
import { useLatest } from '@/renderer/hooks/useLatest';

/** SongRow 行高：44px 封面 + 上下各 10px 内边距（见 SongRow 的 padding） */
export const SONG_ROW_HEIGHT = 64;

/**
 * 行数达到该阈值才启用窗口化：短列表整表渲染，省掉测量与首帧探测。
 * 列表的共享口径（#428），各列表别再各写一份。
 */
export const VIRTUALIZE_THRESHOLD = 30;

/** plain = 整表渲染；pending = 已进入虚拟化阈值、仍在探测滚动容器；virtual = 只挂窗口内的行 */
export type VirtualRowsMode = 'plain' | 'pending' | 'virtual';

interface UseVirtualRowsOptions {
  count: number;
  /** 由列表模块按行数阈值决定；false 时零开销地退回整表渲染 */
  enabled: boolean;
  estimateSize: (index: number) => number;
  overscan?: number;
}

interface VirtualRows {
  /** 挂在行容器上：既用于向上探测滚动祖先，也用于测量列表相对滚动容器内容顶部的偏移 */
  rowsRef: React.RefObject<HTMLDivElement | null>;
  mode: VirtualRowsMode;
  /** 仅 mode === 'virtual' 时有意义：窗口内的行（index 对应调用方的数据下标） */
  items: VirtualItem[];
  /** 虚拟列表总高度（spacer），仅 mode === 'virtual' 时有意义 */
  totalSize: number;
  /** 列表内容相对滚动容器内容顶部的偏移（sticky 表头 / 批量栏撑开的那段距离） */
  scrollMargin: number;
  /** 探测到的滚动祖先，也是 load-more 阈值监听的容器 */
  scrollElement: HTMLElement | null;
}

const SCROLLABLE_OVERFLOW_Y = new Set(['auto', 'scroll', 'overlay']);
const EMPTY_ITEMS: VirtualItem[] = [];

/** 纵轴是否可滚动：overflow-y 长写优先，退回 overflow 简写（jsdom 等环境不展开简写） */
function isScrollableY(node: HTMLElement): boolean {
  const style = getComputedStyle(node);
  return SCROLLABLE_OVERFLOW_Y.has(style.overflowY) || SCROLLABLE_OVERFLOW_Y.has(style.overflow);
}

/** 向上找最近的纵向滚动祖先：列表挂靠页面已有的滚动容器，页面无需知道测量细节 */
function findScrollParent(from: HTMLElement | null): HTMLElement | null {
  let node = from?.parentElement ?? null;
  while (node) {
    if (isScrollableY(node)) return node;
    node = node.parentElement;
  }
  return null;
}

/**
 * sticky 元素要让表头贴住**内容区**上边时，`top` 相对滚动视口上边应有的偏移。
 *
 * `position: sticky` 的参照系是**滚动视口**（容器的 border box）上边，而列表内容从**内容区**
 * （padding 之内）开始排布，两者差一个 padding-top。写 `top: 0` 时表头会比它该在的位置高出一个
 * padding，浮到内容上方，列表内容就从表头上方那条缝里露出半截（发现歌单详情页等带内边距的页面）。
 * 所以这里返回**负的** padding-top，把表头压回内容区上边。
 *
 * 容器没有 padding（绝大多数页面）时返回 0，行为与原先的 `top: 0` 完全一致。
 */
export function stickyTopForContent(scrollElement: HTMLElement | null): number {
  if (!scrollElement) return 0;
  const paddingTop = parseFloat(getComputedStyle(scrollElement).paddingTop);
  if (!Number.isFinite(paddingTop) || paddingTop === 0) return 0;
  return -paddingTop;
}

/**
 * 歌曲列表模块的滚动/测量接缝：行数达到阈值时自动虚拟化，且虚拟化挂靠在
 * 页面既有的滚动容器上（不要求页面传入 ref，也不改页面 DOM 结构）。
 * 探测不到滚动祖先时安全退回整表渲染。
 */
export function useVirtualRows({ count, enabled, estimateSize, overscan = 8 }: UseVirtualRowsOptions): VirtualRows {
  const rowsRef = useRef<HTMLDivElement | null>(null);
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  const canVirtualize = enabled && scrollElement !== null;
  // 行高按 index 取值（分组列表：组头 44 / 歌曲 64），经 ref 读取以保持函数身份稳定
  const estimateRef = useLatest(estimateSize);
  const estimate = useCallback((index: number) => estimateRef.current(index), [estimateRef]);

  // 首帧尺寸：ResizeObserver 回调到来之前先用当前尺寸算窗口，避免虚拟化首帧空白（只读一次）
  const initialRect = useMemo(
    () => (scrollElement ? { width: scrollElement.clientWidth, height: scrollElement.clientHeight } : undefined),
    [scrollElement],
  );

  const virtualizer = useVirtualizer({
    enabled: canVirtualize,
    count,
    getScrollElement: () => scrollElement,
    estimateSize: estimate,
    overscan,
    scrollMargin,
    initialRect,
  });

  // 探测滚动祖先（依赖行容器的挂载：enabled 由 false 变 true 时重新探测）
  useLayoutEffect(() => {
    if (!enabled) {
      setScrollElement(null);
      return;
    }
    setScrollElement(findScrollParent(rowsRef.current));
  }, [enabled]);

  // 测量并跟随「列表在滚动容器内的偏移」：批量栏展开、页面头部加载等都会改变它
  useLayoutEffect(() => {
    if (!scrollElement) {
      setScrollMargin(0);
      return;
    }
    const measure = () => {
      const rows = rowsRef.current;
      if (!rows) return;
      const margin = Math.round(rows.getBoundingClientRect().top - scrollElement.getBoundingClientRect().top + scrollElement.scrollTop);
      setScrollMargin((prev) => (prev === margin ? prev : margin));
    };
    measure();

    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    if (observer) {
      observer.observe(scrollElement);
      observer.observe(rowsRef.current!.parentElement ?? rowsRef.current!);
    }
    window.addEventListener('resize', measure);
    // **不监听 scroll**（#412）：scrollMargin = rows.top - container.top + container.scrollTop，
    // 而滚动时 scrollTop 增量与 rows.top 的减量相抵，这个和不随滚动变化。
    // 此前把它挂在 scroll 上，等于每个滚动事件都强制两次 getBoundingClientRect（同步布局），
    // 白白吃掉滚动帧的时间。偏移真正会变的时机（批量栏展开、头部加载、窗口尺寸）
    // 都由上面的 ResizeObserver 与 resize 覆盖。
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [scrollElement]);

  const items = canVirtualize ? virtualizer.getVirtualItems() : EMPTY_ITEMS;
  // 窗口为空（容器还没有高度等）时退回整表渲染：宁可多渲染，也不留空白列表
  const mode: VirtualRowsMode = !enabled ? 'plain' : !scrollElement ? 'pending' : items.length > 0 ? 'virtual' : 'plain';

  return useMemo(() => ({
    rowsRef,
    mode,
    items: mode === 'virtual' ? items : EMPTY_ITEMS,
    totalSize: virtualizer.getTotalSize(),
    scrollMargin,
    scrollElement,
  }), [mode, items, virtualizer, scrollMargin, scrollElement]);
}
