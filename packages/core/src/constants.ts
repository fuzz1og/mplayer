import type { SourceKey } from './types/index.js';

// 多源搜索/聚合的固定来源顺序（core 与 mobile 共用）：
// 同名歌曲分组的组内顺序、渐进式渲染的拼装顺序都以它为准，
// 保证增量结果与一次性全量结果完全一致。修改来源列表只需改这一处。
export const MULTI_SOURCE_LIST: SourceKey[] = ['netease', 'qq', 'kugou', 'kuwo', 'migu', 'qianqian', 'soda'];
