/**
 * 内容元数据缓存（#498）的键约定——**唯一落点**。
 *
 * 内核（\`core/cache/cacheKernel\`）的真键格式是 \`\${namespace}:\${type}:\${key}\`，
 * 移动端 namespace 取默认空串 → 内容条目真键形如
 * \`:json:content:<core ContentCache 的原键>\`（\`:\` 开头，不是 \`content:\` 开头，
 * issue 评审第 1 条踩的就是这个）。
 *
 * 写穿侧（\`services/contentCache\`）与统计侧（\`cache/fileBackend\`）都从这里取，
 * 避免同一个字符串在两处各写一份、日后只改一处。
 */

/** 内核键里 JSON 类型段的字面量（namespace 为空时键以此为前缀）。 */
export const KERNEL_JSON_MARK = ':json:';

/** 本层给内容条目加的命名空间前缀，用来把它与播放资源值等条目分开。 */
export const CONTENT_KEY_PREFIX = 'content:';

/** 内容条目真键里必然出现的那一段。 */
export const CONTENT_KEY_MARK = KERNEL_JSON_MARK + CONTENT_KEY_PREFIX;

/** 这个内核真键是不是内容元数据条目。 */
export function isContentCacheKey(realKey: string): boolean {
  return realKey.includes(CONTENT_KEY_MARK);
}

/**
 * 内核真键 → core \`ContentCache\` 用的原键（把内核前缀与本层命名空间各去掉一层）。
 * 回填时必须走这一步，否则 L1 的键与写穿时的键不一致，回填等于白做（评审第 2 条）。
 * 不是内容条目时返回 null。
 */
export function contentCacheKeyOf(realKey: string): string | null {
  const at = realKey.indexOf(KERNEL_JSON_MARK);
  if (at < 0) return null;
  const bare = realKey.slice(at + KERNEL_JSON_MARK.length);
  return bare.startsWith(CONTENT_KEY_PREFIX) ? bare.slice(CONTENT_KEY_PREFIX.length) : null;
}
