/**
 * 格式头嗅探单点（wayfinder #122 的 isAudio 预检同源复用）。
 *
 * 图片/音频判定逻辑的唯一事实来源，收敛 diskBackend 与 coverCacheService
 * 各自的逐字节复制。白名单判定行为保持现状不变：
 * - 图片：JPEG / PNG / WebP / GIF / AVIF / ICO(CUR) / BMP
 * - 音频：ID3(MP3) / FLAC / Ogg / MP4 容器 / MPEG(0xFFE0 头)
 *
 * 传 Uint8Array / Buffer 均可（Buffer 是 Uint8Array 子类）。
 */

/** 判定字节内容是否为合法图片格式头（与 isAudioBytes 同一语义层级）。 */
export function isImageBytes(data: Uint8Array): boolean {
  const h = data
  if (h.length >= 3 && h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff) return true // JPEG
  if (h.length >= 8 && h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47) return true // PNG
  if (h.length >= 12 && h[0] === 0x52 && h[1] === 0x49 && h[2] === 0x46 && h[3] === 0x46 && h[8] === 0x57 && h[9] === 0x45 && h[10] === 0x42 && h[11] === 0x50) return true // WebP
  if (h.length >= 6 && h[0] === 0x47 && h[1] === 0x49 && h[2] === 0x46 && h[3] === 0x38) return true // GIF
  if (h.length >= 12 && h[4] === 0x66 && h[5] === 0x74 && h[6] === 0x79 && h[7] === 0x70 && h[8] === 0x61 && h[9] === 0x76 && h[10] === 0x69 && h[11] === 0x66) return true // AVIF (ftypavif)
  if (h.length >= 4 && h[0] === 0x00 && h[1] === 0x00 && h[2] === 0x01 && h[3] === 0x00) return true // ICO/CUR
  if (h.length >= 2 && h[0] === 0x42 && h[1] === 0x4d) return true // BMP
  return false
}

/** 判定字节内容是否为合法音频格式头。 */
export function isAudioBytes(data: Uint8Array): boolean {
  const h = data
  if (h.length >= 3 && h[0] === 0x49 && h[1] === 0x44 && h[2] === 0x33) return true // ID3 (MP3)
  if (h.length >= 4 && h[0] === 0x66 && h[1] === 0x4c && h[2] === 0x61 && h[3] === 0x43) return true // fLaC (FLAC)
  if (h.length >= 4 && h[0] === 0x4f && h[1] === 0x67 && h[2] === 0x67 && h[3] === 0x53) return true // OggS (Ogg)
  if (h.length >= 12 && h[4] === 0x66 && h[5] === 0x74 && h[6] === 0x79 && h[7] === 0x70) return true // ftyp (MP4/M4A 容器)
  if (h.length >= 2 && h[0] === 0xff && (h[1] & 0xe0) === 0xe0) return true // MPEG 帧同步头
  return false
}
