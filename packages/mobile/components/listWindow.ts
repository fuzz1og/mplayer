/**
 * 列表窗口档位 —— 全应用一份（#411）。
 *
 * 此前 11 个 FlatList 各走默认：`windowSize=21`（约 21 屏的挂载窗口）、
 * `initialNumToRender=10`、`maxToRenderPerBatch=10`、`removeClippedSubviews` 未开。
 * 手机端长列表（热榜 / 搜索 / 队列）滚动时同时挂载的行数远超一屏所需。
 *
 * 这里的取值取向：**只留够滑一屏的余量**。`windowSize: 7` 表示视口上下各留约 3 屏，
 * 快速滑动仍有内容、又不会把整份列表挂满；`removeClippedSubviews` 在 Android 上
 * 把滚出视口的行从原生层级摘掉（对固定行高的列表安全——本项目所有歌曲行等高）。
 */
export const LIST_WINDOW = {
  initialNumToRender: 10,
  maxToRenderPerBatch: 8,
  updateCellsBatchingPeriod: 50,
  windowSize: 7,
  removeClippedSubviews: true,
} as const;

/** 直接摊到 FlatList 上的那组 props。 */
export const listWindowProps = {
  initialNumToRender: LIST_WINDOW.initialNumToRender,
  maxToRenderPerBatch: LIST_WINDOW.maxToRenderPerBatch,
  updateCellsBatchingPeriod: LIST_WINDOW.updateCellsBatchingPeriod,
  windowSize: LIST_WINDOW.windowSize,
  removeClippedSubviews: LIST_WINDOW.removeClippedSubviews,
} as const;
