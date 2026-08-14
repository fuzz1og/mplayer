/**
 * 歌词侧车（.lrc）落盘判定（纯计算，双端共用）。
 *
 * 下载时若歌曲有歌词：把 .lrc 写到音频文件同目录同名的 .lrc 文件。侧车文件名
 * 与「该不该写」的判定逻辑都在此处，I/O 端只负责文件读写。
 */

import { replaceExtension } from './container.js';

/**
 * 音频文件名 → 同目录同名的 .lrc 侧车文件名。
 */
export function lrcSidecarName(audioFileName: string): string {
  return replaceExtension(audioFileName, '.lrc');
}

/**
 * 判定一份歌词内容是否值得落盘。含 LRC 时间戳才认为可用；空内容、非法请求页
 * （{"code":...,"msg":"非法请求"}）、无时间戳的 HTML/错误页都判不可用，避免
 * 把错误响应写成歌词文件。
 */
export function looksLikeLyrics(content: string): boolean {
  if (!content || !content.trim()) return false;
  // 非法请求页特征（会话签名失效时服务器返回的 JSON 错误页）
  if (content.includes('非法请求') || content.includes('"code":-2')) return false;
  // 含 [mm:ss.xx] 时间戳行即为可用 LRC
  return /\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/.test(content);
}
