export {
  musicApi,
  getApiClient,
  setApiBaseUrl,
  getApiBaseUrl,
  setProxyUrl,
  getProxyUrl,
  setApiTimingLog,
  setThrottleObserver,
  warmUpArtistPicCache,
  injectProxyAgents,
  invalidateCoverUrl,
  setSourceModes,
  loadSourceModes,
  setSourceModePersister,
  getAllSourceModes,
  hasDirectClient,
  registerDirectClient,
  setTlsDegradeProvider,
  getTlsFingerprintEnabled,
  setTlsFingerprintEnabled,
  loadTlsFingerprint,
  setTlsFingerprintPersister,
  setTlsFingerprintAgentProvider,
  TLS_FINGERPRINT_SETTING_KEY,
  setTier3Enabled,
  getTier3Enabled,
  setTier3Subscriptions,
  getTier3Subscriptions,
  getTier3State,
  loadTier3State,
  setTier3Persister,
  addTier3SubscriptionFromUrl,
  addTier3SubscriptionFromText,
  removeTier3Subscription,
  refreshTier3Subscription,
  setTier3Deps,
  getTier3Stats,
  setTransportProxyAgents,
} from '@mplayer/core';
export type { ProxyAgents, TransportProxyAgents } from '@mplayer/core';

import { setThrottleObserver as registerThrottleObserver, registerDirectClient as coreRegisterDirectClient, neteaseDirectClient, qianqianDirectClient, miguDirectClient, qqDirectClient, kuwoDirectClient, sodaDirectClient, kugouDirectClient } from '@mplayer/core';

// ── 直连客户端注册（T02 网易 / T03 汽水 / T04 千千 / T05 咪咕 / T06 QQ / T07 酷狗 / T08 酷我） ──
// 在模块加载时注册直连客户端；注册后 sourceRouter.hasDirectClient(source)
// 生效 → 设置页「直连可用」状态自动变亮，且 auto 模式搜索/播放优先走直连源站，
// 直连失败自动回退自建 API。
// （移动端在 app/_layout.tsx 各自注册；本壳是桌面主进程的注册点。）
coreRegisterDirectClient(neteaseDirectClient);
coreRegisterDirectClient(sodaDirectClient);
coreRegisterDirectClient(qianqianDirectClient);
coreRegisterDirectClient(miguDirectClient);
coreRegisterDirectClient(qqDirectClient);
coreRegisterDirectClient(kugouDirectClient);
coreRegisterDirectClient(kuwoDirectClient);

// ── 上游限流自适应退避 ──────────────────────────────────────────
// core 观察器上报搜索/播放直链请求的成败：超时（上游挂起）→ 指数退避；
// 退避期内仍有请求成功也不降级（避免混合成功/超时导致永远停在 15s）。
let consecutiveThrottles = 0;
let throttleUntil = 0;
const THROTTLE_BASE_MS = 15 * 1000;
const THROTTLE_MAX_MS = 5 * 60 * 1000;

registerThrottleObserver((event) => {
  if (event === 'throttle') {
    consecutiveThrottles++;
    const backoff = Math.min(THROTTLE_BASE_MS * 2 ** (consecutiveThrottles - 1), THROTTLE_MAX_MS);
    // full jitter：sleep(random(0, backoff))。无 jitter 的指数退避会让
    // 多端/多窗口在同一时刻同步重试（惊群），AWS 标准实践是在退避上
    // 加全抖动（aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/）
    const jittered = Math.floor(Math.random() * backoff);
    throttleUntil = Date.now() + jittered;
    console.warn(`[apiThrottle] 上游限流，退避 ${Math.ceil(jittered / 1000)}s（连续 ${consecutiveThrottles} 次）`);
  } else if (Date.now() >= throttleUntil) {
    consecutiveThrottles = 0;
  }
});

/** 渲染层刷新流程按批查询：距离恢复还有多少 ms（0 = 无需等待） */
export function getThrottleWaitMs(): number {
  return Math.max(0, throttleUntil - Date.now());
}
