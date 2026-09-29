/**
 * 封面加载失败的埋点接缝。
 *
 * 为什么需要它：全仓 10 处 `<Image source={{ uri: cover }}>` 里只有 3 处挂了 `onError`，
 * 而且那 3 处也只做 UI 回落、**不打任何日志**——所以「封面没出来」这件事在系统里是
 * **不可观测的**：失败就是一块灰，logcat 里连一行都没有（#465 真机验收时实测：
 * 只能靠设备侧 curl 对拍才定性得了，日志完全帮不上忙）。
 *
 * 策略（与 perfMonitor / dragJankProbe 同一哲学——常态不刷屏）：
 *   - 同一 (scope,url) 只报一次；
 *   - 每个 scope 最多落 10 条，超量只补一行「已达上限」摘要；
 *   - 走 logsStore：既进应用内环形缓冲（将来开发者面板要读的那份），也镜像到 console。
 */
import { useLogsStore } from '../stores/logsStore';

/** 每个 scope 最多落多少条明细（长列表整屏失败时防刷屏） */
export const COVER_ERROR_MAX_PER_SCOPE = 10;

const reported = new Set<string>();
const scopeCount = new Map<string, number>();

/** 测试用：清空去重状态 */
export function resetCoverDiagnostics(): void {
  reported.clear();
  scopeCount.clear();
}

/**
 * 记一次封面加载失败。`scope` 用来区分是哪张列表/哪个组件（如 `album-grid` / `song-row`）。
 * `url` 允许为空——空 url 本身就是一种失败（数据缺失），日志里要能区分开。
 */
export function logCoverError(scope: string, url?: string): void {
  const key = `${scope}|${url ?? ''}`;
  if (reported.has(key)) return;
  reported.add(key);

  const seen = (scopeCount.get(scope) ?? 0) + 1;
  scopeCount.set(scope, seen);
  const addLog = useLogsStore.getState().addLog;
  if (seen > COVER_ERROR_MAX_PER_SCOPE) {
    if (seen === COVER_ERROR_MAX_PER_SCOPE + 1) {
      addLog('warn', `[cover] ${scope} 失败已达 ${COVER_ERROR_MAX_PER_SCOPE} 条上限，后续同类不再逐条记录`);
    }
    return;
  }
  addLog('warn', `[cover] ${scope} 加载失败: ${url || '(空 url)'}`);
}
