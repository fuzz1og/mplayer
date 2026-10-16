/**
 * 换源后的歌 id 带源前缀（kuwo:1303464858；旧数据可能多层嵌套 kuwo:kugou:123）：按 ID 识别前循环剥
 * 离，得到源站真实 ID（链接会过期，ID 不会）。
 * 咪咕直连搜索产出裸数字 id（api/miguDirect.ts），补上后与其它源同一套语义。
 */
const SOURCE_ID_PREFIX = /^(netease|qq|kugou|kuwo|migu|qianqian|soda|local):/;

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
