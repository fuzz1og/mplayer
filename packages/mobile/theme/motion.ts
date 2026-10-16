/**
 * 动效弹簧预设 —— 契约见 ADR-0004（docs/adr/2026-08-23-design-motion-presets.md）
 * 语义参数为 Apple 的 (ζ 阻尼比, response 秒)，RN core Animated (mass=1) 换算：stiffness = 
 * (2π/response)²    damping = 2ζ·(2π/response)
 */

export interface SpringPreset {
  stiffness: number;
  damping: number;
}

/** 三预设（ζ/response → stiffness/damping 换算值四舍五入到个位） */
export const springs = {
  /** 默认 UI —— ζ1.0 / 0.4s：临界阻尼，无过冲 */
  uiDefault: { stiffness: 247, damping: 31 },
  /** 浮层开合 / 带动量释放 —— ζ0.8 / 0.3s：唯一允许过冲 */
  sheet: { stiffness: 439, damping: 34 },
  /** 按压缩放回弹 —— ζ1.0 / 0.25s */
  pressScale: { stiffness: 632, damping: 50 },
} as const satisfies Record<string, SpringPreset>;

/**
 * 拖拽关闭判决阈值：松手后的动量投影落点越过「面板高度 × 此比例」即判关。
 * 0.35 让快甩从任意位置都能关、慢拖半途自然回弹；PlayerOverlay 与 BottomSheet
 * 共用这一份（曾各自声明一遍），唯一定义在此，改阈值即两端生效。
 */
export const DISMISS_PROJECT_RATIO = 0.35;

/**
 * 位置兜底判关比例：拖动距离越过「面板高度 × 此比例」即判关，不依赖速度。
 * 与 DISMISS_PROJECT_RATIO（动量投影判关）相互独立、取或：位置判据给中低速长拖一个确定性下限，速度
 * 自采样在真机事件密度下不可靠时也不至于「整段拉不动」。
 */
export const DISMISS_POSITION_RATIO = 0.4;

/**
 * 动量投影（Apple 指数衰减模型，非 v²/2a 教科书式）：
 * 松手速度 → 预计继续滑行的距离（px）。decelerationRate 同 UIScrollView：
 * 0.998 = 常规滚动手感，0.99 更利落。
 */
export function projectMomentum(velocityPxPerS: number, decelerationRate = 0.998): number {
  return (velocityPxPerS / 1000) * (decelerationRate / (1 - decelerationRate));
}

/**
 * 橡皮筋渐进阻力（Apple rubber-band）：越界越多跟随越少，
 * 永远达不到 |overshoot| 的线性外推值——"有阻力但还有东西"而非撞墙。
 */
export function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}
