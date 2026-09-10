/**
 * 系统「减弱动效」偏好的共享订阅（#304）：全应用一份缓存值 + 一个监听器。
 *
 * 旧实现（hooks/useReducedMotion.ts）每个组件实例各拉一次
 * AccessibilityInfo.isReduceMotionEnabled() 并各挂一个 reduceMotionChanged
 * 监听器：一屏 15 行（每行 3 个 ScalePress + 3 个 BottomSheet）≈ 90 个监听器。
 * 这里把「取值 + 监听」收成模块级单例，hook 退化为纯订阅。
 *
 * 纯模块（零 react-native import）：无障碍源从接口注入，node 环境可直接单测；
 * RN 适配见 hooks/useReducedMotion.ts。
 */

/** 无障碍偏好源：RN 侧是 AccessibilityInfo，测试注入假源 */
export interface ReducedMotionSource {
  isReduceMotionEnabled(): Promise<boolean>;
  /** 订阅偏好变化并返回退订句柄；共享监听器随应用存活，不主动退订 */
  addEventListener(handler: (enabled: boolean) => void): { remove(): void };
}

export interface ReducedMotionStore {
  /** 当前缓存值（异步取值未回来前为 false，与旧 hook 初值一致） */
  getSnapshot(): boolean;
  /** 订阅变化；首个订阅者触发一次性初始化（一次取值 + 一个监听器） */
  subscribe(listener: () => void): () => void;
}

export function createReducedMotionStore(source: ReducedMotionSource): ReducedMotionStore {
  let value = false;
  let started = false;
  const listeners = new Set<() => void>();

  const update = (next: boolean) => {
    if (next === value) return;
    value = next;
    for (const listener of listeners) listener();
  };

  const start = () => {
    if (started) return;
    started = true;
    source.isReduceMotionEnabled().then(update).catch(() => {});
    // reduceMotionChanged 事件参数即最新布尔值，可直接作 setter
    source.addEventListener(update);
  };

  return {
    getSnapshot: () => value,
    subscribe(listener) {
      start();
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}
