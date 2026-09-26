/**
 * 列表窗口档位 —— **只列与 RN 默认不同的值**（#411）。
 *
 * RN（已核对 `@react-native/virtualized-lists` 源码）默认：
 * `windowSize 21` / `maxToRenderPerBatch 10` / `initialNumToRender 10` /
 * `updateCellsBatchingPeriod 50`。
 *
 * 初版这里把这五项全写了一遍，其中三项与默认同值（纯噪声，还让人以为改过）、
 * 一项 `removeClippedSubviews: true` 在 **iOS 上是行为变更**——RN 的 FlatList 文档写明
 * 「The default value is true for Android」，iOS 默认 false 是有原因的（该开关在 iOS 有
 * 已知裁剪问题）。显式打开等于把 iOS 拉进那个坑，而 Android 本来就开着、收益为零。
 *
 * 所以这里只留**真正改动的两项**：窗口从 21 屏收到 7 屏、每批渲染从 10 降到 8。
 */
export const listWindowProps = {
  /** 视口上下各留约 3 屏（默认 21 屏 ≈ 把整份长列表都挂上）。 */
  windowSize: 7,
  /** 每批少渲染一点，让滚动中的每一帧更短。 */
  maxToRenderPerBatch: 8,
} as const;
