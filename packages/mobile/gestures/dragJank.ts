/**
 * 拖拽跟手卡顿测量：手势样本流 → 一次手势的「跟手帧距」统计。
 *
 * 为什么需要它（#430）：拖拽跟手每帧都要过 JS 线程——PanResponder 的 move 回调
 * → Animated.Value.setValue。JS 线程被别的活占住时，move 回调会被推迟/合并，
 * 用户看到的是「手指在动、面板不动」。
 *
 * **这不是渲染掉帧**：JS 卡住时 UI 线程根本没被要求画新帧，所以系统侧帧统计
 * （gfxinfo / SurfaceFlinger）在同一段时间里可能反而「很健康」（帧数少但每帧都准时）。
 * 本模块量的正是「相邻两次 move 回调隔了多久」——跟手断没断。
 * ⇒ 判据必须**两个量一起看**：本模块（JS 线程被占了吗）+ 系统侧帧计时（用户看得见吗）。
 *
 * 与 perfMonitor 的分工：perfMonitor 是常驻的 JS rAF 看门狗（2s 窗口、连续 2 窗才报），
 * 对一次一两秒的拖拽结构性失明；本模块只在手势期间工作，一次手势一条结论。
 *
 * 纯模块：零 react-native 依赖、零时钟调用（时间戳由适配器注入），node 环境直接单测
 * （vitest environment: 'node'，见 __tests__/dragJank.test.ts）。
 */

/** 一帧预算（ms，60Hz）：相邻 move 回调超过它 = 至少漏掉一次跟手更新 */
export const FRAME_BUDGET_MS = 16.7;

/** 判语所需的最少间隔数：更短的手势（轻点、微拖）不给结论 */
export const MIN_INTERVALS_FOR_VERDICT = 5;

/**
 * 单次手势参与**间隔统计**的最大观测点数（正常拖拽只有几十个，这是病态长拖的兜底）。
 * 到达上限后：`spanMs` 与 `tailMs` 仍随观测点推进（它们只依赖首末点），只有分位数 /
 * 超帧占比停止累积——即「结论基于前 N 个点」，不是「把后面的点当成不存在」。
 */
export const MAX_SAMPLES = 600;

/** 单次间隔达到它即判掉帧（ms，≈3 帧）：JS 线程被明显占住 */
export const JANK_MAX_GAP_MS = 50;

/** 超预算间隔占比达到它即判掉帧：持续性的跟手迟滞（不要求某一次特别长） */
export const JANK_DROP_RATIO = 0.2;

/** 一次手势的跟手统计 */
export interface DragJankReport {
  /** move 回调次数 */
  samples: number;
  /** 相邻 move 回调的间隔数 = samples - 1 */
  intervals: number;
  /** 首个 move → 末个 move 的时长（ms） */
  spanMs: number;
  /** 间隔的 50 / 95 分位与最大值（ms） */
  p50Ms: number;
  p95Ms: number;
  maxGapMs: number;
  /** 间隔超过 FRAME_BUDGET_MS 的数量 */
  overBudget: number;
  /**
   * 末个 move → 松手回调的间隔（ms）。**不进判语**：里面混着用户「拖到位后停顿再抬手」
   * 的正常延迟，拿来判掉帧会误报；留着只为人工看现场。
   */
  tailMs: number;
}

export interface DragJankMeter {
  /** 手势开始（认领）：清空上一次的状态。首个 move 到达前不产生任何观测点 */
  start(): void;
  /** move 回调：记一个观测点 */
  sample(at: number): void;
  /** 松手/被系统抢走：算结论。样本不足返回 null（不给结论，而不是给「正常」） */
  finish(at: number): DragJankReport | null;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** 升序数组的分位数（最近秩法：idx = ceil(p·n) - 1） */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = clamp(Math.ceil(p * sorted.length) - 1, 0, sorted.length - 1);
  return sorted[idx]!;
}

/**
 * 创建跟手统计器。会话跨手势复用（调用点只建一次），start 负责清空上一次的状态。
 */
export function createDragJankMeter(): DragJankMeter {
  let first = -1;
  let last = -1;
  let count = 0;
  const gaps: number[] = [];

  const reset = () => {
    first = -1;
    last = -1;
    count = 0;
    gaps.length = 0;
  };

  return {
    start() {
      reset();
    },

    sample(at) {
      if (first < 0) {
        first = at;
        last = at;
        count = 1;
        return;
      }
      const dt = at - last;
      // 时钟回拨（负间隔）会让分位数失去意义，丢弃；同一毫秒内的合并回调是真实事件密度，保留。
      if (dt < 0) return;
      // 末个观测点始终推进：上限只截断间隔统计，不该让 span / 尾距跟着失真
      last = at;
      if (count >= MAX_SAMPLES) return;
      gaps.push(dt);
      count += 1;
    },

    finish(at) {
      if (count < 2) return null;
      const intervals = gaps.length;
      if (intervals < MIN_INTERVALS_FOR_VERDICT) return null;
      const sorted = [...gaps].sort((a, b) => a - b);
      return {
        samples: count,
        intervals,
        spanMs: last - first,
        p50Ms: percentile(sorted, 0.5),
        p95Ms: percentile(sorted, 0.95),
        maxGapMs: sorted[sorted.length - 1]!,
        overBudget: gaps.filter((g) => g > FRAME_BUDGET_MS).length,
        tailMs: Math.max(0, at - last),
      };
    },
  };
}

/**
 * 判语：单次长间隔（JS 被明显占住一次）或超预算占比过高（持续性迟滞）任一成立即判「跟手掉帧」。
 * 两个判据都必要——只看最大值会被偶发一次 GC 误伤，只看占比会漏掉「卡死 300ms 再恢复」。
 */
export function isJanky(report: DragJankReport): boolean {
  if (report.intervals <= 0) return false;
  return (
    report.maxGapMs >= JANK_MAX_GAP_MS ||
    report.overBudget / report.intervals >= JANK_DROP_RATIO
  );
}

/**
 * 一行、可被 logcat 直接匹配的现场字符串（真机验收按消息本体断言）。
 * `label` = 拖拽接入点名（BottomSheet 壳 / 全屏播放器）：两个接入点的宿主与内容结构都不同，
 * 没有它就分不清「哪个面在卡」，按接入点归因也就无从谈起。
 */
export function formatDragJank(report: DragJankReport, label = 'unknown'): string {
  return (
    '[drag] 面板=' + label +
    ' 样本=' + report.samples +
    ' 时长=' + Math.round(report.spanMs) + 'ms' +
    ' p50=' + Math.round(report.p50Ms) + 'ms' +
    ' p95=' + Math.round(report.p95Ms) + 'ms' +
    ' max=' + Math.round(report.maxGapMs) + 'ms' +
    ' 超帧=' + report.overBudget + '/' + report.intervals +
    '(' + Math.round((report.intervals > 0 ? report.overBudget / report.intervals : 0) * 100) + '%)' +
    ' 尾距=' + Math.round(report.tailMs) + 'ms' +
    ' → ' + (isJanky(report) ? '跟手掉帧' : '跟手正常')
  );
}
