/**
 * 下载文件命名 — 桌面/移动端共享（T19 收敛）。
 *
 * 双端各自拼自己的存储路径（桌面 fs + path.join、移动端 expo-file-system File），
 * 因此 core 只负责生成"纯文件名"，不含目录。命名规则统一解决两件事：
 *
 * 1. **字符安全**：文件系统 + URI 双约束。
 *    - Windows 保留字符（`/ \ : * ? " < > |`）与 URI 非法字符（`[ ] { } ^ % # 反引号`）
 *      一并替换为 `_`。expo-file-system 新 File API 只编码空格不编码方括号，
 *      含 `[]` 的文件名在构建 file:// URI 时会抛 URISyntaxException（移动端下载/播放必失败）。
 *    - 去掉控制字符与路径穿越（`..`），避免任意写。
 * 2. **跨源同名防覆盖**：文件名带来源前缀 + 组合哈希（source:name:artist），
 *    同名/同歌手歌曲来自不同源不会互相覆盖（纯名字文件名会被后下载的顶掉）。
 *
 * 分隔符统一用 `()`（URI 安全），不用 `[]`。
 */

/** Windows 保留字符 + URI 非法字符：这些在 file:// path 或 Windows 文件名里都不能原样出现 */
const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|[\]{}^`%#\x00-\x1f\x7f]/g;

/**
 * 清理单个文件名片段（歌名/歌手/源名）。
 * 返回的片段可安全拼进文件名，但只保证字符安全，不做长度/整体截断（由调用方按需处理）。
 */
export function sanitizeFileNameFragment(part: string): string {
  return (part || 'unknown')
    .replace(ILLEGAL_FILENAME_CHARS, '_')
    .replace(/\.\./g, '_')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface SongFileNameParts {
  /** 来源 key，如 netease/qq；'local' 视为 netease（本地歌曲不需要下载名） */
  source: string;
  /** 歌曲名 */
  name: string;
  /** 歌手 */
  artist: string;
  /** 扩展名（含点，如 .mp3 / .flac）；默认 .mp3 */
  ext?: string;
}

export interface SongFileNameDeps {
  /** 短哈希函数；传入 core 已导出的 md5 */
  hash: (input: string) => string;
}

/** 生成器：注入 hash 依赖（core 的 md5），保持纯函数可测。 */
export function makeSongFileName(deps: SongFileNameDeps) {
  const digestOf = (parts: SongFileNameParts): string =>
    parts.name ? deps.hash(`${parts.source}:${parts.name}:${parts.artist}`).slice(0, 6) : '';

  return function buildSongFileName(parts: SongFileNameParts): string {
    const src = parts.source && parts.source !== 'local' ? parts.source : 'netease';
    const name = sanitizeFileNameFragment(parts.name);
    const artist = sanitizeFileNameFragment(parts.artist);
    const digest = digestOf(parts);
    const ext = parts.ext || '.mp3';
    const full = `(${src}) ${name} - ${artist}${digest ? ` (${digest})` : ''}${ext}`;
    // 超长组合（长歌手名）整体截断到含扩展名 120 字符内，防文件系统路径上限
    return full.length > 120 ? full.slice(0, 117) + ext : full;
  };
}
