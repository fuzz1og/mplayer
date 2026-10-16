import { RESOLUTION_CHAIN_BUDGET_MS } from './playbackBudgets.js';

/**
 * 为避免一此词两义，本模块与其文档一律称后者为「**解析链总预算**」。
 * K=3 槽位排队**计入**本预算——否则三个槽位被占满时整链会**无界等待**（「链总在 T 毫秒内结算」就不
 * 成立了）。
 */

/** 解析链总预算耗尽的哨兵错误：与「源失败」「单源墙超时」「tier3 腿预算用尽」都不同——
 *  它意味着整条链（直连腿 + 最多两条 tier3 腿）共用的那一个 deadline 用尽了。 */
export class ResolutionBudgetExhaustedError extends Error {
  readonly totalMs: number;

  constructor(totalMs: number) {
    super(`解析链超过 ${totalMs}ms 总预算，已放弃`);
    this.name = 'ResolutionBudgetExhaustedError';
    this.totalMs = totalMs;
  }
}

/**
 * 一次解析链的预算对象：从创建那一刻起计的**墙钟**（不暂停）。
 * 计时器在创建时就起（`onExpire` 监听不能依赖「有人 race 了哨兵」），`dispose()` 停表；
 * 没人 race 的哨兵 promise 不产生 unhandled rejection。
 */
export interface ResolutionBudget {
  /** 预算总额（ms）。 */
  readonly totalMs: number;
  /** 剩余预算（ms，>=0）。 */
  remainingMs(): number;
  /** 本腿可用时限 = min(本腿局部墙, 剩余预算)。 */
  clamp(legWallMs: number): number;
  /** 预算是否已耗尽（0 剩余，或已触发）。 */
  exhausted(): boolean;
  /** 注册「预算耗尽」回调（abort 底层 / 记放弃观测）；返回注销函数。 */
  onExpire(listener: () => void): () => void;
  /** 预算耗尽时 reject 的哨兵（与 {@link exhausted} / {@link onExpire} 同一族命名）；
   *  调用方必须 race 它并在链结束时 `dispose()`。 */
  whenExhausted(): Promise<never>;
  /** 链结束：停表、注销全部监听（幂等）。 */
  dispose(): void;
}

export function createResolutionBudget(totalMs: number = RESOLUTION_CHAIN_BUDGET_MS): ResolutionBudget {
  const startedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let fired = false;
  let disposed = false;
  let rejectExpired: ((err: Error) => void) | null = null;
  let expiredPromise: Promise<never> | null = null;
  const listeners = new Set<() => void>();

  const clearTimer = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  const elapsed = (): number => Date.now() - startedAt;

  const remainingMs = (): number => (fired ? 0 : Math.max(0, totalMs - elapsed()));

  /** 监听器只是副作用（abort / 放弃观测）：单个失败不得影响链路结算。 */
  const notify = (listener: () => void): void => {
    try {
      listener();
    } catch (e) {
      console.warn(`[budget] 预算耗尽回调抛错: ${(e as Error)?.message || e}`);
    }
  };

  const fire = (): void => {
    if (fired || disposed) return;
    fired = true;
    clearTimer();
    for (const listener of listeners) notify(listener);
    rejectExpired?.(new ResolutionBudgetExhaustedError(totalMs));
  };

  const arm = (): void => {
    clearTimer();
    if (disposed || fired) return;
    const rest = totalMs - elapsed();
    if (rest <= 0) {
      fire();
      return;
    }
    timer = setTimeout(fire, rest);
    // Node 下不要让这个计时器拖住进程退出（浏览器/RN 的返回值为数字，无 unref）。
    (timer as unknown as { unref?: () => void }).unref?.();
  };

  const api: ResolutionBudget = {
    totalMs,
    remainingMs,
    clamp: (legWallMs: number) => Math.max(0, Math.min(legWallMs, remainingMs())),
    exhausted: () => fired || remainingMs() <= 0,
    onExpire(listener: () => void) {
      if (fired) {
        notify(listener);
        return () => {};
      }
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    whenExhausted() {
      if (!expiredPromise) {
        expiredPromise = new Promise<never>((_resolve, reject) => {
          if (fired) reject(new ResolutionBudgetExhaustedError(totalMs));
          else rejectExpired = reject;
        });
      }
      return expiredPromise;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimer();
      listeners.clear();
    },
  };
  // 创建即起表：`onExpire` 监听（abort 在飞请求）不能依赖「有人 race 了哨兵」。
  // 触发时若没人 race，只是没人收到那个 promise，不产生 unhandled rejection。
  arm();
  return api;
}
