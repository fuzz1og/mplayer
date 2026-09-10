import { useEffect, useRef } from 'react';
import { createPressMutex, type PressMutex } from '../services/pressMutex';

/**
 * 每行一个按压互斥实例：实例隔离（A 行的认领不影响 B 行的真实点击），
 * 实现共享（services/pressMutex.ts，定时器只此一份）。
 */
export function usePressMutex(windowMs = 100): PressMutex {
  const ref = useRef<PressMutex | null>(null);
  if (ref.current === null) ref.current = createPressMutex(windowMs);
  const mutex = ref.current;
  useEffect(() => () => mutex.dispose(), [mutex]);
  return mutex;
}
