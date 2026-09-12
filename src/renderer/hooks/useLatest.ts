import { useMemo, useRef, type RefObject } from 'react';

/**
 * 始终指向最新值的 ref。
 *
 * 用途：把「最新的 props / state」喂给身份稳定的回调（见 useStableCallback），
 * 让行组件的 React.memo 不被调用方的内联箭头函数、每次新建的选择/收藏数组击穿。
 */
export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

/**
 * 身份稳定的回调包装：返回的函数引用在组件存活期内不变，内部始终调用最新的实现。
 * fn 为 undefined 时返回 undefined，保持「未提供该能力」的语义（行据此隐藏入口）。
 */
export function useStableCallback<Args extends unknown[], R>(
  fn: (...args: Args) => R,
): (...args: Args) => R;
export function useStableCallback<Args extends unknown[], R>(
  fn: ((...args: Args) => R) | undefined,
): ((...args: Args) => R) | undefined;
export function useStableCallback<Args extends unknown[], R>(
  fn: ((...args: Args) => R) | undefined,
): ((...args: Args) => R) | undefined {
  const latest = useLatest(fn);
  const present = fn !== undefined;
  return useMemo(() => {
    if (!present) return undefined;
    return (...args: Args): R => latest.current?.(...args) as R;
  }, [present, latest]);
}
