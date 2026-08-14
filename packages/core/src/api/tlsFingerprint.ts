/**
 * TLS 指纹伪装险情开关（T10 spec #156）—— 仅桌面，weapi 先行试点。
 *
 * 背景：上游对自动化请求做 JA3/JA4 级 TLS 握手指纹风控。Node/Electron 主进程
 * 无法伪造完整 JA3/JA4（需要原生 TLS 基底接管 ClientHello），因此本模块交付
 * 有界的 best-effort 特征调整，落实「开关 + 桌面侧接线 + 能力边界文档化」：
 *
 * - 开关：`setTlsFingerprintEnabled`（触发 persister）/ `loadTlsFingerprint`（重水合不触发），
 *   持久化钩子仿 T01 `sourceRouter` 模式（core 零 I/O，宿主注册回调落盘）。
 * - 仅桌面：指纹 https agent 提供者（`setTlsFingerprintAgentProvider`）只由桌面
 *   主进程注入；移动端不注册（TLS 基底非 BoringSSL，伪造无收益），开关保持默认关。
 * - weapi 试点：`getTlsFingerprintConfig()` 在开启时返回附加请求头 + 指纹 agent，
 *   `neteaseWeapi.weapiRequest` 请求时装配。默认关 → 空配置，行为与现状一致。
 *
 * 能力边界（明确文档化）：
 * - Node https.Agent 仅能调整 minVersion/ciphers/keepAlive 等握手参数，无法逐
 *   字节伪造 ClientHello 顺序（JA3）或 QUIC/TLS-1.3 扩展集（JA4）。
 * - 因此开启后是一种「特征偏置」而非完整伪装；若上游仍以 JA3/ClientHello 精确
 *   比对，该开关不足以绕过。桌面侧 wiring 通过主进程 https agent 注入，且仅在
 *   用户显式开启时启用，默认行为不受影响。
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
