import fsp from 'fs/promises';

/**
 * 汽水音频缓存的容量预算与回收（#412）。
 *
 * 两个边界：
 * - **按 key 前缀精确回收**，不是扫目录。`cache/bin` 里还躺着渲染层写入的其它 bin
 *   条目，按目录淘汰会误伤它们。用 `DiskCacheBackend.keys()` 拿到真实 key（#410 的接口）
 *   再筛前缀，只动属于汽水音频的那一批；路径交给后端自己的 `getFilePath` 解释，
 *   磁盘布局不往调用方泄漏（ADR-0002 的取向）。
 * - **全程异步**：keys()/stat/unlink 都在线程池里，调用方 fire-and-forget
 *   （清理失败绝不该影响播放出 URL）。
 */

/** 后端需要的能力：列出真实 key + 把 key 映射成落盘路径 */
export interface KeyedCacheBackend {
  keys(): Promise<string[]>;
  getFilePath(key: string): string;
}

/** 把符合 `keyPrefix` 的条目总字节压回预算内（按 mtime 最旧的先删），返回删除条目数 */
export async function enforceKeyBudget(
  backend: KeyedCacheBackend,
  keyPrefix: string,
  maxBytes: number,
): Promise<number> {
  try {
    const keys = (await backend.keys()).filter((key) => key.startsWith(keyPrefix));
    if (keys.length === 0) return 0;

    const entries = await Promise.all(
      keys.map(async (key) => {
        const full = backend.getFilePath(key);
        try {
          const st = await fsp.stat(full);
          return st.isFile() ? { full, size: st.size, at: st.mtimeMs } : null;
        } catch {
          return null;
        }
      }),
    );
    const files = entries.filter((e): e is { full: string; size: number; at: number } => e !== null);
    let total = files.reduce((sum, f) => sum + f.size, 0);
    if (total <= maxBytes) return 0;

    files.sort((a, b) => a.at - b.at);
    let removed = 0;
    for (const file of files) {
      if (total <= maxBytes) break;
      try {
        await fsp.unlink(file.full);
        total -= file.size;
        removed += 1;
      } catch {
        // 单个文件删不掉（占用等）就跳过，不影响其它
      }
    }
    return removed;
  } catch {
    // keys() 不可用（索引尚未就绪等）：这次跳过，下次写盘再收
    return 0;
  }
}
