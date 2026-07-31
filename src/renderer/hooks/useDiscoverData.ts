import { useState, useEffect, useRef, useCallback } from 'react';

const { ipcRenderer } = window.require('electron');

interface UseDiscoverDataResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useDiscoverData<T>(
  channel: string,
  ...args: unknown[]
): UseDiscoverDataResult<T> {
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

    ipcRenderer.invoke(channel, ...args).then((result: any) => {
      if (cancelled) return;
      const raw = result?.success ? result.data : (result?.data ?? result);
      cacheRef.current = raw as T;
      setData(raw as T);
    }).catch((err: any) => {
      if (cancelled) return;
      setError(err?.message || '加载失败');
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [channel, trigger, ...args]);

  return { data, loading, error, reload };
}
