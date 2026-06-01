import { useEffect, type RefObject } from 'react';

interface UseInfiniteScrollOptions {
  onLoadMore: () => void;
  loading: boolean;
  hasMore: boolean;
  threshold?: number;
}

export function useInfiniteScroll(
  containerRef: RefObject<HTMLDivElement | null>,
  { onLoadMore, loading, hasMore, threshold = 200 }: UseInfiniteScrollOptions
) {
  useEffect(() => {
    const container = containerRef.current;
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
  }, [containerRef, loading, hasMore, onLoadMore, threshold]);
}
