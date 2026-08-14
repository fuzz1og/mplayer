import { useState, useEffect, useRef, useCallback } from 'react';
import type { MusicApiMethodMap } from '@/shared/musicApiContract';
import { callMusicApi } from '@/renderer/services/callMusicApi';

interface UseDiscoverDataResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useDiscoverData<K extends keyof MusicApiMethodMap>(
  method: K,
  ...args: Parameters<MusicApiMethodMap[K]>
): UseDiscoverDataResult<Awaited<ReturnType<MusicApiMethodMap[K]>>> {
  type T = Awaited<ReturnType<MusicApiMethodMap[K]>>;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trigger, setTrigger] = useState(0);
  const cacheRef = useRef<T | null>(null);

  const reload = useCallback(() => {
    cacheRef.current = null;
    setTrigger((t) => t + 1);
  }, []);

  useEffect(() => {
    if (cacheRef.current != null) {
      setData(cacheRef.current);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    callMusicApi(method, ...args)
      .then((result) => {
        if (cancelled) return;
        cacheRef.current = result;
        setData(result);
      })
      .catch((err: any) => {
        if (cancelled) return;
        setError(err?.message || '加载失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [method, trigger, ...args]);

  return { data, loading, error, reload };
}
