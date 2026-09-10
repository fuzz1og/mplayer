/**
 * 换源后的歌 id 带源前缀（kuwo:1303464858；旧数据可能多层嵌套 kuwo:kugou:123）：
 * 按 ID 识别前循环剥离，得到源站真实 ID（链接会过期，ID 不会）。
 * 原 shared/resolvePlayableUrl.ts 内联实现（#244 共享解析层四件套删除后独立成文件），
 * tier3 / sourceSwap 等仍在使用。
 */
const SOURCE_ID_PREFIX = /^(netease|qq|kugou|kuwo|qianqian|soda|local):/;

export function stripSourceIdPrefix(id: string): string {
  let out = id;
  while (SOURCE_ID_PREFIX.test(out)) out = out.replace(SOURCE_ID_PREFIX, '');
  return out;
}

/**
 * 最外层源前缀（无前缀返回 null）：kuwo:kugou:123 → 'kuwo'。
 * 与 stripSourceIdPrefix 共用同一份前缀表：身份推导（utils/songIdentity）按
 * 「最外层源」折叠多层嵌套，不需要第二份前缀正则。
 */
export function outermostSourceIdPrefix(id: string): string | null {
  const matched = SOURCE_ID_PREFIX.exec(id);
  return matched ? matched[1] : null;
}
