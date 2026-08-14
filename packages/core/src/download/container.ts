/**
 * 音频容器识别（下载管线共用，双端一致）。
 *
 * 下载产物该叫什么扩展名、该不该写 ID3 标签，都取决于「容器类型」而非播放器
 * 猜测。这里是容器判定的唯一事实来源：由文件字节头（复用 sniffers 的格式头
 * 判定）或响应 Content-Type 推断，产出统一的 AudioContainer。
 */

export type AudioContainer = 'mp3' | 'm4a' | 'flac' | 'ogg' | 'unknown';

/**
 * 由文件字节头判定容器。buffer/Uint8Array 均可。
 * 复用一个精简的格式头检查（与 utils/sniffers isAudioBytes 同语义，但更精确区分）。
 */
export function detectAudioContainer(data: Uint8Array): AudioContainer {
  const h = data;
  if (h.length >= 3 && h[0] === 0x49 && h[1] === 0x44 && h[2] === 0x33) return 'mp3'; // ID3
  if (h.length >= 4 && h[0] === 0x66 && h[1] === 0x4c && h[2] === 0x61 && h[3] === 0x43) return 'flac'; // fLaC
  if (h.length >= 4 && h[0] === 0x4f && h[1] === 0x67 && h[2] === 0x67 && h[3] === 0x53) return 'ogg'; // OggS
  if (h.length >= 12 && h[4] === 0x66 && h[5] === 0x74 && h[6] === 0x79 && h[7] === 0x70) return 'm4a'; // ftyp (MP4)
  if (h.length >= 2 && h[0] === 0xff && (h[1] & 0xe0) === 0xe0) return 'mp3'; // MPEG 帧同步头
  return 'unknown';
}

/**
 * 由 HTTP Content-Type 推断容器。未知返回 null（不猜测）。
 */
export function containerFromContentType(contentType: string): AudioContainer | null {
  const ct = (contentType || '').toLowerCase().split(';')[0].trim();
  switch (ct) {
    case 'audio/mpeg':
    case 'audio/mp3':
      return 'mp3';
    case 'audio/mp4':
    case 'video/mp4':
    case 'audio/x-m4a':
    case 'audio/aac':
      return 'm4a';
    case 'audio/flac':
      return 'flac';
    case 'audio/ogg':
    case 'application/ogg':
      return 'ogg';
    default:
      return null;
  }
}

/**
 * 容器 → 文件扩展名。unknown 回退 .mp3（既有行为，避免破坏）。由调用方决定是否
 * 需要精确文件头二次校验。
 */
export function extensionForContainer(container: AudioContainer): string {
  switch (container) {
    case 'mp3':
      return '.mp3';
    case 'm4a':
      return '.m4a';
    case 'flac':
      return '.flac';
    case 'ogg':
      return '.ogg';
    default:
      return '.mp3';
  }
}

/**
 * 把文件名后缀替换为 targetExt（如 .lrc 侧车文件）——与音频同目录同名。
 * 纯字符串运算，无文件系统副作用。
 */
export function replaceExtension(fileName: string, targetExt: string): string {
  const dot = fileName.lastIndexOf('.');
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  return stem + targetExt;
}
