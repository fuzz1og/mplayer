import { callMusicApi } from '@/renderer/services/callMusicApi';

/**
 * 带并发限制的批量异步执行，返回 settled 结果（不因单个失败中断整体）。
 * 用于歌单/队列/历史等刷新流程：上游 API 等 API 在高并发下会限流/超时，
 * 全部歌曲同时请求会把连接池打爆（150 并发约 15% 超时），必须限流。
 */
export async function mapSettledWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const limit = Math.min(Math.max(concurrency, 1), items.length);
  const workers = Array.from({ length: limit }, async () => {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { status: 'fulfilled', value: await fn(items[i]) };
      } catch (reason) {
        results[i] = { status: 'rejected', reason };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 带并发限制 + 上游限流自适应退避的批量执行。
 * 上游服务端对同 IP 请求有窗口配额（超出后请求挂起直到超时，实测
 * 连续 2-3 个请求后即开始挂起），必须分批 + 被限流时暂停等待恢复，
 * 否则整列表刷新会打爆 API 导致大面积超时。
 */
export async function mapPacedWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
  options: { batchDelayMs?: number } = {},
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  const limit = Math.min(Math.max(concurrency, 1), items.length);
  const batchDelay = options.batchDelayMs ?? 1000;
  for (let i = 0; i < items.length; i += limit) {
    // 每批开始前查询主进程维护的限流退避状态（core 观察器上报），
    // 被限流则暂停等待恢复，避免继续打超时请求
    const wait = await callMusicApi('getThrottleWait').catch(() => 0);
    if (wait > 0) {
      console.warn(`[apiThrottle] 上游限流，暂停 ${Math.ceil(wait / 1000)}s 后继续刷新`);
      await sleep(wait);
    }
    const batch = items.slice(i, i + limit);
    const settled = await Promise.allSettled(batch.map((item) => fn(item)));
    settled.forEach((r, j) => {
      results[i + j] = r;
    });
    if (i + limit < items.length) await sleep(batchDelay);
  }
  return results;
}
