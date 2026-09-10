/**
 * 竖直拖拽关闭：手势会话纯状态机。
 *
 * PlayerOverlay（全屏面板下滑关闭）与 BottomSheet（把手热区下滑关闭）此前各自手抄了
 * 同一套 PanResponder 物理——5 个 ref、首帧原点校准、自采样速度 EMA、动量投影判决、
 * terminate 回弹；两份只有认领阈值与退场编排不同，物理本身完全一致。本模块是这份物理
 * 的唯一实现：改一处，两端同时生效（locality）。
 *
 * 接口边界（深度所在）：
 *   - 只吃手势样本流（dy / 时间戳 / 面板尺寸），只吐「当前位移值 / 速度估计 / 松手判决」；
 *     不碰 Animated、不碰 PanResponder、不碰 React —— 因此可在 node 环境直接单测
 *     （vitest environment: 'node'，见 __tests__/dragSession.test.ts）。
 *   - 绑定见 hooks/useDragToDismiss.ts；退场/回弹动画与 reducedMotion 分支留在调用点
 *     （两端编排不同，不硬塞进内核）。
 *   - 认领判定（isVerticalDragClaim / shouldCaptureDrag）也收在这里：bubble 与 capture
 *     共用同一条「竖直意图」判定，调用点只决定要不要在 capture 阶段抢先（shouldCapture）。
 *
 * Fabric 三坑（原先只活在两个调用点的注释里，收敛到此）：
 *   1. release 回调拿到的框架 gestureState 可能已被下一段触摸序列清零（vy=0）——
 *      松手判定只能用 move 阶段的自采样速度（对呈现位置差分 + EMA）。
 *   2. stopAnimation 的 getValue 走原生异步回路，回调可能晚于首个 move 到达——
 *      calibrate 之前到达的 move 一律丢弃，防止跟手从错误基准起跳。
 *   3. 抓住进行中的动画（入场/退场途中）必须从当前呈现值接续，不能从 0 起跳。
 */
import { DISMISS_PROJECT_RATIO, projectMomentum, rubberband } from '../theme/motion';

/** 一次手势样本：PanResponder 的累计位移 + 事件时间戳 + 橡皮筋维度 */
export interface DragSample {
  /** 手势累计位移（gestureState.dy，px） */
  dy: number;
  /** 事件时间戳（nativeEvent.timestamp，ms） */
  timestamp: number;
  /** 上推越界的橡皮筋阻尼维度（px，一般 = 屏高）：只影响越界跟随的阻力，不影响判关 */
  rubberbandSize: number;
}

/** 松手判决：调用点据此编排退场或回弹 */
export interface DragVerdict {
  /** true = 判关（投影落点越过面板比例），false = 回弹 */
  dismiss: boolean;
  /** 交给 spring 继承的速度（px/s，已钳幅） */
  velocity: number;
}

export interface DragSession {
  /** PanResponderGrant：开启一次会话；调用方随后 stopAnimation 取呈现值 */
  grab(): void;
  /**
   * stopAnimation 回调拿到呈现值后调用（原生异步回路）：落定抓取基准。
   * 在此之前的 move 一律被丢弃。
   */
  calibrate(presentationValue: number): void;
  /** PanResponderMove：1:1 跟手 + 上推橡皮筋；基准未就绪返回 null（该帧丢弃） */
  move(sample: DragSample): number | null;
  /**
   * PanResponderRelease：动量投影判决。
   * `dismissSize` = 判关基准高度（现取，旋转/折叠屏不吃过期值）：投影落点越过
   * `dismissSize × DISMISS_PROJECT_RATIO` 即判关。全屏面板传屏高；底部弹层传面板
   * 自身高度——短面板若拿整屏当基准，正常速度的整段下拉永远够不到判关线。
   */
  release(dismissSize: number): DragVerdict;
  /** PanResponderTerminate：手势被系统抢走 → 零速回弹兜底 */
  terminate(): DragVerdict;
}

/** 自采样速度的瞬时钳幅（px/s）：防弹簧带天文速度瞬扫整屏 */
const SAMPLE_VELOCITY_CLAMP = 4000;
/** 交给 spring 继承的速度钳幅（px/s） */
const RELEASE_VELOCITY_CLAMP = 3000;
/** 采样间隔下限（ms）：更短视为时间戳抖动，该样本丢弃 */
const MIN_SAMPLE_DT = 4;
/** 采样间隔上限（ms）：更长说明中间断了帧，不参与速度估计 */
const MAX_SAMPLE_DT = 100;
/** 速度 EMA 新样本权重（历史 0.6 / 新 0.4：单帧抖动不主导松手判定） */
const VELOCITY_EMA_NEW = 0.4;

const clamp = (v: number, limit: number) => Math.max(-limit, Math.min(limit, v));

/**
 * 创建一次拖拽会话。会话跨手势复用（调用点只建一次），grab 负责清空上一次的状态。
 */
export function createDragSession(): DragSession {
  // 抓取瞬间的面板呈现值（可中断：接管进行中的动画）
  let baseValue = 0;
  // 首个 move 校准出的基准 dy（消除认领前累计位移造成的跳变）；null = 本会话尚未校准
  let baseDy: number | null = null;
  // 最近一帧跟手位置（release 同步可读）。grab 时归零 = 「本会话尚未观察到拖拽」：
  // 一帧 move 都没收到就抬手（认领后立即松手）时投影落点为 0 → 一律回弹，
  // 既不会拿上一次手势的残留位置误判关闭，也不会在没有拖拽的情况下判关。
  let lastPos = 0;
  // move 阶段自采样速度的 EMA 状态：vy 估计值 / 上一帧位置 / 上一帧时间戳（-1 = 尚无样本）
  let vy = 0;
  let vyLastY = 0;
  let vyT = -1;
  // stopAnimation 的呈现值未回来前为 false：头部 move 帧丢弃
  let baseReady = false;

  return {
    grab() {
      baseReady = false;
      baseDy = null;
      lastPos = 0;
      vy = 0;
      vyLastY = 0;
      vyT = -1;
    },

    calibrate(presentationValue) {
      baseValue = presentationValue;
      baseReady = true;
    },

    move(sample) {
      if (!baseReady) return null; // 坑 2：基准未就绪，丢弃该帧
      const { dy, timestamp, rubberbandSize } = sample;
      // 首个 move 校准原点：认领前累计的位移不参与跟手（防瞬移）
      if (baseDy === null) {
        baseDy = dy;
        vyLastY = baseValue;
      }
      // 竖直下拉 1:1 跟手；上推越界给橡皮筋阻力（下拉越界不拦，交给松手投影判决）
      const raw = baseValue + (dy - baseDy);
      const next = raw > 0 ? raw : rubberband(raw, rubberbandSize);
      // 自采样速度：对呈现位置差分；dt 越界的样本丢弃
      const dt = timestamp - vyT;
      if (vyT >= 0 && dt >= MIN_SAMPLE_DT && dt < MAX_SAMPLE_DT) {
        const instantaneous = clamp(((next - vyLastY) / dt) * 1000, SAMPLE_VELOCITY_CLAMP);
        // 首个样本直接播种（不跟 0 做 EMA，否则起步半速）；此后 0.6/0.4 平滑
        vy = vy === 0 ? instantaneous : vy * (1 - VELOCITY_EMA_NEW) + instantaneous * VELOCITY_EMA_NEW;
      }
      vyLastY = next;
      vyT = timestamp;
      lastPos = next;
      return next;
    },

    release(dismissSize) {
      const velocity = clamp(vy, RELEASE_VELOCITY_CLAMP);
      // 动量投影落点：快甩从任意位置都能关，慢拖半途自然回弹
      const projected = lastPos + projectMomentum(velocity);
      return { dismiss: projected >= dismissSize * DISMISS_PROJECT_RATIO, velocity };
    },

    terminate() {
      // 手势被系统抢走（来电等）：不继承速度、不判关，回弹兜底不丢面板
      return { dismiss: false, velocity: 0 };
    },
  };
}

/**
 * 竖直下拉的认领判定（bubble 与 capture 共用）：|dy| 过阈值且纵向占优。
 * 横向留给原生分页 / 子列表滚动——Slider 横向拖动与点按天然不满足此判定。
 * 真机教训：拇指弧线「先横后竖」的起始几帧 |dy| 还不占优，只有 bubble 认领时
 * 会被横向分页 ScrollView 抢走且再也拿不回来（全屏播放器从封面起手拉不动）。
 */
export function isVerticalDragClaim(dx: number, dy: number, threshold: number): boolean {
  return Math.abs(dy) > threshold && Math.abs(dy) > Math.abs(dx);
}

/**
 * capture 阶段是否抢先认领：只有调用点开启「纵向意图优先」时才抢（captureEnabled）。
 * 关着时横向分页照常先认领（歌词页的竖滑仍是歌词滚动，不能被抢）。
 */
export function shouldCaptureDrag(
  dx: number, dy: number, threshold: number, captureEnabled: boolean,
): boolean {
  return captureEnabled && isVerticalDragClaim(dx, dy, threshold);
}
