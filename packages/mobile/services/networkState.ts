import NetInfo from '@react-native-community/netinfo';

/**
 * 离线判定（#385）：core `skipGuard` 零 I/O，离线态由宿主注入 predicate。
 * 独立成模块而非内联在 audioPlayer：原生模块在单测环境不可用，失败路径测试 mock 掉本模块即可（`vi.mock('../services/networkState')`）。
 * 只有明确 `isInternetReachable === false` 才判离线；未知态（`null`）不判离线，避免把「探测中」误报成断网。
 */
export async function isOffline(): Promise<boolean> {
  try {
    const state = await NetInfo.fetch();
    return state.isConnected === false || state.isInternetReachable === false;
  } catch {
    return false;
  }
}
