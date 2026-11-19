import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from 'electron';

/**
 * IPC 来源可信校验的单一实现（ADR 2026-11-19-desktop-lyric-overlay-window §5）：
 * 只信 `<dist>` 下的 file:// 与 dev server 同源；无 senderFrame = 测试直调，放行。
 */
export interface TrustedSenderOptions {
  distDir?: string;
  devServerUrl?: string | null;
  warnOnMissingFrame?: boolean;
}

export function isTrustedSenderUrl(url: string, options: TrustedSenderOptions = {}): boolean {
  if (!url) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const devServerUrl = options.devServerUrl === undefined ? process.env.VITE_DEV_SERVER_URL : options.devServerUrl;
  if (devServerUrl) {
    try {
      if (parsed.origin === new URL(devServerUrl).origin) return true;
    } catch {
      // 坏配置不产生信任
    }
  }

  if (parsed.protocol !== 'file:') return false;
  const distDir = options.distDir ?? path.join(app.getAppPath(), 'dist');
  let filePath: string;
  try {
    filePath = fileURLToPath(parsed);
  } catch {
    return false;
  }
  const relative = path.relative(path.resolve(distDir), path.resolve(filePath));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/** 返回错误信息；null = 通过。无 frame 只出现在测试直接调用 handler 的场景。 */
export function checkTrustedSenderFrame(
  frame: Electron.WebFrameMain | null | undefined,
  options: TrustedSenderOptions = {},
): string | null {
  if (!frame) {
    if (options.warnOnMissingFrame) console.warn('[IPC] 未提供 senderFrame（非真实 IPC 调用），放行');
    return null;
  }
  return isTrustedSenderUrl(frame.url || '', options) ? null : `IPC 来源不受信任: ${frame.url ?? 'unknown'}`;
}
