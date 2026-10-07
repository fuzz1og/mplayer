export * from './types/index.js';
export { MULTI_SOURCE_LIST } from './constants.js';
export { cacheManager, CacheManager as MemoryCacheManager, MEMORY_CACHE_MAX_ENTRIES } from './api/memoryCacheManager.js';
export { RateLimiter, beforeRequest, getAntiScrapeHeaders, getApiRequestHeaders, getUserAgent, resetUaContinuity, UA_POOL_SIZE, safeParseJSON } from './api/antiScrape.js';
export type { AntiScrapeHeaders } from './api/antiScrape.js';
// #276 自建 API 机件归零：api 客户端/会话/拦截器/闸门/计时设施出口已删。
// setProxyUrl/getProxyUrl 保留（代理注入替代确认悬而未决，mobile 设置页仍注入）。
export { musicApi, setProxyUrl, getProxyUrl, decodeLyricBody } from './api/musicApi.js';
export { normalizeProbeUrl, isUrlAlive } from './api/audioProbe.js';
export { forgetPrefetchedUrl, getPrefetchedUrl, setPrefetchedUrl, clearPrefetchCache } from './api/prefetchCache.js';
export { dedupeSongs, filterDuplicates, classifySong, createPlaylistSnapshot, DEFAULT_PLAYLIST_CAPACITY } from './utils/songDedupe.js';
export type { DupStatus, DupResult, FilterResult, PlaylistSnapshot } from './utils/songDedupe.js';
export { groupIntoSongGroups } from './utils/groupIntoSongGroups.js';
export { calculateSimilarity, findBestMatch, isExactMatch, findExactMatch } from './utils/songMatcher.js';
export { getNextSongIndex, getPrevSongIndex, planAdvance } from './utils/queue.js';
export type { AdvancePlan, AdvanceInput, AdvanceEffect } from './utils/queue.js';
// 稳定随机序列（#511 方案 A）：随机播放的「洗牌序 + 游标」是跨端契约，
// 双端 playerStore 各持一份、core 只出纯函数；语义见 ADR 2026-09-30-stable-shuffle-order。
export {
  createShuffleState,
  normalizeShuffleOrder,
  syncShuffleCursor,
  stepShuffle,
  insertNextInShuffle,
  replaceShuffleSongId,
  applyShuffleOrder,
  alignShuffleOrder,
} from './utils/shuffleOrder.js';
export type { ShuffleScope } from './utils/shuffleOrder.js';
export type {
  ShuffleState,
  ShuffleStep,
  ShuffleRng,
  CreateShuffleOptions,
} from './utils/shuffleOrder.js';
export { isLegacyDeadUrl, clearLegacyDeadResources } from './utils/legacyUrl.js';
export { normalizePublishTime } from './utils/publishTime.js';
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
  randomKugouReg,
} from './cookies/cookieManager.js';
export type { SourceCookie, KugouDeviceReg, CookieClock, CookieSource, GenerateCookieOptions } from './cookies/cookieManager.js';
export { isImageBytes, isAudioBytes } from './utils/sniffers.js';
export { md5 } from './utils/hash.js';
export { sanitizeFileNameFragment, makeSongFileName } from './utils/downloadFileName.js';
export type { SongFileNameParts, SongFileNameDeps } from './utils/downloadFileName.js';
export { createSearchOrchestrator } from './shared/searchOrchestrator.js';
export type { SearchOrchestrator, SearchOrchestratorState, SearchOrchestratorConfig, SearchRoute } from './shared/searchOrchestrator.js';
export { searchSwapCandidates, applySwap } from './shared/sourceSwap.js';
export { songUsesSongidLyrics, isSodaSource, isInlineLyrics, planLyricsFetch } from './shared/songLyrics.js';
export type { LyricsFetchPlan } from './shared/songLyrics.js';
// 封面按源机制要缩略图（#496）：网易 ?param=WxH / QQ 路径模板 R{size}x{size} / 其余源原样。
export { COVER_SIZE, coverThumbUrl } from './shared/coverUrl.js';
// 歌词入队取词（#429）：可见期预取的入队 / single-flight / 取消 / 单次接纳上限单点。
// 并发与限速不在本模块——那是 transport 双层闸门（#408）的职责。
export {
  LYRICS_HYDRATION_BURST_CAP,
  LYRICS_HYDRATION_SETTLED_LIMIT,
  enqueueLyricsHydration,
  cancelLyricsHydration,
  cancelAllLyricsHydration,
  // 宿主接缝：桌面渲染层经 IPC 注入主进程取词器（它的歌词缓存在主进程，见 #441）。
  setLyricsHydratorDeps,
} from './shared/lyricsHydrator.js';
// 以下是**测试/诊断接缝**（与 `setTier3Deps` 同性质，**不是对外契约**）：前两个给
// 单测与真机诊断读「在飞 / 已结算」的即时状态，最后一个给会话切换与单测重置。
// 宿主不要拿它们驱动业务逻辑。
export {
  awaitLyricsHydrationIdle,
  getLyricsHydrationStats,
  resetLyricsHydrator,
} from './shared/lyricsHydrator.js';
export type {
  LyricsHydrationCandidate,
  LyricsHydrationStats,
  LyricsHydratorDeps,
  LyricsFetcher,
} from './shared/lyricsHydrator.js';
// 榜单聚合内核已下线（#332 裁决：回归单元榜 + 源切换）。聚合只在「存在跨源可比原生量」
// 的产品里有意义；本项目只有名次、没有绝对量，Σ1/rank 在业界找不到对应物。
export {
  UPDATE_SOURCE_DEFS,
  GITHUB_LATEST_BASE,
  toGenericFeedUrl,
  buildAssetUrl,
  rankSourcesByLatency,
  probeUpdateSources,
} from './shared/updateChannels.js';
export type { UpdateSourceDef, UpdateLatencyMap, FetchLike } from './shared/updateChannels.js';
export type { SwapCandidate, SourceSwapDeps } from './shared/sourceSwap.js';
export { stripSourceIdPrefix } from './utils/sourceIdPrefix.js';
export { rawSongId, identityKey, identityKeyFrom } from './utils/songIdentity.js';
export { refreshSongResource } from './shared/songResourceRefresh.js';
export type { SongResourceRefreshDeps, LegOptions } from './shared/songResourceRefresh.js';
export { parsePlaylistUrl, importFromLink, importDepsFor } from './api/playlistImport.js';
export { writeSongsToPlaylist, songWriteRejection, NAME_CONFLICT_COPY } from './shared/playlistWrite.js';
export type {
  PlaylistWriteDeps,
  PlaylistWriteResult,
  PlaylistDuplicate,
  PlaylistNameConflict,
  NameConflictResolution,
  NameConflictDecisions,
  SongWriteRejection,
} from './shared/playlistWrite.js';
export type { PlaylistUrlInfo, ProgressState, ImportResult, PlaylistImportDeps, PlaylistImportWriterPort, ImportSource } from './api/playlistImport.js';
export {
  getQqPlaylistSongs,
  resolveQqPlaylistDisstid,
  extractQqPlaylistIdFromUrl,
  isQqSongLink,
  isQqShortLink,
  QQ_PLAYLIST_MAX_SONGS,
} from './api/qqPlaylist.js';
export { CacheKernel } from './cache/cacheKernel.js';
export { createMemoryBackend } from './cache/backends/memoryBackend.js';
export { cacheKeyType } from './cache/cacheKey.js';
export { DEFAULT_TTL } from './cache/ttl.js';
export { SongResourcesCache, SONGS_TTL_MS } from './cache/songResourcesCache.js';
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
  setTransportProxyAgents,
  getTransportProxyAgents,
  isTlsHandshakeError,
} from './api/transport.js';
// 取消信号类型（其余 transport 类型在下方既有导出里）
export type { TransportSignal } from './api/transport.js';
// 出网闸门（#408）：宿主只读诊断 + 测试/真机调参接缝（接口本身在 transport 内部）。
export {
  acquireOutboundSlot,
  outboundHostOf,
  getOutboundGateOptions,
  setOutboundGateOptions,
  getOutboundInFlightCount,
  getOutboundQueuedCount,
  getOutboundGateStats,
  resetOutboundGate,
  isTransportAbortError,
  TransportAbortError,
  DEFAULT_OUTBOUND_GATE,
} from './api/outboundGate.js';
export type { OutboundGateOptions, OutboundGateStats, ReleaseOutboundSlot } from './api/outboundGate.js';
export type { Transport, TransportRequest, TransportResponse, TransportRetryOptions, TlsDegradeAgents, TransportProxyAgents } from './api/transport.js';
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
export { neteaseDirectClient, createNeteaseDirectClient, defaultContentCache } from './api/neteaseDirect.js';
export { qianqianDirectClient } from './api/qianqianDirect.js';
export { miguDirectClient, decryptXorStream, XOR_KEY } from './api/miguDirect.js';
export { qqDirectClient, rsaPkcs1v15Encrypt, aesCbcPkcs7Encrypt, obtainQimei, randomGuid } from './api/qqDirect.js';
export { kuwoDirectClient, encryptQuery, kuwoDesEncrypt, decryptQuery, decodeKuwoLyricBody } from './api/kuwoDirect.js';
export { sodaDirectClient } from './api/sodaDirect.js';
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
  sanitizeSourceModes,
  setSourceModePersister,
  searchSongsRouted,
  resolvePlayableUrlRouted,
  resolvePlayableSongRouted,
  setTier3Resolver,
  pickToplistGroup,
  pickToplistSongs,
  getToplistSongs,
  getAlbumDetailRouted,
  getToplistDetailRouted,
  getArtistInfoRouted,
} from './shared/sourceRouter.js';
// 跳歌护栏（#385）：终局失败后的决策单点 + 会话内连续计数/坏歌记忆。
export {
  SKIP_LIMIT,
  OFFLINE_COPY,
  decideAfterPlaybackFailure,
  registerTerminalFailure,
  resetFailureStreak,
  getFailureStreak,
  isKnownBadSong,
  pickNextSongAfterFailure,
  clearSkipGuard,
} from './shared/skipGuard.js';
export type { SkipGuardAction, SkipGuardInput, SkipGuardDecision } from './shared/skipGuard.js';
export type {
  SourceMode,
  DirectSourceClient,
  ToplistGroup,
  ContentCache,
  ContentMethod,
  AlbumDetailOutcome,
  ToplistDetail,
  ToplistDetailOutcome,
  Tier3Resolver,
  Tier3Resolution,
  ChartKind,
  ToplistSourceKey,
} from './shared/sourceRouter.js';
export { SOURCE_DISPLAY_NAMES, SOURCE_MODE_OPTIONS, CONTENT_METHODS, TOPLIST_SOURCE_IDS } from './shared/sourceRouter.js';
export { detectAudioContainer, containerFromContentType, extensionForContainer, replaceExtension } from './download/container.js';
export type { AudioContainer } from './download/container.js';
export { tagStrategyForContainer, buildID3Frames, ID3_FRAME_TLEN } from './download/tagging.js';
export type { TagStrategy, ID3Frames, BuildID3FramesInput, CoverFrameData } from './download/tagging.js';
export { lrcSidecarName, looksLikeLyrics } from './download/lyrics.js';
export { estimateDownloadProgress } from './download/progress.js';
export type { ProgressInput } from './download/progress.js';
export { takeNextQueued, retryBackoffMs, DEFAULT_MAX_CONCURRENT, DEFAULT_MAX_RETRIES } from './download/queue.js';
export { kugouDirectClient, ensureKugouCookie, resolveKugouLyricUrl } from './api/kugouDirect.js';
export { classifyLength, isTrialUrlInfo } from './api/audioProbe.js';
export type { LengthClass, UrlInfo } from './api/audioProbe.js';
export type { RoutedPlayable } from './shared/sourceRouter.js';
// 播放护栏（#361）：决策纯函数 + 音频时长取证（L2）。
export { evaluatePlaybackGuard, GUARD_TOLERANCE_SEC } from './shared/playbackGuard.js';
export type { PlaybackGuard, PlaybackVia, PlaybackEvidence, GuardDecision } from './shared/playbackGuard.js';
export { extractAudioDuration, hasMpegXingHeader, isTrustedHeaderDuration } from './shared/audioDuration.js';
export type { AudioDurationEvidence } from './shared/audioDuration.js';
// 播放解析链结构化 trace（#363）：core 出 trace，宿主落 sink。
export {
  setPlaybackTraceSink,
  getPlaybackTraceSink,
  isPlaybackTraceEnabled,
  emitPlaybackTrace,
  createPlaybackTraceRing,
  traceNow,
  classifyTraceError,
} from './shared/playbackTrace.js';
export type {
  PlaybackTrace,
  PlaybackTraceSink,
  PlaybackTraceRing,
  PlaybackTraceSourceLeg,
  PlaybackLayer,
  PlaybackTraceOutcome,
  PlaybackTraceErrorClass,
} from './shared/playbackTrace.js';
// 会话内源调度（#398）：健康度定序 + 单飞初始化窗口（纯函数，模块级会话内状态、零 I/O）。
export {
  noteSample,
  scoreOf,
  orderSources,
  beginInit,
  isInitialized,
  clearSourceSchedule,
  getSourceScheduleSnapshot,
  reward,
  SCHEDULE_SCORE_MS_CAP,
  SCHEDULE_EWMA_ALPHA,
  SCHEDULE_CENSORED_WEIGHT,
  SCHEDULE_DEMOTE_AFTER,
  SCHEDULE_NEUTRAL_SCORE,
  SCHEDULE_HEDGE_MS,
  SCHEDULE_INIT_INFLIGHT,
} from './shared/sourceSchedule.js';
export type {
  SourceSampleKind,
  SourceSample,
  SourceHealth,
  SourceHealthSnapshot,
} from './shared/sourceSchedule.js';
export type { Tier3RunControl, Tier3ScheduleReport } from './shared/sourceRouter.js';
export {
  parseTier3Manifest,
  fetchTier3ManifestFromUrl,
  addTier3SubscriptionFromUrl,
  addTier3SubscriptionFromText,
  removeTier3Subscription,
  refreshTier3Subscription,
  setTier3Enabled,
  getTier3Enabled,
  setTier3Subscriptions,
  getTier3Subscriptions,
  getTier3State,
  loadTier3State,
  setTier3Persister,
  setTier3Deps,
  createTier3Resolver,
  searchTier3Songs,
  getTier3Stats,
  clearTier3Stats,
  clearTier3ProbeCache,
  normalizeTier3Source,
  explainPlaybackFailure,
} from './tier3/tier3Api.js';
export type {
  Tier3Manifest,
  Tier3Source,
  Tier3SourceKind,
  Tier3RequestSpec,
  Tier3SearchSpec,
  Tier3Subscription,
  Tier3SubscriptionKind,
  Tier3State,
  Tier3Deps,
  Tier3SourceStats,
  PlaybackFailureKind,
  PlaybackFailureAdvice,
} from './tier3/tier3Api.js';
