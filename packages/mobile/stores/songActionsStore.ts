import { create } from 'zustand';
import type { Song, SourceKey } from '@mplayer/core';
import type { SwapCandidate } from '../services/sourceSwap';
import {
  createSwapSession,
  IDLE_SWAP_SNAPSHOT,
  type SongSwapDeps,
  type SongSwapSession,
  type SwapSnapshot,
} from '../services/songSwapSession';

/** 行级回调：打开面板时记录，供「移除」项与换源成功通知持有列表的父组件 */
export interface SongActionHandlers {
  /** 换源成功回调：父组件更新自己的列表 state（歌单页同时持久化） */
  onSwap?: (original: Song, swapped: Song) => void;
  /** 提供后「更多」菜单显示「移除」项（歌单 / 播放历史列表用） */
  onRemove?: (song: Song) => void;
}

/** 「更多」操作面板：visible=false 后仍保留 song/handlers，
 *  让 BottomSheet 播完退场动画（内容不闪空，与旧行内 state 行为一致） */
export interface ActionSheetState {
  song: Song;
  handlers: SongActionHandlers;
  visible: boolean;
}

/** 加入歌单弹层：同上，隐藏后保留 song */
export interface PlaylistSheetState {
  song: Song;
  visible: boolean;
}

/**
 * 平台效果：换源依赖 + 「更多」面板里的两个动作（下载 / 搜索歌手）。
 * 这是控制器与 react-native 的唯一接缝（实现见 services/songActionEffects.ts），
 * store 与换源会话都零 react-native import，可在 node 下单测。
 */
export interface SongActionEffects extends SongSwapDeps {
  download(song: Song): void;
  searchArtist(song: Song): void;
}

/**
 * song actions 控制器（#304）：独占「哪首歌的哪个弹层开着」——
 * 操作面板与加入歌单弹层任一时刻最多一个可见；换源两阶段状态机（含序号守卫）
 * 委托给 services/songSwapSession.ts 的全应用单例会话。
 * 歌曲行只调 openActions(song, handlers)，不再渲染任何弹层。
 */
export interface SongActionsState {
  /** 「更多」操作面板（null = 从未打开） */
  actionSheet: ActionSheetState | null;
  /** 加入歌单弹层（null = 从未打开） */
  playlist: PlaylistSheetState | null;
  /** 换源弹层快照（由 swap 会话订阅回写） */
  swap: SwapSnapshot;

  /** 行内「更多」：打开操作面板 */
  openActions(song: Song, handlers?: SongActionHandlers): void;
  closeActions(): void;
  /** 操作面板「加入歌单」：收起面板 → 打开加入歌单弹层 */
  openAddToPlaylist(song: Song): void;
  closeAddToPlaylist(): void;
  /** 操作面板「换源完整版」：收起面板 → 打开换源弹层（阶段 1） */
  openSwap(song: Song, handlers?: SongActionHandlers): void;
  closeSwap(): void;
  selectSwapSource(source: SourceKey): Promise<void>;
  selectSwapCandidate(candidate: SwapCandidate): void;
  swapBack(): void;
}

let session: SongSwapSession | null = null;
let unsubscribeSession: (() => void) | null = null;

/**
 * 绑定平台效果（应用启动时由 components/SongActionsHost.tsx 模块顶层调用一次）。
 * 全应用单例会话：一份换源状态 + 一个序号守卫，替代每行各持一份的 5 个 useState。
 */
export function configureSongActions(effects: SongActionEffects): void {
  unsubscribeSession?.();
  session = createSwapSession(effects);
  unsubscribeSession = session.subscribe(() => {
    useSongActionsStore.setState({ swap: session!.getSnapshot() });
  });
  useSongActionsStore.setState({
    actionSheet: null,
    playlist: null,
    swap: session.getSnapshot(),
  });
}

function requireSession(): SongSwapSession {
  if (!session) throw new Error('song actions 未绑定平台效果：请先 configureSongActions()');
  return session;
}

export const useSongActionsStore = create<SongActionsState>((set) => ({
  actionSheet: null,
  playlist: null,
  swap: IDLE_SWAP_SNAPSHOT,

  openActions: (song, handlers = {}) => set((s) => ({
    actionSheet: { song, handlers, visible: true },
    playlist: s.playlist ? { ...s.playlist, visible: false } : null,
  })),
  closeActions: () => set((s) => (
    s.actionSheet ? { actionSheet: { ...s.actionSheet, visible: false } } : {}
  )),

  openAddToPlaylist: (song) => set((s) => ({
    actionSheet: s.actionSheet ? { ...s.actionSheet, visible: false } : null,
    playlist: { song, visible: true },
  })),
  closeAddToPlaylist: () => set((s) => (
    s.playlist ? { playlist: { ...s.playlist, visible: false } } : {}
  )),

  openSwap: (song, handlers) => {
    set((s) => ({
      actionSheet: s.actionSheet ? { ...s.actionSheet, visible: false } : null,
      playlist: s.playlist ? { ...s.playlist, visible: false } : null,
    }));
    requireSession().open(song, { onSwapped: handlers?.onSwap });
  },
  closeSwap: () => { requireSession().close(); },
  selectSwapSource: (source) => requireSession().selectSource(source),
  selectSwapCandidate: (candidate) => { requireSession().selectCandidate(candidate); },
  swapBack: () => { requireSession().back(); },
}));
