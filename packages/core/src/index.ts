export * from './types/index.js';
export { MULTI_SOURCE_LIST } from './constants.js';
export { cacheManager } from './api/memoryCacheManager.js';
export { RateLimiter, beforeRequest, getAntiScrapeHeaders, getApiRequestHeaders, getUserAgent, resetUaContinuity, UA_POOL_SIZE, safeParseJSON } from './api/antiScrape.js';
export type { AntiScrapeHeaders } from './api/antiScrape.js';
export { musicApi, setApiBaseUrl, getApiBaseUrl, getApiClient, resolveCoverUrl, invalidateCoverUrl, isSessionProtectedEndpoint, setProxyUrl, getProxyUrl, warmUpArtistPicCache, injectProxyAgents, setApiTimingLog, setApiRequestHandler, setThrottleObserver, markApiSessionBootstrapped, setApiSessionCookieValue, getApiSessionCookie, isApiOriginUrl } from './api/musicApi.js';
export type { ProxyAgents } from './api/musicApi.js';
export { probeAudio, probeAudioUrl, normalizeProbeUrl } from './api/audioProbe.js';
export { probeSongs } from './api/probeSongs.js';
export type { ProbeOptions } from './api/probeSongs.js';
export { dedupeSongs, checkDuplicate, filterDuplicates } from './utils/songDedupe.js';
export type { DupStatus, DupResult, FilterResult } from './utils/songDedupe.js';
export { groupIntoSongGroups } from './utils/groupIntoSongGroups.js';
export { calculateSimilarity, findBestMatch, isExactMatch, findExactMatch } from './utils/songMatcher.js';
export { getNextSongIndex, getPrevSongIndex } from './utils/queue.js';
export { pickRandomBatch } from './utils/recommendBatch.js';
export type { RandomBatchResult } from './utils/recommendBatch.js';
export { parseLRC, findCurrentLyricIndex, formatLyricsTime, generateLRC } from './utils/lyricsParser.js';
export type { LyricLine, ParsedLyrics } from './utils/lyricsParser.js';
export { formatPlayCount } from './utils/format.js';
export { BROWSER_UA, refererForApiType, refererForUrl, refererForSourceKey } from './utils/sourceReferer.js';
export { resourceUrlKey } from './utils/resourceKey.js';
export {
  MANAGE_COOKIE_TTL_MS,
  KUGOU_COOKIE_TTL_MS,
  createNeteaseAnonymousCookie,
  createNeteaseBorrowMusicUCookie,
  createKugouDeviceCookie,
  shouldRotateCookie,
  getBorrowMusicUEnabled,
  setBorrowMusicUEnabled,
  getCookie,
  setCookie,
  clearCookie,
  loadCookies,
  generateCookie,
  refreshCookie,
  ensureFreshCookie,
  setCookiePersister,
} from './cookies/cookieManager.js';
export type { SourceCookie, KugouDeviceReg, CookieClock, CookieSource, GenerateCookieOptions } from './cookies/cookieManager.js';
export { isImageBytes, isAudioBytes } from './utils/sniffers.js';
export { md5 } from './utils/hash.js';
export { createSearchOrchestrator } from './shared/searchOrchestrator.js';
export type { SearchOrchestrator, SearchOrchestratorState, SearchOrchestratorConfig, SearchRoute } from './shared/searchOrchestrator.js';
export { searchSwapCandidates, probeSwapCandidates, applySwap } from './shared/sourceSwap.js';
export type { SwapCandidate, SourceSwapDeps } from './shared/sourceSwap.js';
export { resolvePlayableUrl, resolvePlayableSong, stripSourceIdPrefix } from './shared/resolvePlayableUrl.js';
export type { UrlResolver, PlayableSong } from './shared/resolvePlayableUrl.js';
export { resolveFreshUrl } from './shared/resolveFreshUrl.js';
export type { FreshUrlResolver } from './shared/resolveFreshUrl.js';
export { parsePlaylistUrl, parseSongList, importSongs, importFromLink } from './api/playlistImport.js';
export type { PlaylistUrlInfo, ParsedLine, ProgressState, ImportResult, PlaylistImportDeps, ImportSource } from './api/playlistImport.js';
export { CacheKernel } from './cache/cacheKernel.js';
export { createMemoryBackend } from './cache/backends/memoryBackend.js';
export { DEFAULT_TTL } from './cache/ttl.js';
export { SongResourcesCache, SONGS_TTL_MS, COVERS_TTL_MS } from './cache/songResourcesCache.js';
export type { SongResources, SongResourcesCacheOptions } from './cache/songResourcesCache.js';
export type { CachePort, CacheBackend, CacheStats } from './cache/types.js';
export {
  setTransport,
  getTransport,
  request,
  setTransportRetryOptions,
  getTransportRetryOptions,
  setTlsDegradeProvider,
  getTlsDegradeProvider,
  isTlsHandshakeError,
} from './api/transport.js';
export type { Transport, TransportRequest, TransportResponse, TransportRetryOptions, TlsDegradeAgents } from './api/transport.js';
export {
  TLS_FINGERPRINT_SETTING_KEY,
  getTlsFingerprintEnabled,
  setTlsFingerprintEnabled,
  loadTlsFingerprint,
  setTlsFingerprintPersister,
  setTlsFingerprintAgentProvider,
  getTlsFingerprintAgent,
  getTlsFingerprintHeaders,
  getTlsFingerprintConfig,
} from './api/tlsFingerprint.js';
export {
  registerDirectClient,
  getDirectClient,
  hasDirectClient,
  clearDirectClients,
  getSourceMode,
  setSourceMode,
  setSourceModes,
  loadSourceModes,
  getAllSourceModes,
  setSourceModePersister,
  configureSourceRouter,
  searchSongsRouted,
  resolvePlayableUrlRouted,
} from './shared/sourceRouter.js';
export type { SourceMode, DirectSourceClient, SourceRouterLegs } from './shared/sourceRouter.js';
export { SOURCE_DISPLAY_NAMES, SOURCE_MODE_OPTIONS } from './shared/sourceRouter.js';
