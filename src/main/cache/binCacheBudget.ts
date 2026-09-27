import fsp from 'fs/promises';
import path from 'path';

/**
 * bin 缓存目录的容量预算与回收（#412）。
 *
 * 两个边界写清楚：
 * - **目录不在这里硬编码**：由调用方经 `binDirOf(backend)` 用 `DiskCacheBackend.getFilePath()`
 *   推导。磁盘布局（`<cacheDir>/bin/<hash>`）归缓存模块自己解释，调用方不该手拼
 *   `<userData>/cache/bin`——这是 ADR-0002「缓存 key/路径内聚在语义模块里」的取向。
 * - **回收是「按目录」的**：不区分 key，可能连带淘汰渲染层写入的其它 `bin` 条目。
 *   删缓存文件本身安全（按需重新拉取）；若要精确到 `bin:soda:*`，需要在
 *   `DiskCacheBackend` 上暴露 `keys()`（属于它的接口面）。
 */

/** 从后端推出的 bin 目录：`:bin:` 这个 key 的落点所在目录就是它 */
export function binDirOf(backend: { getFilePath(key: string): string }): string {
  return path.dirname(backend.getFilePath(':bin:'));
}

/**
 * 把目录的总字节压回预算内（按 mtime 最旧的先删）。全程异步：目录扫描 + stat 都在
 * 线程池里，不阻塞主进程。调用方 fire-and-forget（清理失败绝不该影响播放出 URL）。
 */
export async function enforceBinBudget(binDir: string, maxBytes: number): Promise<void> {
  try {
    const names = await fsp.readdir(binDir);
    const entries = await Promise.all(
      names.map(async (name) => {
        const full = path.join(binDir, name);
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
    if (total <= maxBytes) return;
    files.sort((a, b) => a.at - b.at);
    for (const file of files) {
      if (total <= maxBytes) break;
      try {
        await fsp.unlink(file.full);
        total -= file.size;
      } catch {
        // 单个文件删不掉（占用等）就跳过，不影响其它
      }
    }
  } catch {
    // 目录不存在等：无可清理
  }
}
