import NetInfo from '@react-native-community/netinfo';

/**
 * 离线判定（#385）：core `skipGuard` 零 I/O，离线态由宿主注入 predicate。
 *
 * 移动端用 NetInfo（spec #385 定案，MusicFree 已验证 v11.4.1）：只有**明确否定态**
 * 才判离线——`isConnected === false`（无网络连接）或 `isInternetReachable === false`
 * （连着但不可达，如强制门户）。未知态（null）不判离线，避免把「探测中」误报成断网。
 *
 * 独立成一个模块而非内联在 audioPlayer 里：原生模块在单测环境不可用，
 * 失败路径测试 mock 掉本模块即可（`vi.mock('../services/networkState')`）。
 * 判定抛错（原生模块缺失等）按在线处理——护栏宁可多试一轮，也不误报离线。
 */
export async function isOffline(): Promise<boolean> {
  try {
    const state = await NetInfo.fetch();
    return state.isConnected === false || state.isInternetReachable === false;
  } catch {
    return false;
  }
}
