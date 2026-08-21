import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import type { AudioStatus } from 'expo-audio';
import type { EventSubscription } from 'expo-modules-core';
import Constants, { AppOwnership } from 'expo-constants';
import { cacheManager, getNextSongIndex, getApiSessionCookie, isApiOriginUrl, isLegacyDeadUrl, musicApi, resolvePlayableSong, resolveFreshUrl, resourceUrlKey, BROWSER_UA, refererForSourceKey, isUrlAlive } from '@mplayer/core';
import type { Song } from '@mplayer/core';
import { usePlayerStore } from '../stores/playerStore';
import { useHistoryStore } from '../stores/historyStore';
import { useLogsStore } from '../stores/logsStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useAudioTagStore } from '../stores/audioTagStore';
import { updateNotification, clearNotification } from './notificationService';
import { getCachedUrl, setCachedUrl, deleteCachedUrl, urlAgeMs } from './cacheService';
import { searchStrictMatch } from './songResources';

type Player = ReturnType<typeof createAudioPlayer>;

// Expo Go 判定必须用 appOwnership（仅 Expo Go 返回 'expo'）：
// `Constants.expoGoConfig !== null` 在 dev build（expo-dev-client）下也非 null
// （返回整个 embedded manifest），会导致 dev build 误判为 Expo Go 而禁用
// 锁屏控制/后台播放（#93 真机验证发现的 bug）。
const isExpoGo = Constants.appOwnership === AppOwnership.Expo;

// 追踪所有创建过的播放器：expo-audio 的原生释放是异步的，
// remove() 后旧播放器可能仍在出声，切换前必须逐个显式暂停。
const livePlayers = new Set<Player>();
let player: Player | null = null;
let playerStatusSubscription: EventSubscription | null = null;
let currentPlayId = 0;
// playSong 进行中（解析 URL/创建播放器）：togglePlay 应忽略点击，
// 避免 URL 解析期间反复触发 fresh 重试解析
let preparingPlayback = false;

// 缓存 URL「年轻」窗口（<10min 免探活直接播）：CDN 签名寿命 ~15-30min，
// 窗口取下限避免年轻条目也白付探活延迟（丝滑路径 0 额外开销）。
const URL_PROBE_FREE_MS = 10 * 60 * 1000;
// 后台预取跳过窗口（<5min 已有直链不重解析）：预取的目的是切歌秒开，
// 条目还新鲜时重解析只会重复 tier3 全链请求、与前台播放抢手机带宽。
const PREFETCH_SKIP_FRESH_MS = 5 * 60 * 1000;

// ── 单播放器复用的当前播放上下文 ──────────────────────────────
// listener 只在播放器创建时挂一次（replace 换源复用同一 ExoPlayer），
// 所有「当前歌曲」相关状态从 ctx 读取，不依赖闭包捕获。
// 单例实例 = 切歌不存在「旧播放器停止 vs 新播放器启动」的叠加窗口
// （双播放根治：ExoPlayer 实例永远只有一个）。
interface PlaybackCtx {
  song: Song;
  playId: number;
  t0: number;
  fresh: boolean;
  retryCount: number;
}
let playbackCtx: PlaybackCtx | null = null;
// per-player 去重：didJustFinish / error 只处理一次，防止双触发跳歌
let playbackFinished = false;
let playbackFailed = false;
let playbackReadyLogged = false;

export async function initAudio(): Promise<void> {
  await setAudioModeAsync({
    playsInSilentMode: true,
    shouldPlayInBackground: true,
    interruptionMode: 'doNotMix',
  });
}

/**
 * 暂停并释放所有已创建的播放器。
 * 每个操作独立 try/catch，保证：
 * 1) 切歌时旧音频一定停止（先 pause() 同步停音），不会两首歌同时在播；
 * 2) remove() 在异常状态下抛错也不会中断后续播放、不会留下僵尸引用。
 * pause 必须 await：expo-audio 原生暂停是异步的，不等待就创建新播放器，
 * 旧播放器可能仍在出声（换源/切歌时表现为两首歌同时播放）。
 */
async function stopAllPlayers(): Promise<void> {
  for (const p of livePlayers) {
    try { await p.pause(); } catch {}
    try { p.remove(); } catch {}
  }
  livePlayers.clear();
  player = null;
  playerStatusSubscription?.remove();
  playerStatusSubscription = null;
}

/**
 * 播放状态监听（单例播放器只在创建时挂一次；replace 换源后事件仍来自
 * 同一个实例，当前歌曲状态从 playbackCtx 读取）。
 */
function attachPlaybackListener(p: Player): void {
  playerStatusSubscription = p.addListener('playbackStatusUpdate', (status: AudioStatus) => {
    const ctx = playbackCtx;
    if (!ctx || ctx.playId !== currentPlayId) return;
    const { song, t0, fresh, retryCount } = ctx;
    const log = useLogsStore.getState();

    if (!status.isLoaded) {
      if (status.error && !playbackFailed) {
        playbackFailed = true;
        log.addLog('error', `《${song.name}》加载失败: ${status.error}`);
        if (!fresh && song.sourceType !== 'local') {
          // 同一首歌换全新 URL 重试一次（收藏/历史里的 url 可能已过期）；
          // 本地文件不会过期，失败直接跳下一首。
          // 先清该歌的 URL 缓存：CDN 直链带时效签名，TTL 内签名过期会
          // 反复命中同一条死链（Source error 的典型根因）
          void deleteCachedUrl(song.id);
          log.addLog('warn', `《${song.name}》将使用新 URL 重试`);
          setTimeout(() => { if (ctx.playId === currentPlayId) void playSong(song, retryCount, true); }, 0);
        } else {
          const nextSong = nextSongAfterError(retryCount);
          if (nextSong) {
            log.addLog('warn', `《${song.name}》播放失败，自动跳过`);
            setTimeout(() => { if (ctx.playId === currentPlayId) void playSong(nextSong, retryCount + 1, false); }, 0);
          } else {
            // 队列已耗尽：停止假播放并提示
            void stopAllPlayers();
            usePlayerStore.getState().pause();
            log.reportError(`《${song.name}》播放失败，且队列中没有其他歌曲，可长按歌曲换源`);
          }
        }
      }
      return;
    }

    if (!playbackReadyLogged) {
      playbackReadyLogged = true;
      log.addLog('info', `[耗时] 播放器就绪(出声): 《${song.name}》 总耗时 ${Date.now() - t0}ms`);
    }

    const s = usePlayerStore.getState();
    if (status.playing && !s.isPlaying) {
      s.resume();
    } else if (!status.playing && s.isPlaying && !status.didJustFinish) {
      s.pause();
    }

    s.setCurrentTime(status.currentTime);
    s.setDuration(status.duration || 0);

    if (status.didJustFinish && !playbackFinished) {
      playbackFinished = true;
      const nextSong = s.next();
      if (nextSong) setTimeout(() => {
        if (ctx.playId === currentPlayId) void playSong(nextSong, 0, false);
      }, 0);
      else {
        // 队列播完：同步 store 状态（否则 UI 一直显示"播放中"且 togglePlay 失效）
        void stopAllPlayers();
        usePlayerStore.getState().pause();
      }
    }
  });
}

function nextSongAfterError(retryCount: number): Song | null {
  const s = usePlayerStore.getState();
  if (retryCount + 1 >= s.queue.length) return null;
  return s.next();
}

/**
 * 播放失败后为同一首歌获取全新可播 URL（core 的 fresh 重试语义）。
 * 收藏/历史里的 url 可能已过期（音乐源直链一般数小时失效）。
 */
async function refreshPlayableUrl(song: Song): Promise<string> {
  return resolveFreshUrl(song, {
    ...musicApi,
    clearAudioUrlCache: () => cacheManager.clearByPrefix('audioUrl'),
  });
}

/**
 * 后台补歌词/封面：**懒刷新**——播放时只用歌曲自带资源，不主动搜索；
 * 仅当歌曲 lrc 为空（专辑/歌单歌）或加载失败（force，PlayerOverlay 歌词
 * onError、PlayerBar/PlayerOverlay 封面 onError 触发）才搜索补全。
 * 避免每次播放都搜索导致封面/歌词 URL 伪刷新（迷你播放栏图片反复重载）。
 * @param force 资源失效（onError）时强制搜索补全
 * @param refreshCover 封面**自身**失效（封面 onError）时允许换新签名 URL；
 *   其他失效（歌词失败等）不碰封面——新签名 URL 会让迷你栏/播放器封面
 *   闪一下重载（同一张图），封面只有真失效才值得换。调用方需先调
 *   invalidateCoverUrl 清除解析缓存（否则归一化 key 命中失效直链）。
 */
export async function fetchLrcInBackground(song: Song, force = false, refreshCover = false): Promise<void> {
  const log = useLogsStore.getState();
  if ((!force && song.lrc) || song.sourceType === 'local' || !song.name) return;
  try {
    const fresh = await searchStrictMatch(song);
    if (!fresh) return;
    const cur = usePlayerStore.getState().currentSong;
    if (cur?.id !== song.id) return; // 已切歌，丢弃过期结果
    // 歌词比较：普通懒刷新用归一化 key（t/sign 签名参数每次搜索都不同，
    // 不算资源变化，避免伪刷新）；force（歌词加载失败驱动）时旧 URL 已
    // 证明失效——签名不同（新 sign）就直接换，否则归一化 key 相同会
    // 永远命中失效 URL，歌词再也刷新不出来。
    const lrcChanged = force
      ? !!fresh.lrc && fresh.lrc !== cur.lrc
      : !!fresh.lrc && resourceUrlKey(fresh.lrc) !== resourceUrlKey(cur.lrc);
    // 封面：仅 refreshCover（封面自身失效，缓存已 invalidate）时换新签名；
    // 其余场景只补空封面——已有封面不替换，避免迷你栏/播放器封面闪一下重载
    const coverChanged = refreshCover
      ? !!fresh.cover?.startsWith('http') && fresh.cover !== cur.cover
      : !!fresh.cover?.startsWith('http') && !cur.cover;
    if (!lrcChanged && !coverChanged) return; // 资源仍有效，无需刷新
    // 预取歌词文本（core 歌词缓存预热，全屏播放器打开秒显）
    if (lrcChanged) void musicApi.getLyrics(fresh.lrc).catch(() => {});
    usePlayerStore.setState({
      currentSong: {
        ...cur,
        lrc: lrcChanged ? fresh.lrc : cur.lrc,
        cover: coverChanged ? fresh.cover : cur.cover,
      },
    });
    log.addLog('info', `歌曲资源刷新: 《${song.name}》${coverChanged ? '封面' : ''}${lrcChanged ? '歌词' : ''}`);
  } catch (e: any) {
    log.addLog('warn', `歌曲资源刷新失败: 《${song.name}》${e?.message || e}`);
  }
}

/**
 * 判断是否为摄取端点的 302 跳转地址（api.php?get=url...）。
 * 这类地址播放器请求时要先到摄取端点再 302 到 CDN，两跳慢加载；
 * 提前在 JS 层解析成 CDN 直链（结果进缓存，重复播放秒开）。
 */
function isRedirectEndpoint(url: string): boolean {
  // 旧签名端点（api.php?get=*）已随自建 API 退役：不再当有效 302 端点送
  // getAudioUrl 解析（必败死链），让其落入「无 url」分支走现解析链补全
  if (isLegacyDeadUrl(url)) return false;
  return url.includes('api.php?get=url');
}

/**
 * 移动端可播 URL 解析（直连优先，tier3 兜底）。
 * 走路由链（直连 client → tier3 订阅源兜底），失败才回退旧合并解析。
 * 返回 {url, lrc, nonFull}（nonFull=试听版/片段，驱动「可换源」提示与 preview 徽标）。
 */
async function resolvePlayableUrlMobile(song: Song): Promise<{ url: string; lrc: string; nonFull: boolean }> {
  try {
    const routed = await musicApi.resolvePlayableSongRouted(song);
    if (routed?.url?.startsWith('http')) {
      return { url: routed.url, lrc: song.lrc || '', nonFull: !!routed.nonFull };
    }
  } catch {
    // 路由链未配置/直连+tier3 均失败 → 走旧路径兜底
  }
  const legacy = await resolvePlayableSong(song, musicApi);
  return { url: legacy.url, lrc: legacy.lrc, nonFull: false };
}

/**
 * 解析 302 端点 → CDN 直链（getAudioUrl 带缓存；直链直接返回原值）。
 * 不能设短硬超时：RN 播放器（expo-audio）请求 api.php 不带会话 cookie
 * 必返回「非法请求」（原生层无 cookie jar），只能等 JS 层解析完成拿到
 * CDN 直链再播放；桌面端 302 播放器能跟，多等无副作用。
 * getAudioUrl 内部自带 3 次重试 + 5s 超时兜底。
 */
async function resolveDirectUrl(url: string): Promise<string> {
  try {
    const direct = await musicApi.getAudioUrl(url);
    return direct?.startsWith('http') ? direct : url;
  } catch {
    return url;
  }
}

/**
 * 资源 URL 归一化 key（shared core）：302 端点的 t/sign 等签名参数每次
 * 搜索都不同，但内容相同——比较资源是否变化时忽略它们，避免每次播放
 * 都触发封面/歌词"伪刷新"（迷你播放栏图片反复重载）。
 */

/**
 * 切歌预取：播放成功后，后台并行解析队列下一首的播放 URL（含 302 → 直链），
 * 结果写入 URL 持久化缓存——用户切歌时缓存命中，播放器直连 CDN 秒开。
 */
function prefetchNextSong(): void {
  try {
    const st = usePlayerStore.getState();
    // 队列只有一首时“下一首”就是当前歌，预取没有意义，跳过避免重复解析。
    if (st.queue.length <= 1 || st.currentIndex < 0) return;
    // 与真实切歌同一套索引逻辑（随机模式预取随机位置，避免总预取同一首）
    const playMode = useSettingsStore.getState().playMode;
    const nextIdx = getNextSongIndex(st.queue, st.currentIndex, playMode);
    if (nextIdx < 0) return;
    const next = st.queue[nextIdx];
    if (!next?.name || next.sourceType === 'local') return;
    // 新鲜缓存去重：上次写入还没超过 5min 时直链大概率仍然有效，
    // 跳过重解析（VIP 歌重解析要整条 tier3 链，白烧带宽还拖慢前台）。
    const age = urlAgeMs(next.id);
    if (age != null && age < PREFETCH_SKIP_FRESH_MS) return;
    void (async () => {
      const resolved = await resolvePlayableUrlMobile(next);
      const url = isRedirectEndpoint(resolved.url) ? await resolveDirectUrl(resolved.url) : resolved.url;
      if (url?.startsWith('http') && next.id) void setCachedUrl(next.id, url);
      if (resolved.lrc) void musicApi.getLyrics(resolved.lrc).catch(() => {});
    })().catch(() => {});
  } catch {
    // 预取失败不影响播放
  }
}

/**
 * 播放歌曲。
 * @param retryCount 级联跳歌计数（防止全部失效时无限循环）
 * @param fresh 为 true 时绕过原有 url，重新解析全新可播 URL
 */
export async function playSong(song: Song, retryCount = 0, fresh = false): Promise<void> {
  const playId = ++currentPlayId;
  const log = useLogsStore.getState();
  preparingPlayback = true;
  const t0 = Date.now();
  // 本次播放解析结果是否为试听版（驱动 valid/preview 徽标回写）
  let playbackNonFull = false;
  log.addLog('info', `[耗时] 播放准备开始: 《${song.name}》 url=${song.url ? '有' : '无'} fresh=${fresh}`);
  usePlayerStore.getState().setPreparing(true);

  // 单例播放器：更新当前播放上下文（listener 从 ctx 读取）并复位去重标志
  playbackCtx = { song, playId, t0, fresh, retryCount };
  playbackFinished = false;
  playbackFailed = false;
  playbackReadyLogged = false;

  const startPlayback = async (): Promise<void> => {
    let audioUrl: string;
    let lrcUrl = song.lrc || '';
    if (fresh) {
      // 本地文件不会过期，不参与 fresh 重试（调用方已过滤 local 源）。
      // fresh 语义：core 按 ID 强搜/跟随重定向拿全新 URL；严格匹配搜不到
      // 版本时（如候选全被混音署名拦截）退回完整路由链（直连按 ID → tier3）
      audioUrl = await refreshPlayableUrl(song).catch(() =>
        resolvePlayableUrlMobile(song).then((r) => r.url)
      );
      // fresh 重试拿到的仍是 302 端点（api.php?get=url，服务端搜索返回）：
      // 必须解析成 CDN 直链——播放器（ExoPlayer）请求 api.php 不带会话
      // cookie 必返回「非法请求」→ Source error（酷狗等源解析成功与否的
      // 关键路径，之前缺失导致 fresh 重试永远失败跳下一首）
      audioUrl = isRedirectEndpoint(audioUrl) ? await resolveDirectUrl(audioUrl) : audioUrl;
      // fresh 重试只解析 URL，不返回歌词；歌单/收藏缓存歌 lrc 为空，
      // 后台并行补歌词（否则重试成功播放后歌词永远空白）
      void fetchLrcInBackground(song);
    } else if ((song.url?.startsWith('http') || song.url?.startsWith('file://')) && song.lrc) {
      // 已有完整信息（音频 + 歌词）：零网络直接播放；
      // 302 跳转端点同样先解析成 CDN 直链（两跳慢加载不因有歌词而保留）
      audioUrl = isRedirectEndpoint(song.url) ? await resolveDirectUrl(song.url) : song.url;
    } else if (song.url) {
      // 有 url（http 直链 / file:// / api.php 302 端点）：
      // 302 端点先解析成 CDN 直链（播放器直连 CDN，避免两跳慢加载）；
      // 无歌词时后台并行补充（不阻塞播放）。
      // 注意：302 端点不以 http 开头，但它是有效 url——直接解析即可，
      // 不能走下方「无 url」分支去重复搜索（搜索结果页点击会白等一轮搜索）。
      audioUrl = isRedirectEndpoint(song.url) ? await resolveDirectUrl(song.url) : song.url;
      void fetchLrcInBackground(song);
    } else {
      let cached = await getCachedUrl(song.id);
      // 高龄缓存先探活（≤1.5s）：CDN 签名直链寿命远短于 12h 缓存 TTL，
      // 死链若直接交给播放器要 ~3s 才报 Source error；年轻条目（刚写入/
      // 刚预取）免探活保秒开。探活失败按无缓存走正常解析链。
      const age = urlAgeMs(song.id);
      if (cached && (age == null || age >= URL_PROBE_FREE_MS)) {
        const t1 = Date.now();
        if (!(await isUrlAlive(cached))) {
          log.addLog('info', `[耗时] 缓存直链已失效（探活 ${Date.now() - t1}ms），重新解析: 《${song.name}》`);
          void deleteCachedUrl(song.id);
          cached = null;
        }
      }
      if (cached) {
        // 缓存命中：秒起；歌词缺失时后台并行补
        audioUrl = isRedirectEndpoint(cached) ? await resolveDirectUrl(cached) : cached;
        void fetchLrcInBackground(song);
      } else {
        // 无 url：路由解析（直连 → tier3 兜底），失败回退旧合并解析
        const resolved = await resolvePlayableUrlMobile(song);
        // 搜索兜底拿到的可能是 302 跳转端点 → JS 层解析成 CDN 直链
        audioUrl = isRedirectEndpoint(resolved.url) ? await resolveDirectUrl(resolved.url) : resolved.url;
        lrcUrl = resolved.lrc;
        playbackNonFull = resolved.nonFull;
        // 试听版：立即回写 preview 徽标 + 提示可换源（秒播直连试听，不等 tier3）
        if (resolved.nonFull) {
          useAudioTagStore.getState().setTag(song, 'preview');
          useLogsStore.getState().setNotice('info', '当前为试听版，可换源获取完整版');
        }
        // 并行预取歌词文本（core 歌词缓存预热，全屏播放器打开秒显）
        if (lrcUrl) void musicApi.getLyrics(lrcUrl).catch(() => {});
        // 路由解析不回填 lrc（热榜/搜索点播常态）：后台按 ID/名字严格匹配补歌词
        // ——与其他分支保持一致；网易歌经 tier3 解析时靠源站 ID 能搜回歌词
        else void fetchLrcInBackground(song);
      }
    }
    if (playId !== currentPlayId) throw 'cancelled';
    if (!audioUrl?.startsWith('http') && !audioUrl?.startsWith('file://')) throw new Error('no playable URL');
    log.addLog('info', `[耗时] 直链就绪: 《${song.name}》 解析耗时 ${Date.now() - t0}ms`);
    console.log(`[player] 直链URL: ${audioUrl.slice(0, 120)}`);
    usePlayerStore.getState().setPreparing(false);

    // 兜底补歌词：把解析到的歌词 URL 写回 currentSong，触发全屏播放器加载歌词
    if (lrcUrl && !song.lrc) {
      usePlayerStore.setState((s) =>
        s.currentSong?.id === song.id ? { currentSong: { ...s.currentSong, lrc: lrcUrl } } : {}
      );
    }

    // 播放器请求头：CDN 可能校验 UA/Referer。Referer 按源映射官方域名——
    // 网易云 CDN（music.126.net）宽松不校验，酷狗/QQ 等 CDN 防盗链校验
    // Referer 域名，带错 Referer（如 API 域名）会 403 → 播放失败跳下一首
    // （图片 CDN 校验宽松所以封面正常、音频失败）。UA 保持浏览器特征。
    // UA 与按源 Referer 映射见 core utils/sourceReferer（musicApi/audioProbe 同一份）
    const playerHeaders: Record<string, string> = {
      'User-Agent': BROWSER_UA,
      'Referer': (() => {
        const official = refererForSourceKey(song.sourceType as string);
        return official || '';
      })(),
    };
    // 播放器直连会话保护端点（api.php 302）的兜底：显式带会话 cookie。
    // 仅限 API 同源（CDN 直链是第三方域，带 cookie 会泄漏）。
    // 正常情况下 JS 层已把 302 解析成 CDN 直链（此处不生效）；
    // 解析失败/直链过期走播放器直连时，ExoPlayer 请求带 Cookie
    // 才能拿到 302 而非「非法请求」。cookie 值来自桥透传
    // （document.cookie）或桌面式直接读取；RN jar 自动携带时为空串。
    const sessionCookie = getApiSessionCookie();
    if (sessionCookie && isApiOriginUrl(audioUrl)) {
      playerHeaders['Cookie'] = sessionCookie;
    }

    // 单播放器复用（replace 换源）：永远只有一个 ExoPlayer 实例，
    // 切歌/重试不存在「旧播放器停止 vs 新播放器启动」的叠加窗口
    // （多个实例切换时旧实例停止与新实例出声短暂重叠 = 两首歌同播）。
    const source = { uri: audioUrl, headers: playerHeaders };
    if (player) {
      player.replace(source);
    } else {
      const nextPlayer = createAudioPlayer(source, { updateInterval: 250 });
      livePlayers.add(nextPlayer);
      player = nextPlayer;
      attachPlaybackListener(nextPlayer);
      if (!isExpoGo) {
        nextPlayer.setActiveForLockScreen(true, {
          title: song.name,
          artist: song.artist,
          albumTitle: song.album,
          artworkUrl: song.cover || undefined,
        });
      }
    }
    // 换源后更新锁屏元数据（replace 复用同一 player，标题要跟着换）
    if (!isExpoGo && player) {
      try {
        player.updateLockScreenMetadata({
          title: song.name,
          artist: song.artist,
          albumTitle: song.album,
          artworkUrl: song.cover || undefined,
        });
      } catch {}
    }
    player.play();

    // 播放 URL 落缓存（歌曲资源语义层，12h TTL）：下次(含重启后)直接命中,秒起;无 id 的歌不写
    if (audioUrl?.startsWith('http') && song.id) void setCachedUrl(song.id, audioUrl);

    log.addLog('info', `开始播放《${song.name}》- ${song.artist}${fresh ? '（新URL重试）' : ''}（准备耗时 ${Date.now() - t0}ms）`);
    // 完整版播放成功 → 回写 valid，清掉该行旧的失败徽标（试听版保留 preview）
    if (!playbackNonFull) {
      useAudioTagStore.getState().setTag(song, 'valid');
    }
    useHistoryStore.getState().addHistory(song);
    void updateNotification(song, true).catch(() => {});
    // 预取下一首直链（切歌秒开）
    prefetchNextSong();
  };

  try {
    // 单播放器复用：切歌/重试不销毁播放器（replace 换源，杜绝多实例叠加）。
    // 只有「队列耗尽/播完/显式停止」才由 stopAllPlayers 销毁。
    await startPlayback();
  } catch (err) {
    if (err === 'cancelled') return;
    const reason = String((err as Error)?.message || err);
    log.addLog('error', `《${song.name}》播放失败: ${reason}`);
    // 完整堆栈打到 Metro 终端（移动端诊断 TypeError 等异常用）
    console.error(`[player] 《${song.name}》播放失败堆栈:`, (err as Error)?.stack || err);
    // 失败原因归类（Toast 文案用）：解析链穷尽 vs 其他（播放器/网络）
    const exhausted = reason === 'no playable URL';
    const reasonText = exhausted ? '直连与全部订阅源均未命中' : '音源解析失败';
    if (!fresh && song.sourceType !== 'local') {
      // 解析链穷尽时先回查缓存（#172）：后台预取可能恰在本轮解析期间拿到直链
      // 写入缓存（后台 3s 命中、前台 6s 预算耗尽失败的时序差）。命中且确系本轮
      // 开始后新写入的，直接用它重播——省掉一轮 fresh 全链重跑（实测 ~6s）。
      // 仅限无 url 的歌（有 url 的歌 fresh 重试语义是换掉过期 url，不能绕过）
      // 且首轮（retryCount>0 说明已重试过，防循环）。
      if (exhausted && !song.url && retryCount === 0 && song.id) {
        const written = await getCachedUrl(song.id);
        const age = urlAgeMs(song.id);
        if (written && age != null && Date.now() - age >= t0 - 1_000) {
          log.addLog('info', `《${song.name}》后台预取已拿到直链，跳过 fresh 重试直接播放`);
          // retryCount+1：本轮解析已消耗一次尝试；若缓存在读取前又被清掉，
          // 再次失败时不再进本捷径，正常走 fresh 重试（防循环）
          await playSong(song, retryCount + 1, false);
          return;
        }
      }
      // 解析失败 → 同一首歌换新 URL 重试一次；本地文件失败直接跳歌。
      // 重试保留：订阅源时灵时不灵（实测同歌第一轮全未命中、fresh 轮命中）。
      log.addLog('warn', `《${song.name}》将使用新 URL 重试（${reasonText}）`);
      await playSong(song, retryCount, true);
    } else {
      // 最终失败（fresh 重试也无效）：回写「不可播」徽标引导换源（local 源除外）
      if (song.sourceType !== 'local') {
        useAudioTagStore.getState().setTag(song, 'invalid');
      }
      const nextSong = nextSongAfterError(retryCount);
      if (nextSong) {
        // 静默跳歌用户无感知（曾表现为点歌后 ~12s 无声无息）：Toast 说明去向
        useLogsStore.getState().setNotice('error', `《${song.name}》${reasonText}，已跳到下一首`);
        log.addLog('warn', `《${song.name}》播放失败，自动跳过`);
        await playSong(nextSong, retryCount + 1, false);
      } else {
        await stopAllPlayers();
        usePlayerStore.getState().pause();
        usePlayerStore.getState().setPreparing(false);
        log.reportError(`《${song.name}》${reasonText}，且队列中没有其他歌曲。可长按歌曲换源，或稍后再试`);
      }
    }
  } finally {
    preparingPlayback = false;
  }
}

export async function togglePlay(): Promise<void> {
  const log = useLogsStore.getState();
  const song = usePlayerStore.getState().currentSong;

  if (!player) {
    // 正在解析 URL/创建播放器：忽略点击（防止反复触发 fresh 重试解析）
    if (preparingPlayback) return;
    // 播放器已被清理（如队列耗尽后）→ 用全新 URL 重试当前歌曲
    if (song) await playSong(song, 0, true);
    return;
  }

  if (player.playing) {
    player.pause();
    usePlayerStore.getState().pause();
    if (song) {
      log.addLog('info', `暂停《${song.name}》`);
      void updateNotification(song, false).catch(() => {});
    }
  } else {
    player.play();
    usePlayerStore.getState().resume();
    if (song) {
      log.addLog('info', `继续播放《${song.name}》`);
      void updateNotification(song, true).catch(() => {});
    }
  }
}

export async function seekTo(timeSec: number): Promise<void> {
  if (player) {
    await player.seekTo(timeSec);
  }
}

export async function cleanup(): Promise<void> {
  await stopAllPlayers();
  await clearNotification().catch(() => {});
}
