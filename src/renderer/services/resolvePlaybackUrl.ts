import type { PlaybackFailureAdvice, Song } from '@mplayer/core';

/**
 * 播放地址解析（#639 C2）：**输入一首歌，输出它的可播地址或失败归因**。
 *
 * 从 `playerStore.play()` 里提出来的一段（189 行 async 中的最密部分）——它原先混在
 * 传输层加载与四种簿记之间，没有独立接缝，于是只能靠 mock 整张 import 图来测。
 * 本模块**零副作用**：不碰 store、不碰 audioPlayer、不写日志、不弹 toast，
 * 所以它可以零 mock 单测（依赖以端口注入）。
 *
 * ## 契约
 * - 返回 `{ url, nonFull, advice }`：`url` 为空即「解析链没拿到地址」，
 *   同时给出 core 的失败归因（`advice`，可能为 null = 归因本身也失败）。
 * - **不抛错**：失败以返回值表达。异常语义（`PlayableUrlMissingError`）留在编排层
 *   ——`play()` 的 catch 与 `onLoadError` 回调靠 `instanceof` 区分「解析链穷尽」
 *   与「播放器/网络失败」，那条判据不该被搬动。
 * - `nonFull` = 解析结果为**试听片段**（驱动换源提示与徽标）。
 *
 * ## 分支（与原实现逐条对应）
 * 1. 本地文件：`song.url` 直接用，不解析；
 * 2. 汽水且无 url：走 `getSodaPlayableUrl`（分享页免登录直链）；
 * 3. 其余远程源：先（`fresh` 时）遗忘该曲预取条目，再走路由解析链。
 */

/** 本模块的依赖端口（全部由调用方注入，便于零 mock 测试）。 */
export interface ResolvePlaybackUrlDeps {
  /** 路由解析链：直连优先 → tier3 兜底。命中即给地址（含试听版标记）。 */
  resolveRouted: (song: Song) => Promise<{ url?: string; nonFull?: boolean } | null | undefined>;
  /** 汽水音频直链（分享页免登录）。 */
  sodaPlayableUrl: (songId: string) => Promise<string>;
  /**
   * 遗忘该曲的预取条目——里面是刚被证明失败的直链，0 等待命中只会原地连败两次
   * （core 预取缓存 30min TTL + 失败可遗忘）。
   */
  forgetPrefetched: (song: Song) => Promise<void>;
  /** 失败归因（core 按当前配置给出可操作文案）。归因本身失败时返回 null。 */
  explainFailure: (song: Song) => Promise<PlaybackFailureAdvice | null>;
  /** 解析结果为试听版时的通知（驱动 UI 提示与徽标）。 */
  onNonFull?: (song: Song) => void;
  /** 诊断。 */
  log?: (level: 'warn' | 'error', message: string) => void;
}

export interface ResolvedPlayback {
  /** 可播地址；空串 = 解析链未拿到（调用方据此走失败处理）。 */
  url: string;
  /** 解析结果为试听片段。 */
  nonFull: boolean;
  /** `url` 为空时的失败归因（可能为 null）。 */
  advice: PlaybackFailureAdvice | null;
}

export interface ResolvePlaybackOptions {
  /** 换新地址重试（`play()` 的 fresh 路径）：先遗忘该曲预取条目再重走解析链。 */
  fresh?: boolean;
}

export async function resolvePlaybackUrl(
  song: Song,
  deps: ResolvePlaybackUrlDeps,
  options: ResolvePlaybackOptions = {},
): Promise<ResolvedPlayback> {
  const { fresh = false } = options;

  // 本地文件：地址就是它自己，没有解析链可走
  if (song.sourceType === 'local') {
    return { url: song.url ?? '', nonFull: false, advice: null };
  }

  // 汽水且无 url：分享页免登录直链（失败不归因——它不是解析链，走通用提示）
  if (song.sourceType === 'soda' && !song.url) {
    try {
      const url = await deps.sodaPlayableUrl(song.id);
      return { url: url || '', nonFull: false, advice: null };
    } catch (error) {
      deps.log?.('error', `获取汽水音乐可播放 URL 失败: ${error instanceof Error ? error.message : error}`);
      return { url: '', nonFull: false, advice: null };
    }
  }

  // 其余远程源：fresh 先遗忘，再走路由解析链
  if (fresh) {
    await deps.forgetPrefetched(song).catch(() => {});
  }

  let url = '';
  let nonFull = false;
  try {
    const resolved = await deps.resolveRouted(song);
    url = resolved?.url || '';
    if (resolved?.nonFull && url) {
      nonFull = true;
      // nonFull 写回歌曲对象：换元提示与徽标依赖它（只回填这一个字段，不改身份）
      song.nonFull = true;
      deps.onNonFull?.(song);
    }
  } catch (error) {
    // 失败反馈与「重试 / 跳歌」决策统一交给调用方的失败处理，这里不弹提示（避免重复 Toast）
    deps.log?.('error', `获取真实音频 URL 失败: ${error instanceof Error ? error.message : error}`);
    url = '';
  }

  if (url) return { url, nonFull, advice: null };

  // 解析链穷尽（#357）：core 按当前配置给出可操作文案（没有声明对应 source 的源 /
  // 全部因归属被跳过 / 源都试了没命中 / tier3 未开启…），双端共用同一份。
  const advice = await deps.explainFailure(song).catch(() => null);
  return { url: '', nonFull, advice };
}
