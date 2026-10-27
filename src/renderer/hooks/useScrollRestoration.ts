import { useEffect, useRef } from 'react';

/**
 * #682：设置页是独立路由（/settings*），进入时原页面卸载、返回时重新挂载，滚动位置随之丢失。
 * 这里把「路径（pathname + search）→ 主滚动容器的 scrollTop」持续记在内存里，只在
 * 「设置 → 非设置页」这一种返回场景恢复，普通前进/后退不插手（见任务验收口径）。
 */

const SCROLL_ROOT_SELECTOR = '.app-shell__content';
const SCROLL_CONTAINER_ATTRIBUTE = 'data-scroll-container';
const SCROLL_CONTAINER_SELECTOR = `[${SCROLL_CONTAINER_ATTRIBUTE}]`;

/** 懒加载页面的挂载/填数时机：首帧 rAF + 三个时间档。 */
const RETRY_DELAYS_MS = [50, 150, 400] as const;

export interface ScrollRestorationLocation {
  pathname: string;
  search: string;
}

function routeKey(location: ScrollRestorationLocation): string {
  return `${location.pathname}${location.search}`;
}

/**
 * 纵向可滚动判定：必须有真实溢出（scrollHeight > clientHeight）且 computed overflow 允许滚动。
 * jsdom 不加载 CSS 文件，computed overflow 读不到时依赖 data-scroll-container 标记兜底。
 */
function isScrollableY(element: HTMLElement): boolean {
  if (element.scrollHeight <= element.clientHeight) return false;
  const overflowY = window.getComputedStyle(element).overflowY;
  return overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
}

/** 主滚动容器：优先 [data-scroll-container]，否则文档顺序第一个纵向可滚动的后代；null = 尚未挂载/无溢出。 */
export function findPrimaryScrollContainer(root: ParentNode | null): HTMLElement | null {
  if (!root) return null;
  if (root instanceof HTMLElement) {
    if (root.hasAttribute(SCROLL_CONTAINER_ATTRIBUTE)) return root;
    if (isScrollableY(root)) return root;
  }
  const marked = root.querySelector<HTMLElement>(SCROLL_CONTAINER_SELECTOR);
  if (marked) return marked;
  const candidates = root.querySelectorAll<HTMLElement>('*');
  for (const element of Array.from(candidates)) {
    if (isScrollableY(element)) return element;
  }
  return null;
}

/**
 * 滚动位置恢复：受控于 App 的 useLocation。挂载后按 pathname + search 持续记录；
 * 仅当上一跳是 /settings* 且当前不是设置页时，按 RETRY_DELAYS_MS 重试找滚动容器并回填。
 */
export function useScrollRestoration(location: ScrollRestorationLocation): void {
  const positionsRef = useRef<Map<string, number>>(new Map());
  const previousKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const key = routeKey(location);
    const previousKey = previousKeyRef.current;
    previousKeyRef.current = key;
    const returningFromSettings =
      previousKey !== null && previousKey.startsWith('/settings') && !location.pathname.startsWith('/settings');
    let restorePending = returningFromSettings && (positionsRef.current.get(key) ?? 0) > 0;

    let disposed = false;
    let container: HTMLElement | null = null;
    let onScroll: (() => void) | null = null;
    const retryTimers: number[] = [];
    let rafId: number | null = null;
    let mutationObserver: MutationObserver | null = null;
    let scheduledAttempt: number | null = null;

    const detach = () => {
      if (container && onScroll) container.removeEventListener('scroll', onScroll);
      container = null;
      onScroll = null;
    };

    const attach = (element: HTMLElement) => {
      if (element === container) return;
      detach();
      container = element;
      onScroll = () => positionsRef.current.set(key, element.scrollTop);
      element.addEventListener('scroll', onScroll, { passive: true });
    };

    const stopObserving = () => {
      mutationObserver?.disconnect();
      mutationObserver = null;
      if (scheduledAttempt !== null) {
        window.cancelAnimationFrame(scheduledAttempt);
        scheduledAttempt = null;
      }
    };

    const attempt = () => {
      if (disposed) return;
      const element = findPrimaryScrollContainer(document.querySelector<HTMLElement>(SCROLL_ROOT_SELECTOR));
      if (element) {
        attach(element);
        if (restorePending && element.scrollHeight > 0) {
          element.scrollTop = positionsRef.current.get(key) ?? 0;
          restorePending = false;
        }
      }
      // 容器已就位且无需回填时，后续 DOM 变化不必再触发扫描。
      if (container && !restorePending) stopObserving();
    };

    const scheduleAttempt = () => {
      if (disposed || scheduledAttempt !== null) return;
      scheduledAttempt = window.requestAnimationFrame(() => {
        scheduledAttempt = null;
        attempt();
      });
    };

    // effect 阶段 DOM 已提交：先同步挂一次监听（避免漏掉首屏滚动），
    // 再在 rAF / 50 / 150 / 400ms 补试，覆盖懒加载页面与 Suspense 骨架。
    attempt();
    rafId = window.requestAnimationFrame(() => {
      attempt();
      for (const delay of RETRY_DELAYS_MS) {
        retryTimers.push(window.setTimeout(attempt, delay));
      }
    });

    // 页面数据异步回填（如推荐页重新拉取）会让 scrollHeight 在固定时间档之后才长出滚动条；
    // 在「等容器 / 等回填」期间跟随内容 DOM 变化补试，容器挂好后即停止观察。
    const contentRoot = document.querySelector<HTMLElement>(SCROLL_ROOT_SELECTOR);
    if (contentRoot && typeof MutationObserver === 'function' && (!container || restorePending)) {
      mutationObserver = new MutationObserver(scheduleAttempt);
      mutationObserver.observe(contentRoot, { childList: true, subtree: true });
    }

    return () => {
      disposed = true;
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      for (const timer of retryTimers) window.clearTimeout(timer);
      stopObserving();
      // 路由切换时旧页面已卸载，容器若还持有最后一帧位置就补登记（scroll 事件可能来不及派发）。
      if (container) positionsRef.current.set(key, container.scrollTop);
      detach();
    };
  }, [location.pathname, location.search]);
}
