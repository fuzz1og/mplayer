/**
 * 列表窗口档位 —— **只列与 RN 默认不同的值**（#411）。
 * 显式打开等于把 iOS 拉进那个坑，而 Android 本来就开着、收益为零。
 * 所以这里只留**真正改动的两项**：窗口从 21 屏收到 7 屏、每批渲染从 10 降到 8。
 */
export const listWindowProps = {
  /** 视口上下各留约 3 屏（默认 21 屏 ≈ 把整份长列表都挂上）。 */
  windowSize: 7,
  /** 每批少渲染一点，让滚动中的每一帧更短。 */
  maxToRenderPerBatch: 8,
} as const;
