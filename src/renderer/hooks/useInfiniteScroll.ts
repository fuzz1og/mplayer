import { useEffect, type RefObject } from 'react';

interface UseInfiniteScrollOptions {
  onLoadMore: () => void;
  loading: boolean;
  hasMore: boolean;
  threshold?: number;
}

/** 既接受 ref（页面自己的滚动容器），也接受已解析的元素（歌曲列表模块探测到的滚动祖先） */
export type ScrollTarget = RefObject<HTMLElement | null> | HTMLElement | null;

function resolveTarget(target: ScrollTarget): HTMLElement | null {
  if (!target) return null;
  return 'current' in target ? target.current : target;
}

export function useInfiniteScroll(
  target: ScrollTarget,
  { onLoadMore, loading, hasMore, threshold = 200 }: UseInfiniteScrollOptions
) {
  useEffect(() => {
    const container = resolveTarget(target);
    if (!container || !onLoadMore) return;

    const handleScroll = () => {
      if (loading || !hasMore) return;
      const { scrollTop, scrollHeight, clientHeight } = container;
      if (scrollTop + clientHeight >= scrollHeight - threshold) {
        onLoadMore();
      }
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [target, loading, hasMore, onLoadMore, threshold]);
}
