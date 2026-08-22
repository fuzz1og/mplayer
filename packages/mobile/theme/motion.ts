/**
 * 动效弹簧预设 —— 契约见 docs/adr/0004-design-motion-presets.md
 *
 * 语义参数为 Apple 的 (ζ 阻尼比, response 秒)，RN core Animated (mass=1) 换算：
 *   stiffness = (2π/response)²    damping = 2ζ·(2π/response)
 *
 * 使用规则：
 *   - 默认 uiDefault（临界阻尼无过冲）；
 *   - 欠阻尼（sheet，轻微回弹）只随真实手势动量出现；
 *   - 可触摸动效从当前呈现值启动（Animated.stopAnimation 读值后重启），松手速度经 spring velocity 继承。
 *
 * 本文件保持零 react-native 依赖（纯数值），便于 node 环境单测。
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
