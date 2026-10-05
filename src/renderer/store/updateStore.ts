import { create } from 'zustand';

/**
 * 桌面端更新状态的渲染层单一来源（#579）。
 *
 * 为什么需要它：更新状态原先只存在于设置页组件内部（`UpdateSection` 的局部 state），
 * 而徽标挂在侧边栏——两个组件看不到彼此的状态。同时主进程的启动检查可能早于渲染层订阅，
 * 只靠 `update:status` push 会丢事件，所以这里再补一次 `update:getStatus` 快照。
 *
 * 合并规则（ADR `2026-10-05-update-prompt-and-silent-desktop-download.md` 不变量 I3）：
 * 首帧拉一次快照**整体覆盖**；此后只认 push。快照若晚于 push 到达，整份丢弃——
 * 否则会把更新的状态覆盖回旧值。
 */

const ipcRenderer = window.electronAPI;

export type UpdateUiStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error';

export interface UpdateStatusEvent {
  status: UpdateUiStatus;
  version?: string;
  releaseNotes?: string;
  progress?: { percent: number; bytesPerSecond: number; transferred: number; total: number };
  error?: string;
  sourceLabel?: string;
}

/** 徽标唯一判据：只要「有新版 / 在下 / 已下好」都算可更新 */
export function isUpdatePending(status: UpdateUiStatus): boolean {
  return status === 'available' || status === 'downloading' || status === 'downloaded';
}

interface UpdateStoreState {
  status: UpdateUiStatus;
  version: string;
  progress: number;
  error: string;
  sourceLabel: string;
}

interface UpdateStoreActions {
  /**
   * 幂等初始化：订阅一次 `update:status`（push），并发起一次 `update:getStatus`（快照）。
   * 返回退订函数；重复调用返回同一个退订函数，不会重复订阅。
   */
  initUpdateBridge: () => () => void;
  /** 应用一条主进程状态（push 与快照共用） */
  applyStatus: (payload: UpdateStatusEvent) => void;
}

export type UpdateStore = UpdateStoreState & UpdateStoreActions;

const INITIAL: UpdateStoreState = {
  status: 'idle',
  version: '',
  progress: 0,
  error: '',
  sourceLabel: '',
};

/** 已收到多少次 push：快照请求期间若计数变化，说明快照已过时 */
let pushCount = 0;
let bridged = false;
let unsubscribeBridge: (() => void) | null = null;

export const useUpdateStore = create<UpdateStore>((set) => ({
  ...INITIAL,

  applyStatus: (payload) =>
    set((state) => ({
      status: payload.status,
      // 版本与通道只在事件携带时更新：downloading / downloaded 的 push 不带它们，
      // 归零会让设置页在下载途中丢掉版本号与通道名
      version: payload.version ?? state.version,
      // 进度归零表示「本次进度已结束」；只有下载进度事件携带它
      progress: payload.progress ? payload.progress.percent : 0,
      error: payload.error ?? '',
      sourceLabel: payload.sourceLabel ?? state.sourceLabel,
    })),

  initUpdateBridge: () => {
    if (bridged) return unsubscribeBridge ?? (() => {});
    bridged = true;

    const handler = (_event: unknown, payload: UpdateStatusEvent) => {
      pushCount += 1;
      useUpdateStore.getState().applyStatus(payload);
    };
    ipcRenderer.on('update:status', handler);
    unsubscribeBridge = () => {
      ipcRenderer.removeListener('update:status', handler);
      bridged = false;
      unsubscribeBridge = null;
    };

    const countAtRequest = pushCount;
    void (async () => {
      try {
        // registerIpcHandlerSimple：裸返回，无 { success, data } 封套
        const snapshot = (await ipcRenderer.invoke('update:getStatus')) as UpdateStatusEvent | undefined;
        // 不变量 I3：快照期间已有 push 到达 → 整份丢弃，不回退状态
        if (pushCount !== countAtRequest) return;
        if (snapshot) useUpdateStore.getState().applyStatus(snapshot);
      } catch {
        // 快照拿不到不影响 push 通道；启动检查本身也是静默的
      }
    })();

    return unsubscribeBridge;
  },
}));
