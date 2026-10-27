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

/** 向上找最近的纵向滚动祖先：认 data-scroll-container 标记或 computed overflow。 */
export function findScrollParent(from: HTMLElement | null): HTMLElement | null {
  let node = from?.parentElement ?? null;
  while (node) {
    if (node.hasAttribute('data-scroll-container') || isScrollableY(node)) return node;
    node = node.parentElement;
  }
  return null;
}

/**
 * sticky 元素要让表头贴住**内容区**上边时，`top` 相对滚动视口上边应有的偏移。
 * 所以这里返回**负的** padding-top，把表头压回内容区上边。
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

  // 探测滚动祖先。
  // 依赖里带 count，并用「是否已探到」兜底一次：列表可能先渲染骨架屏、行容器稍后才挂载，mount 那一
  // 次探测会落空；节点挂上后 count 变化时会再探一次。
  useLayoutEffect(() => {
    if (!rowsRef.current) return;
    const found = findScrollParent(rowsRef.current);
    setScrollElement((prev) => (prev === found ? prev : found));
  }, [enabled, count, scrollElement === null]);

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
    // **不监听 scroll**（#412）：scrollMargin = rows.top - container.top + container.scrollTop，而
    // 滚动时 scrollTop 增量与 rows.top 的减量相抵，这个和不随滚动变化。
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [scrollElement]);

  const items = canVirtualize ? virtualizer.getVirtualItems() : EMPTY_ITEMS;
  // pending 也整表渲染：消费方在 pending 下渲染 null 曾导致「超阈值 + 无滚动祖先」空白列表。
  const mode: VirtualRowsMode = !enabled || !scrollElement
    ? 'plain'
    : items.length > 0
      ? 'virtual'
      : 'pending';

  // 消费方在 pending 下渲染整表（不是 null）：这是本轮修掉的真实 bug。
  // 容器已探到、窗口还没算出来的那一帧，用户应当看到内容而不是空白。

  return useMemo(() => ({
    rowsRef,
    mode,
    items: mode === 'virtual' ? items : EMPTY_ITEMS,
    totalSize: virtualizer.getTotalSize(),
    scrollMargin,
    scrollElement,
  }), [mode, items, virtualizer, scrollMargin, scrollElement]);
}