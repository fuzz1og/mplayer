import type { MusicApiMethodMap } from '@/shared/musicApiContract';
import { IpcClient } from './IpcClient';

/**
 * music 域 IPC 单通道泛型入口（ADR-0001）。
 * 类型自 `MusicApiMethodMap` 派生：方法名 / 参数 / 返回类型全类型安全。
 */
type MusicApiKeys = keyof MusicApiMethodMap;

export async function callMusicApi<K extends MusicApiKeys>(
  method: K,
  ...args: Parameters<MusicApiMethodMap[K]>
): Promise<Awaited<ReturnType<MusicApiMethodMap[K]>>> {
  return IpcClient.invoke<Awaited<ReturnType<MusicApiMethodMap[K]>>>(
    'musicApi:call',
    method,
    ...args,
  );
}
