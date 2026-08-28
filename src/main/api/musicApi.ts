export {
  musicApi,
  setSourceModes,
  loadSourceModes,
  sanitizeSourceModes,
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
export type { TransportProxyAgents } from '@mplayer/core';

import { registerDirectClient as coreRegisterDirectClient, neteaseDirectClient, qianqianDirectClient, miguDirectClient, qqDirectClient, kuwoDirectClient, sodaDirectClient, kugouDirectClient } from '@mplayer/core';

// ── 直连客户端注册（T02 网易 / T03 汽水 / T04 千千 / T05 咪咕 / T06 QQ / T07 酷狗 / T08 酷我） ──
// 在模块加载时注册直连客户端；注册后 sourceRouter.hasDirectClient(source)
// 生效 → 设置页「直连可用」状态自动变亮，且 auto 模式搜索/播放优先走直连源站。
// （移动端在 app/_layout.tsx 各自注册；本壳是桌面主进程的注册点。）
coreRegisterDirectClient(neteaseDirectClient);
coreRegisterDirectClient(sodaDirectClient);
coreRegisterDirectClient(qianqianDirectClient);
coreRegisterDirectClient(miguDirectClient);
coreRegisterDirectClient(qqDirectClient);
coreRegisterDirectClient(kugouDirectClient);
coreRegisterDirectClient(kuwoDirectClient);
