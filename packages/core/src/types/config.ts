/**
 * Music Service Configuration Interface
 *
 * Core package requires platforms to implement this interface.
 * Each field has a sensible default — platforms only override what they need.
 */
export interface MusicServiceConfig {
  // === API ===
  /** Music API server base URL. Empty = use default proxy service */
  apiBaseUrl: string;
  /** Timeout for API requests (ms) */
  apiTimeout: number;

  // === Proxy ===
  /**
   * Proxy URL for requests. Empty string = direct connection (no proxy).
   * Format: "http://user:pass@host:port" or "socks5://host:port"
   *
   * Default: '' (direct). Users must explicitly configure if needed.
   * When set, applies to ALL requests (API + audio CDN).
   */
  proxyUrl: string;

  // === Search ===
  /** Max concurrent requests when searching multiple sources */
  searchConcurrency: number;
  /** Enabled search sources. Empty = all sources */
  searchSources: string[];

  // === Audio ===
  /** Preferred audio quality */
  audioQuality: 'standard' | 'high' | 'lossless';
  /** Timeout for audio-related requests (URL resolution, probe) (ms) */
  audioTimeout: number;

  // === Cache ===
  /** Max cache size in MB */
  cacheMaxSizeMB: number;
}

export const DEFAULT_CONFIG: MusicServiceConfig = {
  apiBaseUrl: '',
  apiTimeout: 30000,
  proxyUrl: '',
  searchConcurrency: 6,
  searchSources: [],
  audioQuality: 'standard',
  audioTimeout: 15000,
  cacheMaxSizeMB: 500,
};
