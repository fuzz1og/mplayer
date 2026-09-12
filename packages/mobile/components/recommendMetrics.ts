/**
 * 推荐页布局度量——单一事实源（#318 真机回归：骨架屏与真实布局漂移）。
 *
 * 冷启动骨架屏必须逐段镜像页面真实结构才有意义，但两边各自写数字必然漂移
 * （推荐页 5 首一批 + 猜你喜欢 2 列）。这里把「一批几首」「网格几列」钉成
 * 共享常量：页面与骨架屏都从这里取，改一处两端同时变；
 * `__tests__/recommendSkeleton.test.ts` 里另有源码级守卫，防止有人再写死。
 */

/** 今日推荐每批展示首数（页面 pickRandomBatch 与骨架屏行数共用） */
export const RECOMMEND_BATCH_SIZE = 5;

/** 猜你喜欢网格列数（页面 gridCardWidth 与骨架屏卡片数共用） */
export const RECOMMEND_GRID_COLS = 2;
