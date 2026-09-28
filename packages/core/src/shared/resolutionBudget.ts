import { RESOLUTION_CHAIN_BUDGET_MS } from './playbackBudgets.js';

/**
 * **解析链总预算**（resolution budget，#424）：一次 `resolvePlayableSongRouted` /
 * `resolvePlayableUrlRouted` 调用创建**一个** budget，作为参数贯穿整条链
 * （直连腿 → tier3 腿 → 第二条 tier3 腿），而不是模块级全局态——并发解析多首歌时
 * 各自计时、互不干扰。
 *
 * ⚠️ **术语消歧**：既有文档（ADR-0014 决策 2、`TIER3_CHAIN_BUDGET_MS`）里的
 * 「整链 6s 预算」指 **tier3 腿预算**——那是「tier3 的源遍历链」；本模块的
 * `RESOLUTION_CHAIN_BUDGET_MS`（9s）是**整条解析链**的 deadline，两层不同、叠加生效。
 * 为避免一此词两义，本模块与其文档一律称后者为「**解析链总预算**」。
 *
 * 它补的是 2026-09-27-playback-budget-layers 四层时限里缺的第五层：**一次解析链的总上界**。
 * 此前「一首歌最多让用户等多久」不存在于任何一处，只能把 5 个常量相加推出来
 * （直连 3s + tier3 6s + 第二条 tier3 腿 6s = 最坏 15s），失败后 skipGuard 还会
 * fresh 重试 + 自动跳 3 首，用户视角是约两分钟的连续无声期。
 *
 * 三条语义（与各腿的局部墙**叠加**，不取代）：
 * 1. **取小**：每条腿保留自己的局部墙，实际用 `min(本腿墙, 剩余预算)`，各腿局部墙的
 *    语义不变（单源硬墙、直连 3s 墙仍然生效）。
 * 2. **耗尽即 abort**：预算到点触发 `onExpire` 监听（直连腿 abort 底层请求；tier3 腿
 *    由 resolver 的 `control.signal` 停掉在飞源并中止遍历），链本身以
 *    {@link ResolutionBudgetExhaustedError} reject，不再无限等。
 * 3. **排队不走表**：等待 tier3 K=3 槽位期间 `pause()`（ADR 2026-09-25 决策 8 的既有口径：
 *    「被排在后面的调用方不该在没打过任何上游的情况下先超时」）。故 `RESOLUTION_CHAIN_BUDGET_MS`
 *    是**活跃时间**上界，用户可见等待还需加上 K=3 排队时间。
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
 * 一次解析链的预算对象。实现是**可暂停的墙钟**：已消耗时间 = 激活状态下走过的时间之和。
 * 计时器在创建时就起（`onExpire` 监听不能依赖「有人 race 了哨兵」），`dispose()` 停表；
 * 没人 race 的哨兵 promise 不产生 unhandled rejection。
 * unhandled rejection，也不该拖住进程退出。
 */
export interface ResolutionBudget {
  /** 预算总额（ms）。 */
  readonly totalMs: number;
  /** 剩余预算（ms，>=0）；暂停期间不走表。 */
  remainingMs(): number;
  /** 本腿可用时限 = min(本腿局部墙, 剩余预算)。 */
  clamp(legWallMs: number): number;
  /** 预算是否已耗尽（0 剩余，或已触发）。 */
  exhausted(): boolean;
  /** 暂停走表（等待 tier3 K=3 槽位：排队不计入预算）。 */
  pause(): void;
  /** 恢复走表；额度已耗尽则立刻触发。 */
  resume(): void;
  /** 注册「预算耗尽」回调（abort 底层 / 记放弃观测）；返回注销函数。 */
  onExpire(listener: () => void): () => void;
  /** 预算耗尽时 reject 的哨兵（与 {@link exhausted} / {@link onExpire} 同一族命名）；
   *  调用方必须 race 它并在链结束时 `dispose()`。 */
  whenExhausted(): Promise<never>;
  /** 链结束：停表、注销全部监听（幂等）。 */
  dispose(): void;
}

export function createResolutionBudget(totalMs: number = RESOLUTION_CHAIN_BUDGET_MS): ResolutionBudget {
  let elapsedMs = 0;
  let activeSince: number | null = Date.now();
  let pauseDepth = 0;
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

  const elapsed = (): number => elapsedMs + (activeSince === null ? 0 : Date.now() - activeSince);

  const remainingMs = (): number => (fired ? 0 : Math.max(0, totalMs - elapsed()));

  const consume = (): void => {
    if (activeSince !== null) {
      elapsedMs += Date.now() - activeSince;
      activeSince = null;
    }
  };

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
    consume();
    clearTimer();
    for (const listener of listeners) notify(listener);
    rejectExpired?.(new ResolutionBudgetExhaustedError(totalMs));
  };

  const arm = (): void => {
    clearTimer();
    if (disposed || fired || activeSince === null) return;
    const rest = totalMs - elapsedMs;
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
    pause() {
      pauseDepth += 1;
      if (pauseDepth > 1 || activeSince === null) return;
      consume();
      clearTimer();
    },
    resume() {
      if (pauseDepth === 0) return;
      pauseDepth -= 1;
      if (pauseDepth > 0 || activeSince !== null || fired || disposed) return;
      activeSince = Date.now();
      arm();
    },
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
      consume();
      clearTimer();
      listeners.clear();
    },
  };
  // 创建即起表：`onExpire` 监听（abort 在飞请求）不能依赖「有人 race 了哨兵」。
  // 触发时若没人 race，只是没人收到那个 promise，不产生 unhandled rejection。
  arm();
  return api;
}
