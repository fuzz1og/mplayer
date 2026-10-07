/**
 * 启动更新提示的判据与常量（#579）。
 *
 * 与 `appUpdate.ts`（网络与通道）分开：这里零 I/O、纯函数，便于零 mock 单测。
 * 依据：ADR `docs/adr/2026-10-05-update-prompt-and-silent-desktop-download.md` 决策 6。
 */

/** 进入应用后延时多久再检查（避开首屏请求高峰） */
export const UPDATE_PROMPT_DELAY_MS = 5000;

/**
 * 是否应当弹窗：有新版本，且这个版本没被用户「叉掉」过。
 *
 * 忽略粒度 = 版本号本身（不变量 I7）：忽略 1.8.7 之后，1.8.8 仍会弹。
 * `latestVersion` 缺失（检查没拿到版本号）时不弹——宁可不提示，也不弹一个没有版本号的窗。
 */
export function shouldPromptUpdate(
  latestVersion: string | undefined | null,
  dismissedVersion: string | null,
): boolean {
  if (!latestVersion) return false;
  return latestVersion !== dismissedVersion;
}
