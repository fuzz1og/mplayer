/**
 * 竖直拖拽关闭：手势会话纯状态机。
 * 本模块是这份物理的唯一实现：改一处，两端同时生效（locality）。
 * 3. 抓住进行中的动画（入场/退场途中）必须从当前呈现值接续，不能从 0 起跳。
 */
import { DISMISS_PROJECT_RATIO, projectMomentum, rubberband } from '../theme/motion';

/** 一次手势样本：PanResponder 的累计位移 + 事件时间戳 + 橡皮筋维度 */
export interface DragSample {
  /** 手势累计位移（gestureState.dy，px） */
  dy: number;
  /**
   * 该样本的采样时刻（ms，单调）。由适配器在「事件处理时刻」取 JS 单调时钟——
   * 位置（dy）同样取自处理时刻，两者同源才自洽；真机上 nativeEvent.timestamp 的
   * 单位/可用性不可靠（第二轮实测速度自采样恒为 0），故不采用。
   */
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
   * PanResponderRelease：动量投影判决 +（可选）位置兜底判决，两者取或。
   * 全屏面板传屏高且不传 positionRatio；底部弹层传面板自身高度 + DISMISS_POSITION_RATIO。
   */
  release(dismissSize: number, positionRatio?: number): DragVerdict;
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

    release(dismissSize, positionRatio = 0) {
      const velocity = clamp(vy, RELEASE_VELOCITY_CLAMP);
      // 动量投影落点：快甩从任意位置都能关
      const projected = lastPos + projectMomentum(velocity);
      const projectedDismiss = projected >= dismissSize * DISMISS_PROJECT_RATIO;
      // 位置兜底：中低速长拖不依赖速度也能判关（positionRatio = 0 时关闭）
      const positionDismiss = positionRatio > 0 && lastPos >= dismissSize * positionRatio;
      return { dismiss: projectedDismiss || positionDismiss, velocity };
    },

    terminate() {
      // 手势被系统抢走（来电等）：不继承速度、不判关，回弹兜底不丢面板
      return { dismiss: false, velocity: 0 };
    },
  };
}

/**
 * 竖直下拉的认领判定（bubble 与 capture 共用）：enabled + |dy| 过阈值且纵向占优。
 * 真机教训 2：enabled = false 表示这次触摸序列不归本层管（弹层打开期间；或事件从未在本层落下过 
 * DOWN——Modal 卸载后残余事件会漏到下层），那种序列一律不认领，防连带关闭。
 */
export function isVerticalDragClaim(dx: number, dy: number, threshold: number, enabled = true): boolean {
  return enabled && Math.abs(dy) > threshold && Math.abs(dy) > Math.abs(dx);
}

/**
 * 真机教训 4（叶子节点上只挂 move 认领为何整条失效）：RN Android 在 ACTION_DOWN 时锁定 touch target
 * ，后续 MOVE 只派发给同一个 target——认领挂在叶子（BottomSheet 把手热区）时，只有 DOWN 恰好落在那
 * 片叶子内才可能命中；再叠加本闸，认领就会全灭。
 */
export interface TouchSequenceGate {
  /** 本层收到 touch start（bubble 或 capture 任一阶段）→ 该序列归本层 */
  begin(): void;
  /** 序列结束（手势 release/terminate）或作废（弹层打开期间）→ 等下一次本层 DOWN */
  end(): void;
  /** 这次 move 是否归本层管（enabled = 调用点的总开关） */
  allows(enabled: boolean): boolean;
}

export function createTouchSequenceGate(): TouchSequenceGate {
  let owned = false;
  return {
    begin: () => { owned = true; },
    end: () => { owned = false; },
    allows: (enabled) => enabled && owned,
  };
}

/**
 * Modal 内的唯一可靠路径——RN#14295：Modal 内 onMoveShouldSetPanResponder 不触发、Modal 外正常，补
 * 上 start 认领即修复（BottomSheet 把手挂在 Modal 里，走这条）。
 * 挂在根节点、必须先把点按与横向滑动让给子级的场景用（全屏播放器）。
 */
export type DragClaimMode = 'start' | 'move';

/** 触摸开始是否直接成为响应者（'start' 模式） */
export function claimsOnTouchStart(mode: DragClaimMode): boolean {
  return mode === 'start';
}

/**
 * 是否允许系统/子级抢走响应者：'start' 模式必须拒绝（RN#14295 的修法之二：
 * onResponderTerminationRequest: () => false），否则 Modal/Dialog 会在拖动途中把
 * 响应者收走，表现为「拉到一半断掉」。
 */
export function allowsTerminationRequest(mode: DragClaimMode): boolean {
  return mode !== 'start';
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
