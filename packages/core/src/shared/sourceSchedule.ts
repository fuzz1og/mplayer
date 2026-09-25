/**
 * tier3 源的**会话内调度**（#398 / ADR 2026-09-25-tier3-source-scheduling 决策 1–6）。
 *
 * 只做两件事，都不碰网络：
 * - **健康度定序**：按会话内样本给可用源排序（只改遍历顺序，**绝不缩减候选集**）；
 * - **初始化窗口单飞**：整会话只有一个「交错起手」窗口（第一首进 tier3 的歌本来那次解析）。
 *
 * 状态是模块级 Map（会话内、不落盘、不进 store，与 `tier3Stats` / `prefetchCache` 同取向）。
 * 重置时机（ADR 决策 2）：应用重启（会话内 Map 天然）+ 订阅变更（tier3Api 调 `clearSourceSchedule`）。
 *
 * **计分口径**（ADR 决策 6）：
 * - `reward(hit, ms) = hit ? 1 - min(1, ms / 3000) : 0`——不含耗时会让 987ms 命中与
 *   2617ms 命中同分；
 * - **截尾样本**（`SOURCE_TIMED_OUT`，被单源墙切掉）降权 `w=0.5`：它不是「源坏了」，
 *   是「我们没测到」——实测两步源 2617ms 命中、2s 墙必然切它，按 error 记会把慢而好的源判死；
 * - **放弃观测**（调用方预算用尽 / 用户切走 / 窗口命中后不等在飞的另一条）只写 lastKind，
 *   不进健康度——它反映的是用户切得快，与源无关；
 * - **护栏拒绝**与 **source gate 跳过**在调用方（tier3Api）就不记分（只计数 + trace）。
 */

/** 观测分流（决策 6）：完整观测 / 截尾（降权）/ 放弃（不计分）。 */
export type SourceSampleKind = 'complete' | 'censored' | 'abandoned';

/** 一条观测样本。`censored` 时 `ms` 传被切掉的墙值。 */
export interface SourceSample {
  kind: SourceSampleKind;
  /** 是否产出过过护栏的候选；censored / abandoned 恒 false。 */
  hit: boolean;
  /** 本次耗时（ms）。 */
  ms: number;
}

/** 单源会话内健康状态（可变对象，`noteSample` 原地更新）。 */
export interface SourceHealth {
  score: number;
  samples: number;
  consecutiveFailures: number;
  lastKind: SourceSampleKind;
}

/** 观测/测试用只读快照（非 ADR 列名；`demoted` 由 `consecutiveFailures` 派生）。 */
export interface SourceHealthSnapshot extends SourceHealth {
  demoted: boolean;
}

/** reward 归一化分母：3s 及以上的命中得 0 分。 */
export const SCHEDULE_SCORE_MS_CAP = 3_000;
/** EWMA 学习率（完整观测的权重）。 */
export const SCHEDULE_EWMA_ALPHA = 0.3;
/** 截尾样本的降权系数（决策 6）。 */
export const SCHEDULE_CENSORED_WEIGHT = 0.5;
/** 连续失败多少次才降级（决策 3：N=2；成功一次即回归）。 */
export const SCHEDULE_DEMOTE_AFTER = 2;
/** 中性分：新源初值，也是「无样本源」在部分源有样本时的等效分。 */
export const SCHEDULE_NEUTRAL_SCORE = 0.5;
/** 初始化窗口的交错起手间隔 H（决策 4）。 */
export const SCHEDULE_HEDGE_MS = 600;
/** 初始化窗口内的在飞上限（决策 4/5；全局 K=3 由 sourceRouter 的槽位保证）。 */
export const SCHEDULE_INIT_INFLIGHT = 2;

/** reward(hit, ms) = hit ? 1 - min(1, ms/3000) : 0（ADR 决策 6 原文）。 */
export function reward(hit: boolean, ms: number): number {
  if (!hit) return 0;
  const ratio = Math.min(1, Math.max(0, ms) / SCHEDULE_SCORE_MS_CAP);
  return 1 - ratio;
}

const health = new Map<string, SourceHealth>();
/** 单飞：整个会话只允许一个初始化窗口（决策 5）。 */
let initOpened = false;

function isDemoted(entry: SourceHealth | undefined): boolean {
  return !!entry && entry.consecutiveFailures >= SCHEDULE_DEMOTE_AFTER;
}

/**
 * 计入一条观测。`abandoned` 只更新 `lastKind` 后返回（不进健康度）。
 * 新源初值 = 中性分 0.5；`hit` 清零连续失败计数（成功即回归）。
 */
export function noteSample(sourceId: string, sample: SourceSample): void {
  let entry = health.get(sourceId);
  if (!entry) {
    entry = {
      score: SCHEDULE_NEUTRAL_SCORE,
      samples: 0,
      consecutiveFailures: 0,
      lastKind: sample.kind,
    };
    health.set(sourceId, entry);
  }
  entry.lastKind = sample.kind;
  if (sample.kind === 'abandoned') return;
  const weight = sample.kind === 'censored' ? SCHEDULE_CENSORED_WEIGHT : 1;
  const alpha = SCHEDULE_EWMA_ALPHA * weight;
  entry.score = (1 - alpha) * entry.score + alpha * reward(sample.hit, sample.ms);
  entry.consecutiveFailures = sample.hit ? 0 : entry.consecutiveFailures + 1;
  entry.samples += 1;
}

/** 当前分；**从未有计入样本**时返回 null（与 0 分区分开）。 */
export function scoreOf(sourceId: string): number | null {
  const entry = health.get(sourceId);
  return entry && entry.samples > 0 ? entry.score : null;
}

/**
 * 排序纪律（决策 3 红线）：**只重排、不筛选**——返回新数组，元素集合与输入逐元素相等，
 * 绝不 `filter`/`slice`，所有可用源仍会被尝试。
 *
 * 排序键：① `demoted` 升序（连续失败 N=2 的沉底）；② 等效分降序
 * （`samples > 0 ? score : 中性分`）；③ 清单下标升序（保持清单内相对顺序）。
 * **全部无样本时**三个键都退化 → 与输入逐元素同序（冷启动零行为变化）。
 */
export function orderSources<T extends { id: string }>(sources: readonly T[]): T[] {
  return sources
    .map((source, index) => {
      const entry = health.get(source.id);
      return {
        source,
        index,
        demoted: isDemoted(entry),
        effective: entry && entry.samples > 0 ? entry.score : SCHEDULE_NEUTRAL_SCORE,
      };
    })
    .sort(
      (a, b) =>
        (a.demoted === b.demoted ? 0 : a.demoted ? 1 : -1) ||
        b.effective - a.effective ||
        a.index - b.index,
    )
    .map((item) => item.source);
}

/** 单飞取窗口：整会话只有第一个够格的调用拿到 true（决策 5）。
 *  返回 true 的那一次由调用方负责按「交错起手、在飞 ≤2」的形态解析。 */
export function beginInit(): boolean {
  if (initOpened) return false;
  initOpened = true;
  return true;
}

/** 是否已经发生过初始化（「已开过窗口」≠「样本已足够」）。 */
export function isInitialized(): boolean {
  return initOpened;
}

/** 清空会话内健康度与单飞标记（订阅变更 / 测试重置）。 */
export function clearSourceSchedule(): void {
  health.clear();
  initOpened = false;
}

/** 观测/测试用快照：当前全部有记录的源（含只有 abandoned 样本、`samples === 0` 的）。 */
export function getSourceScheduleSnapshot(): Record<string, SourceHealthSnapshot> {
  return Object.fromEntries(
    [...health].map(([id, entry]) => [id, { ...entry, demoted: isDemoted(entry) }]),
  );
}
