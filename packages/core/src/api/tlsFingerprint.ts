/**
 * TLS 指纹伪装险情开关（T10 spec #156）—— 仅桌面，weapi 先行试点。
 * 背景：上游对自动化请求做 JA3/JA4 级 TLS 握手指纹风控。
 * 默认关 → 空配置，行为与现状一致。
 */

/** 桌面 db 中该开关的存储键。 */
export const TLS_FINGERPRINT_SETTING_KEY = 'tlsFingerprintEnabled';

let enabled = false;
let persister: ((v: boolean) => void) | null = null;
let agentProvider: (() => unknown) | null = null;

/** 当前是否开启（默认关）。 */
export function getTlsFingerprintEnabled(): boolean {
  return enabled;
}

/** 设置开关（触发持久化一次；无变化不重复触发）。 */
export function setTlsFingerprintEnabled(next: boolean): void {
  const value = !!next;
  if (value === enabled) return;
  enabled = value;
  persister?.(enabled);
}

/** 初始加载/重水合（不触发持久化）。 */
export function loadTlsFingerprint(value: boolean): void {
  enabled = !!value;
}

/** 宿主注册持久化回调（桌面 db / 移动端禁用手动开启，一般桌面主进程注入）。 */
export function setTlsFingerprintPersister(persist: ((v: boolean) => void) | null): void {
  persister = persist;
}

/** 桌面主进程注入指纹 https agent 提供者；传 null 清空。 */
export function setTlsFingerprintAgentProvider(provider: (() => unknown) | null): void {
  agentProvider = provider;
}

/** 当前指纹 agent（未注册返回 null）。 */
export function getTlsFingerprintAgent(): unknown {
  return agentProvider ? agentProvider() : null;
}

/**
 * weapi 附加请求头（best-effort 特征偏置）。关闭时返回空对象 → 默认行为不变。
 * 仅当用户显式开启时启用，避免影响 RN/未开启的默认请求。
 */
export function getTlsFingerprintHeaders(): Record<string, string> {
  if (!enabled) return {};
  return {
    'X-Requested-With': 'com.netease.cloudmusic',
    'Accept-Encoding': 'gzip, deflate, br',
  };
}

/**
 * weapi 请求装配配置（配置函数）：返回当前开关下应附加到 weapi 请求的
 * headers + httpsAgent。未开启 → `{ headers: {}, httpsAgent: null }`。
 */
export function getTlsFingerprintConfig(): { headers: Record<string, string>; httpsAgent: unknown | null } {
  if (!enabled) return { headers: {}, httpsAgent: null };
  return { headers: getTlsFingerprintHeaders(), httpsAgent: getTlsFingerprintAgent() };
}
