/**
 * 推荐页布局度量——单一事实源（#318 真机回归：骨架屏与真实布局漂移）。
 * 冷启动骨架屏必须逐段镜像页面真实结构才有意义，但两边各自写数字必然漂移（推荐页 5 首一批 + 猜你喜
 * 欢 2 列）。
 */

/** 今日推荐每批展示首数（页面 pickRandomBatch 与骨架屏行数共用） */
export const RECOMMEND_BATCH_SIZE = 5;

/** 猜你喜欢网格列数（页面 gridCardWidth 与骨架屏卡片数共用） */
export const RECOMMEND_GRID_COLS = 2;
