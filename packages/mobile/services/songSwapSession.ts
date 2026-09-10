import type { Song, SourceKey } from '@mplayer/core';
import type { SwapCandidate } from './sourceSwap';

/** 换源弹层快照（两阶段：选源 → 选候选）；visible=false 时 song 可能仍保留（隐藏态） */
export interface SwapSnapshot {
  song: Song | null;
  visible: boolean;
  loading: boolean;
  success: boolean;
  candidates: SwapCandidate[];
  source: SourceKey | null;
}

export const IDLE_SWAP_SNAPSHOT: SwapSnapshot = {
  song: null,
  visible: false,
  loading: false,
  success: false,
  candidates: [],
  source: null,
};

/**
 * 换源会话的外部依赖：core wrapper 与平台效果（Alert / 播放器队列 / 日志）
 * 全部注入，会话本身零 react-native import，可在 environment: 'node' 下单测。
 */
export interface SongSwapDeps {
  search(song: Song, source: SourceKey): Promise<SwapCandidate[]>;
  probe(candidates: SwapCandidate[]): Promise<SwapCandidate[]>;
  apply(song: Song, source: SourceKey, candidate: SwapCandidate): Song | null;
  /** 换源成功后的通用效果：替换播放器队列 / 续播 / 诊断日志 */
  onApplied(original: Song, swapped: Song, candidate: SwapCandidate): void;
  /** 目标源没有可切换版本（提示文案由调用点决定） */
  onEmptySource(source: SourceKey): void;
  onApplyFailed(): void;
  /** 候选探测为不可播：用户确认后才继续切换 */
  confirmUnplayable(candidate: SwapCandidate, proceed: () => void): void;
  /** 成功后延时关闭；由调用点注入（真实 1200ms，测试可手动触发） */
  scheduleClose(run: () => void): void;
}

export interface SongSwapHandlers {
  /** 换源成功回调：父组件用它更新自己的列表 state（歌单页同时持久化） */
  onSwapped?: (original: Song, swapped: Song) => void;
}

export interface SongSwapSession {
  getSnapshot(): SwapSnapshot;
  subscribe(listener: () => void): () => void;
  /** 打开弹层进入阶段 1（选源），重置上一次会话 */
  open(song: Song, handlers?: SongSwapHandlers): void;
  /** 阶段 1：选目标源 → 搜索候选（前 3）→ 渐进探测可播性 */
  selectSource(source: SourceKey): Promise<void>;
  /** 阶段 2：选中候选 → 应用换源（队列 / 续播 / 通知父列表） */
  selectCandidate(candidate: SwapCandidate): void;
  /** 候选列表 → 返回选源 */
  back(): void;
  /** 关闭弹层（保留快照内容播退场；下一次 open 全量复位） */
  close(): void;
}

/**
 * 单曲换源两阶段状态机（语义对齐桌面 src/renderer/hooks/useSongSwap.ts）。
 *
 * 序号守卫：open / selectSource / back / close 每次让 intent 自增；异步结果
 * （搜索、探测）回来时 intent 已变即丢弃——QQ→酷我快速切源时，QQ 的慢探测
 * 结果不会覆盖酷我的候选；关闭后再回来的结果也不会把弹层重新点亮。成功后的
 * 延时关闭同样带序号，不会误关期间新开的会话。
 */
export function createSwapSession(deps: SongSwapDeps): SongSwapSession {
  let snapshot: SwapSnapshot = IDLE_SWAP_SNAPSHOT;
  let handlers: SongSwapHandlers | undefined;
  let intent = 0;
  const listeners = new Set<() => void>();

  const emit = () => { for (const listener of listeners) listener(); };
  const set = (patch: Partial<SwapSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    emit();
  };

  const applyCandidate = (candidate: SwapCandidate) => {
    const { song, source } = snapshot;
    if (!song || !source) return;
    set({ loading: true });
    const swapped = deps.apply(song, source, candidate);
    if (!swapped) {
      set({ loading: false });
      deps.onApplyFailed();
      return;
    }
    set({ success: true });
    deps.onApplied(song, swapped, candidate);
    // 父组件更新自己的列表（歌单页同时持久化）
    handlers?.onSwapped?.(song, swapped);
    const seq = intent;
    deps.scheduleClose(() => {
      if (seq !== intent) return; // 期间已关闭 / 换歌 / 开了新会话：不误关新弹层
      handlers = undefined;
      set({ visible: false, candidates: [], source: null });
    });
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    open(song, nextHandlers) {
      intent += 1;
      handlers = nextHandlers;
      snapshot = { ...IDLE_SWAP_SNAPSHOT, song, visible: true };
      emit();
    },
    async selectSource(source) {
      const song = snapshot.song;
      if (!song) return;
      const seq = (intent += 1);
      set({ loading: true, success: false });
      const found = await deps.search(song, source);
      if (seq !== intent) return;
      if (found.length === 0) {
        set({ loading: false });
        deps.onEmptySource(source);
        return;
      }
      set({ loading: false, source, candidates: found });
      // 异步探测可播性：候选先显示（检测中），探测完成渐进更新标记
      const probed = await deps.probe(found);
      if (seq !== intent) return;
      set({ candidates: probed });
    },
    selectCandidate(candidate) {
      if (!snapshot.source) return;
      if (candidate.playable === false) {
        // 探测为失效：确认后再切换（用户可能想试）
        deps.confirmUnplayable(candidate, () => applyCandidate(candidate));
        return;
      }
      applyCandidate(candidate);
    },
    back() {
      intent += 1;
      // 复位 loading：在途结果会被序号守卫丢弃，不复位就退不回选源列表
      set({ loading: false, candidates: [], source: null });
    },
    close() {
      intent += 1;
      handlers = undefined;
      // 只隐藏：BottomSheet 退场动画期间仍要渲染上一帧内容（旧 setSwapVisible(false) 同义）
      set({ visible: false });
    },
  };
}
