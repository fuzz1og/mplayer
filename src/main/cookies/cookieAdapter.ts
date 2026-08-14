/**
 * 桌面 cookie 管理器 adapter（T13 spec #159）。
 *
 * 职责：把 core `cookieManager` 的内存态接到 Electron 主进程磁盘（db.setSetting），
 * 落实「生成逻辑在 core 纯函数、I/O 在此宿主落盘」的职责划分（仿 T01 sourceRouter /
 * T10 tlsFingerprint 的 persister 模式）：
 *
 * - `registerCookiePersister()`：core 每次 cookie 变更（生成/轮换/清除）触发回调 → 写 db；
 * - `loadCookiesFromDisk()`：冷启动把磁盘读到的 cookies 重水合进 core（不触发再落盘）；
 * - `ensureKugouDeviceCookie(reg)`：供 T07 酷狗直连消费的统一取/轮换入口。
 *
 * core 内零 I/O；移动端不接入本 adapter（core 默认即纯内存态）。
 */
import {
  getCookie,
  loadCookies,
  setCookiePersister,
  ensureFreshCookie,
  type SourceCookie,
  type KugouDeviceReg,
} from '@mplayer/core';

/** 各源 cookie 在 db 中各自的存储键前缀（每源独立键，避免互相覆盖）。 */
export function cookieSettingKey(source: string): string {
  return `cookie:${source}`;
}

/** 桌面持久化的源清单。 */
const PERSISTED_SOURCES = ['netease', 'kugou'] as const;

/**
 * 注册持久化回调：任何 cookie 变更 → 落盘 db（fire-and-forget）。
 * 在 registerSettingsIpc（或启动后）调用一次即可。
 */
export function registerCookiePersister(): void {
  setCookiePersister((cookie) => {
    if (!cookie || !cookie.source) return;
    void dbSet(cookieSettingKey(cookie.source), cookie);
  });
}

/** 冷启动重水合：把磁盘读到的 cookies 载入 core（不触发再落盘）。 */
export async function loadCookiesFromDisk(): Promise<void> {
  const list: SourceCookie[] = [];
  for (const source of PERSISTED_SOURCES) {
    try {
      const saved = await dbGet<SourceCookie>(cookieSettingKey(source));
      if (saved && saved.source) list.push(saved);
    } catch (error) {
      console.error(`加载 ${source} cookie 失败:`, error);
    }
  }
  loadCookies(list);
}

/**
 * 酷狗设备 cookie 统一取/轮换入口（供 T07 直连消费）：
 * 仍有效则返回现有，过期/缺失则会用给定设备参数重新生成并落盘。
 * 不传 reg 时会走 core 缺省伪设备参数（可程序化自建，无需用户 cookie）。
 */
export function ensureKugouDeviceCookie(reg?: KugouDeviceReg): SourceCookie {
  return ensureFreshCookie('kugou', { kugouReg: reg });
}

/** 当前内存态 cookie（供排查/管道透传）。 */
export function getSourceCookie(source: 'netease' | 'kugou'): SourceCookie | undefined {
  return getCookie(source);
}

// db 薄封装（便于按需 use-cookie 源扩展，避免本模块耦合 fileStorage 具体实现）
import { db as storageDb } from '../storage/db';

function dbSet(key: string, value: unknown): Promise<void> {
  return storageDb.setSetting(key, value);
}
function dbGet<T>(key: string): Promise<T | undefined> {
  return storageDb.getSetting<T>(key);
}
