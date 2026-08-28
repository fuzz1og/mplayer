import { ipcMain } from 'electron';
import { CONTENT_METHODS, getDirectClient } from '@mplayer/core';
import type { ContentMethod, SourceKey, Song } from '@mplayer/core';
import type { ApiResponse } from '@/shared/types/ipc';
import type { BaseMethod, MusicApiMethodMap, MainOnlyMethods } from '@/shared/musicApiContract';
import { getAggregatedChart } from '../services/chartAggregator';

/**
 * music 域 IPC 单通道分发（ADR-0001）：`musicApi:call` 查表分发。
 *
 * - 基础方法 + MainOnly：手写分发表 `satisfies Omit<MusicApiMethodMap, ContentMethod>`
 *   （方法名拼错 / 签名不符 / 漏方法 → 编译期必报错）；
 * - 内容方法（#240）：CONTENT_METHODS 清单循环泛型分派到 `getDirectClient(source)`，
 *   能力探测 = 客户端方法存在性，未实现源明确抛错。
 */

/**
 * main.ts 扩展后的 musicApi（core 门面基础方法 + getSodaPlayableUrl + resolvePlaylistLink）。
 * 内容方法不经门面——按清单循环分派到直连客户端。
 */
type CoreMusicApi = typeof import('@/main/api/musicApi').musicApi;
type MusicApi = Pick<CoreMusicApi, BaseMethod> & {
  getSodaPlayableUrl: MainOnlyMethods['getSodaPlayableUrl'];
  resolvePlaylistLink: MainOnlyMethods['resolvePlaylistLink'];
};

/**
 * 注册单个 `musicApi:call` 分发通道。
 * 旧 `musicApi:*` / `lyrics:get` / `api:getThrottleWait` 通道已删除，music 域收敛为
 * `musicApi:call` 单通道；core 方法通过 MUSIC_API_METHODS 收编，内容方法经
 * CONTENT_METHODS 循环接线（#278 契约派生），MainOnly 方法
 * （getAggregatedChart / getSodaPlayableUrl / resolvePlaylistLink）在分发表内单独接线。
 */
export function registerMusicApiCall(api: MusicApi): void {
  // ── 基础方法 + main 独有组合方法（手写表，satisfies 钉死签名）──────
  const base = {
    // ── core musicApi 基础方法（泛型 forward）────────────────────
    probeSongsBatch: (s: Song[]) => api.probeSongsBatch(s),
    getLyrics: (url: string) => api.getLyrics(url),
    getQqPlaylistSongs: (s: string | number) => api.getQqPlaylistSongs(s),
    getSodaAudioUrl: (trackId: string) => api.getSodaAudioUrl(trackId),
    getSodaLyrics: (trackId: string) => api.getSodaLyrics(trackId),
    parseSodaShareLink: (link: string) => api.parseSodaShareLink(link),
    searchSongsRouted: (k: string, p: number, s: SourceKey) => api.searchSongsRouted(k, p, s),
    resolvePlayableUrlRouted: (song: Song) => api.resolvePlayableUrlRouted(song),
    resolvePlayableSongRouted: (song: Song) => api.resolvePlayableSongRouted(song),
    // ── main 独有组合方法 ─────────────────────────────────────────
    getAggregatedChart,
    getSodaPlayableUrl: (trackId: string) => api.getSodaPlayableUrl(trackId),
    resolvePlaylistLink: (url: string) => api.resolvePlaylistLink(url),
  } satisfies Omit<MusicApiMethodMap, ContentMethod>;

  // ── 内容方法：清单循环泛型分派到直连客户端（能力探测式）──────────
  const dispatch = base as MusicApiMethodMap;
  for (const method of CONTENT_METHODS) {
    (dispatch as unknown as Record<string, (...xs: unknown[]) => unknown>)[method] = (...xs: unknown[]) => {
      const source = xs[0] as SourceKey;
      const client = getDirectClient(source);
      const fn = client?.[method] as ((...a: unknown[]) => unknown) | undefined;
      if (typeof fn !== 'function') {
        throw new Error(`源 ${source} 未实现内容能力 ${method}`);
      }
      // 必须以客户端为接收者调用：内容方法实现依赖 this（如 getAlbumDetail 内部
      // this.resolvePlayableUrls），脱体调用会丢 this 直接 TypeError
      return fn.apply(client, xs.slice(1));
    };
  }

  ipcMain.handle(
    'musicApi:call',
    async <T>(
      event: Electron.IpcMainInvokeEvent,
      method: string,
      ...args: unknown[]
    ): Promise<ApiResponse<T>> => {
      // 审查修复：sender 校验（仅应用页面可调用；测试直接调用无 senderFrame 时放行）
      const senderUrl = event?.senderFrame?.url;
      const isTrusted =
        !senderUrl ||
        senderUrl.startsWith('file://') ||
        (process.env.VITE_DEV_SERVER_URL ? senderUrl.startsWith(process.env.VITE_DEV_SERVER_URL) : false);
      if (!isTrusted) {
        console.warn(`[IPC] 拦截非可信来源 musicApi:call: ${senderUrl ?? 'unknown'}`);
        return { success: false, error: 'IPC 来源不受信任' };
      }

      const handler = (dispatch as unknown as Record<string, (...xs: unknown[]) => unknown>)[method];
      if (typeof handler !== 'function') {
        return { success: false, error: `unknown musicApi method: ${method}` };
      }
      try {
        const data = await (handler as any)(...args);
        return { success: true, data };
      } catch (error) {
        console.error(`[IPC] musicApi:call(${method}) 失败:`, error);
        return {
          success: false,
          error: error instanceof Error ? error.message : '未知错误',
        };
      }
    },
  );
}
