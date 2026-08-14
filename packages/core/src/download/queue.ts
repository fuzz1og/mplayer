/**
 * 下载队列并发控制（纯计算，双端共用，见 T16）。
 *
 * 队列并发受控 + 单首失败自动续下一首。这里收编两个可单测的纯逻辑点：
 * - takeNextQueued：是否该从队首取下一个任务（受 active 并发数上限约束）。
 * - retryBackoffMs：失败指数退避，且封顶有限次，避免失败任务进入死循环。
 *
 * I/O 端自行维护 active 集合推进引用计数；本模块只管判定。
 */

/** 默认并发上限（沿用现有桌面端 3，作为文档化常量）。 */
export const DEFAULT_MAX_CONCURRENT = 3;

/** 失败后最多重试次数（0 = 首轮即算一尝试，共 1+max 次）。双端统一消费此常量（评审修复）。 */
export const DEFAULT_MAX_RETRIES = 3;

export interface TakeNextResult {
  /** 下一个应启动的任务 id；并发已满或队列空则为 null */
  next: string | null;
  /** 取出后的剩余队列（next 非空时已不含 next） */
  remaining: string[];
}

/**
 * 在并发未满（activeCount < maxConcurrent）时从队首取出一个待下载任务。
 * 返回 next 与剩余队列。并发已满 / 队列空 → next 为 null、队列不变。
 */
export function takeNextQueued(
  queue: string[],
  activeCount: number,
  maxConcurrent: number
): TakeNextResult {
  if (queue.length === 0 || activeCount >= maxConcurrent) {
    return { next: null, remaining: queue.slice() };
  }
  const [next, ...remaining] = queue;
  return { next: next ?? null, remaining };
}

/**
 * 失败重试的指数退避等待毫秒。超过 maxRetries 尝试（即不再重试）返回 -1，
 * 由调用方停止重试并标记失败——有限退避，避免失败任务无限重试.
 */
export function retryBackoffMs(
  attempt: number,
  maxRetries: number = DEFAULT_MAX_RETRIES
): number {
  // attempt >= maxRetries：本次已是最后一轮尝试，失败即停止，不再等待——
  // 避免末次失败后徒增一段无用 sleep（评审修复）
  if (attempt >= maxRetries) return -1;
  return Math.pow(2, attempt) * 1000;
}
