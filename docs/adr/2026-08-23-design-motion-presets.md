# ADR-0004: 动效弹簧预设契约（motion presets）

- 状态：已接受（2026-08-23，UI 重构指南 grilling 定稿；移动端 M0 先行落地）
- 关联：`docs/specs/ui-refactor-guide.md`（§2.4 / §8，移动端主线）；桌面 P4「动效系统」启动时消费本契约并补 CSS 映射

## 背景

iOS 式手感的来源是物理动效（WWDC《Designing Fluid Interfaces》）：默认临界阻尼无过冲，只有手势本身带动量时才允许轻微回弹；一切可触摸动效必须**从当前值启动、可中断、继承松手速度**。

移动端现状：`PlayerOverlay` 入场用 tension/friction 魔法数、关闭是固定 `timing(200ms)`（不可中断、无速度继承）、全仓库无统一动效参数。桌面 P4 尚未启动。若不先立契约，两端会各自长出一套魔法数，事后无法收敛。

## 决策

1. **语义参数以 Apple 的 (ζ 阻尼比, response 秒) 为准，平台各自换算**，命名与语义跨端一致：
   - RN core Animated（mass=1）：`stiffness = (2π/response)²`，`damping = 2ζ·(2π/response)`
   - Web/CSS（桌面 P4 消费时定稿）：近似曲线 `--ease-emphasized: cubic-bezier(0.32, 0.72, 0, 1)` 或 Motion 的 bounce/duration 映射
2. **三预设**（定义于 mobile `theme/motion.ts`）：

   | 预设 | 语义 | ζ / response | stiffness / damping |
   |---|---|---|---|
   | `uiDefault` | 默认全部 UI，临界阻尼无过冲 | 1.0 / 0.4s | ≈247 / ≈31 |
   | `sheet` | 浮层开合、带动量的拖拽释放，唯一允许过冲 | 0.8 / 0.3s | ≈439 / ≈34 |
   | `pressScale` | 按压缩放回弹 | 1.0 / 0.25s | ≈632 / ≈50 |

3. **使用规则**：默认 `uiDefault`；欠阻尼（bounce）只随真实手势动量出现（`sheet`）；可触摸动效从当前呈现值启动（RN 用 `Animated.stopAnimation(v => …)` 读值后重启），松手速度经 spring `velocity` 参数继承；减弱动效（reduced motion）时退化为 cross-fade。
4. **实现载体：RN core Animated，不引 reanimated/gesture-handler。** core Animated 的 `velocity` 参数 + `stopAnimation` 中断模式已覆盖上述全部需求；reanimated 的 additive spring 更优雅但需要 dev-client 重建，收益不足。

## 后果

- 双端动效语义单一事实源，tension/friction/固定时长魔法数退役；
- 无新增原生框架成本（触觉反馈的 expo-haptics 是独立轻量决策，不入本契约）；
- 已知限制：core Animated 的速度混合是"停旧启新"式而非 additive，极端高频连续打断时有微小速度不连续，实际交互频率下不可感知。

## 回退选项

不采用：reanimated 全家桶（重建 dev-client + 心智成本，当前需求覆盖不了其增益）；CSS transition 式固定时长动画（不可中断、无速度概念，正是本次要消灭的形态）。未来若引入复杂共享元素转场再重议载体。
