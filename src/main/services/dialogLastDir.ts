import fs from 'fs';
import { app } from 'electron';
import { db } from '../storage/db';

/**
 * 系统对话框上次使用的目录（#670）。
 * 按**用途**分键、不按 IPC 通道分键：`dialog:openDirectory` 同时服务「选下载目录」与
 * 「添加本地音乐文件夹」，共用一把钥匙会让两者互相污染。
 */
export type DialogPurpose = 'download' | 'localMusic' | 'tier3File' | 'playbackTrace';

export function dialogLastDirKey(purpose: DialogPurpose): string {
  return `dialogLastDir:${purpose}`;
}

/** 首次使用（或记忆失效）时的落点：Downloads，与 Electron 43 之前的行为对齐。 */
export function defaultDialogDir(): string {
  return app.getPath('downloads');
}

/**
 * 读出该用途上次确认的目录；没有记忆、或记忆已不存在（被删 / 外接盘拔出）时回落 Downloads。
 * 记忆失效属于正常情况，不抛错、不阻塞对话框打开。
 */
export async function resolveDialogDir(purpose: DialogPurpose): Promise<string> {
  const remembered = await db.getSetting<string>(dialogLastDirKey(purpose));
  if (typeof remembered === 'string' && remembered && isUsableDir(remembered)) return remembered;
  return defaultDialogDir();
}

/** 记下用户本次确认的目录。传目录而非文件路径，调用方负责先取 `dirname`。 */
export async function rememberDialogDir(purpose: DialogPurpose, dir: string): Promise<void> {
  if (!dir) return;
  await db.setSetting(dialogLastDirKey(purpose), dir);
}

function isUsableDir(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}
