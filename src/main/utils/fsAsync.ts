import fsp from 'fs/promises';

/** 异步存在性检查：主进程请求路径上不要用 `fs.existsSync` 同步打磁盘（#412） */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fsp.stat(filePath);
    return true;
  } catch {
    return false;
  }
}
