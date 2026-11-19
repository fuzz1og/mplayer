import { create } from 'zustand';

/** 原生 `lyricOverlayState` 事件与 `getLyricOverlayState()` 的运行时态（不持久化）。 */
export interface LyricOverlayRuntimeState {
  permission: boolean;
  attached: boolean;
  touchable: boolean;
}

interface LyricOverlayUiState extends LyricOverlayRuntimeState {
  /** API 26+ 且非 low-RAM；入口整行隐藏依据（#768 / 规格 §3.2）。 */
  supported: boolean;
  setSupported: (supported: boolean) => void;
  apply: (state: LyricOverlayRuntimeState) => void;
}

export const useLyricOverlayStore = create<LyricOverlayUiState>()((set) => ({
  supported: false,
  permission: false,
  attached: false,
  touchable: false,
  setSupported: (supported) => set({ supported }),
  apply: ({ permission, attached, touchable }) => set({ permission, attached, touchable }),
}));
