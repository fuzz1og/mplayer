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
