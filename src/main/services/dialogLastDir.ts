import fsp from 'fs/promises';
import { app } from 'electron';
import { db } from '../storage/db';

/**
 * 系统对话框上次使用的目录（#670）。
 * 按**用途**分键、不按 IPC 通道分键：`dialog:openDirectory` 同时服务「选下载目录」与
 * 「添加本地音乐文件夹」，共用一把钥匙会让两者互相污染。
 */

/** 唯一事实源：新增用途改这里，白名单与类型自动跟上（手抄副本会让新用途静默降级）。 */
export const DIALOG_PURPOSES = ['download', 'localMusic', 'tier3File', 'playbackTrace'] as const;

export type DialogPurpose = (typeof DIALOG_PURPOSES)[number];

export function isDialogPurpose(value: unknown): value is DialogPurpose {
  return typeof value === 'string' && (DIALOG_PURPOSES as readonly string[]).includes(value);
}

export function dialogLastDirKey(purpose: DialogPurpose): string {
  return `dialogLastDir:${purpose}`;
}

/** 首次使用（或记忆失效）时的落点：Downloads，与 Electron 43 之前的行为对齐。 */
export function defaultDialogDir(): string {
  return app.getPath('downloads');
}

/**
 * 读出该用途上次确认的目录。读盘出错、没有记忆、记忆已不是可用目录时一律回落 Downloads：
 * 记住上次位置是锦上添花，任何情况下都不该让对话框打不开。
 */
export async function resolveDialogDir(purpose: DialogPurpose): Promise<string> {
  try {
    const remembered = await db.getSetting<string>(dialogLastDirKey(purpose));
    if (typeof remembered === 'string' && remembered && (await isDirectory(remembered))) return remembered;
  } catch (error) {
    console.warn('[dialogLastDir] 读取上次目录失败，回落 Downloads:', error);
  }
  return defaultDialogDir();
}

/** 记下用户本次确认的目录。传目录而非文件路径，调用方负责先取 `dirname`。 */
export async function rememberDialogDir(purpose: DialogPurpose, dir: string): Promise<void> {
  if (!dir) return;
  try {
    await db.setSetting(dialogLastDirKey(purpose), dir);
  } catch (error) {
    // 落盘失败不该回滚用户刚完成的操作（选目录 / 选清单 / 导出都是主任务）。
    console.warn('[dialogLastDir] 记忆上次目录失败:', error);
  }
}

// 只认目录：记忆里可能被手工改成文件路径。走 fs/promises 而非 statSync（#412 主进程同步 I/O 纪律）。
async function isDirectory(candidate: string): Promise<boolean> {
  try {
    return (await fsp.stat(candidate)).isDirectory();
  } catch {
    return false;
  }
}
