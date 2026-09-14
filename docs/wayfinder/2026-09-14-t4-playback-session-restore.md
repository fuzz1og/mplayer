# T4 · 冷启恢复播放的语义：还原的那首歌该是什么，点播放键该发生什么

- **日期**：2026-09-15
- **仓库基线**：`f664a1745937be6bfa92bf4e466ebc44c3330c2f`（2026-09-13 18:55，master，工作区另有未提交的 t1/t2/t3 文档与两份 docs/specs 修改）
- **调研问题**：桌面端冷启后播放栏还原上次的歌，点播放键**完全不出声**。要裁决 (a) 还原歌的语义是「残留展示」还是「可接续的暂停会话」；(b) 点播放键该做什么；(c) 要不要恢复播放位置。本报告只提供**事实依据**，不替裁决。
- **关联 issue**：<https://github.com/fuzz1og/mplayer/issues/328>（「冷启恢复播放的语义：还原的当前歌曲，点播放键该发生什么」），本报告即其事实依据。
- **证据纪律**：只采 primary source——① 官方帮助/开发者文档原文；② 开源项目**真实源码**（贴 `file:line`，附各仓 `git rev-parse` 与 commit 日期）；③ 规范原文；④ 我在本机跑的一次性 vitest 实测。代码读解与实测分开标注：**〔代码〕** = 读源码/读规范得出；**〔实测〕** = 本次新写一次性 vitest 跑出来的输出（用例已删除，方法与原始输出见 §6 附）。找不到的写「未找到」。
- **前置研究**：`docs/wayfinder/t2-charts-form-research.md`、`t3-tier3-mechanism-audit.md`（写作风格与结构对齐这两份）。

---

## 0. 一句话结论

**「冷启还原 = 可接续的暂停会话」是业界绝对主流（14 个产品里 13 个还原播放栏、12 个持久化队列），但「自动出声」几乎是普遍禁忌（没有一个产品默认自动播；4 个把它做成显式开关），而「恢复播放位置」在音乐播放器里是少数派、在播客里是标准动作——且两者用不同的键存储、用不同的过期语义。** 对 MPlayer，最硬的一条事实是：**「位置恢复」与「冷启还原」可以完全解耦**——先说清楚还原态是什么，再单独决定位置。把这两件事捆在一起谈，是这轮裁决最容易踩的坑。

---

## 1. 同类产品冷启恢复的真实行为（逐个说清）

> 证据类型标注：**〔源码〕** = 读开源仓源码；**〔文档〕** = 官方帮助/开发文档原文；**〔实测〕** = 我本机跑出来的。

### 1.1 Spotify 桌面版 —— 还原「当前曲 + 队列」，**位置在播客上有、音乐上含糊**；默认不自动播

- **显示什么**：重开 App，「Now playing」栏保留上次的歌。官方社区版主原话：*"While it shouldn't start automatically, whatever you last played should still be in the 'Now playing' field when you open the app anew. Just by pressing the play button, you can directly pick up where you left off."* —— 出处：[Spotify Community · Desktop-Windows · "Why doesn't the playlist pick up where it left off when the app is reopened"](https://community.spotify.com/t5/Desktop-Windows/Why-doesn-t-the-playlist-pick-up-where-it-left-off-when-the-app/td-p/5473226)（2022-12-14）。〔文档〕
  - **注意措辞**：是「点播放键才能接续」，**不是自动出声**。
- **位置语义（这是本调研最直接可引用的产品级事实）**：Spotify Web API 的 episode 对象里有两个**独立字段**：
  - `resume_point`（object）= *"The user's most recent position in the episode. Set if the supplied access token is a user token and has the scope 'user-read-playback-position'."*
  - `resume_point.resume_position_ms`（integer）= *"The user's most recent position in the episode in milliseconds."*
  - `fully_played`（boolean）= *"Whether or not the episode has been fully played by the user."*
  - 出处：<https://developer.spotify.com/documentation/web-api/reference/get-an-episode>（本次抓取 2026-09-15，页面 HTML 中 `resume_point` 出现 28 次）。〔文档〕
  - **关键读解**：Spotify 在**协议层**就把「位置」与「是否听完」拆成两个字段，且位置**需要专属 OAuth scope** `user-read-playback-position` 才下发——说明位置是**需要授权、需要服务端存储**的一等公民，而不是客户端随手写的一个数。同理 `GET /me/player` 有 `progress_ms`（Unix ms，播放进度）与 `timestamp`（*"Unix Millisecond Timestamp when playback state was last changed (play, pause, skip, scrub, new song, etc.)"*）。
- **跨端**：Windows 11 Cross-Device Resume 支持 Spotify session（[Windowslatest](https://www.windowslatest.com/)、[MakeTechEasier](https://maketecheasier.com/windows-cross-device-resume-continue-on-pc/)，2026-03）——**但这是 OS 层能力，不是 Spotify 自研**；说明「跨设备接续」在业界是**独立于播放器**的问题域。
- **音乐的位置？** 未找到 Spotify 官方明确说明"音乐曲目是否记住精确到秒的位置"。有第三方（theodorehq 的 Echo 产品页）称 *"Spotify keeps your position within a podcast episode and resumes from that point when you return to it in the app. What it does not record is a timestamp history for older episodes you played days ago"*——但这是**二手营销页**，只作旁证、不作结论。
- **队列持久化**：是（服务端，跨设备）。**播放模式**：是（`GET /me/player` 返回 shuffle/repeat 状态）。
- **自动播放**：否（见上引版主原话）。

### 1.2 Apple Music —— **存在 per-track 的「记住播放位置」开关**，默认只对播客/有声书开

- **机制**：`Remember playback position`（中文界面对应「记住播放位置」）是**逐曲目**的属性，在 Get Info → Options 里。**默认状态**：*"Audiobooks downloaded from the iTunes Store or Audible.com, and Podcasts downloaded via iTunes itself have the 'Remember Playback Position' setting enabled by default."*（iLounge/bookmarking tracks，2008 年页面、2021-05-16 更新）〔文档，二手但描述具体行为〕；Apple StackExchange 上的用户实操复现了完整路径：*"Go to your Music Library and select every song… right click… Get Info… In the Options tab… there should be a checkbox for 'Remember playback position'"*（<https://apple.stackexchange.com/questions/461163/turning-off-remember-playback-position>）〔用户实测复现，路径可信〕。
- **最重要的反例信号**：开启该开关后用户的实际抱怨是 *"Any track that I have sampled (listened for a few seconds), if I click on it again after hearing/doing other things, it starts where the sample ended instead of the beginning."*（同上）——**这就是「音乐恢复位置」在真实用户身上的主要代价：试听 5 秒后回来，它从第 5 秒开始。**
- **冷启还原**：Apple Music 桌面/Music App 会开在「上次的播放列表」；但**位置不可靠**——大批用户报告 *"every time I start Apple Music it forgets where it left off"*、*"if I pause for longer than a few minutes, what I was listening to is gone (it says 'not playing' in the app)"*（<https://discussions.apple.com/thread/253274019>）〔Apple 官方社区用户报告，非官方规格〕。一位第三方总结（theodorehq）称：*"Apple Music: resumes the current song, but a paused album or playlist can lose its exact spot once you move on."*
- **自动播放**：否。

### 1.3 YouTube Music —— 历史上**不恢复跨端位置**，2025-07 才补上；冷启行为未找到官方规格

- **位置跨设备**：*"With YouTube Music version 8.26.51, we're now seeing the app sync playback progress across devices. Listeners are able to continue a playlist where they left off by tapping 'Resume.'"*（Android Authority，2025-07-18）；*"YouTube Music now keeps your exact playback spot across desktop and mobile… your playback transfers as long as you're signed in to the same account. Previously, YouTube Music restarted songs when going from the web to mobile."*（XDA，2026-01-27）。〔新闻，非一手；但两源独立互证同一版本号与 UI 文案"Resume"〕
  - **注意**：连 YouTube Music 这个量级的产品，直到 2025 年才做「位置跨端」，且做出来是**显式 "Resume" 按钮**（用户主动点），而不是静默恢复——这与 Pocket Casts/Overcast 的「自动回跳」是两种不同的产品哲学。
- **冷启自动播放**：**未找到官方说明**。attempted 的官方帮助页（`support.google.com/youtubemusic/answer/9572379`）返回 404。

### 1.4 foobar2000 —— **有显式开关，且说明文字直接写明「记住当前曲 + 位置，下次启动恢复播放」**

- 官方（Hydrogenaudio Knowledgebase 收录的 foobar2000 Preferences 原文）：*"**Save playback state when closing foobar2000 and resume on next startup** — Enabling this feature will make foobar2000 remember currently played track and position each time when shutting down and resume playing it on next startup."* 出处：<https://wiki.hydrogenaudio.org/index.php?title=Foobar2000:Preferences:Playback>〔官方知识库原文〕
- 同一文档的另一条更关键的语义：*"Now, if you close foobar on pause, you will have to press play to restart playing even at restart. If checked, will start to play the last file you were listening to, exactly where you were in the file."*（foobar2000 Manual · Playback，<http://eolindel.free.fr/foobar0.9/playback.php>）〔文档〕
- **读解**：foobar2000 把「**恢复播放态**（开就出声）」与「**恢复位置**（从哪里开始）」区分描述得很清楚——**"resume playing on startup" 是一个独立勾选项**，恢复位置是它的附带语义，不是另一件事。
- **自动播放**：**只有开了这个开关才自动播**；关掉则「pause 着退出，重启后也要按 play」。

### 1.5 VLC —— **三态（Never / Ask / Always）**，且**只在视频上恢复**（源码级证据）

这是本次调研中**唯一有源码级、可直接照抄的设计**：

- **用户可见设置**：「Continue playback?」三选项。源码 `src/libvlc-module.c:754-766`（commit `330b4e71516ae1b1d0104b8c9db411a1a550f067`，2026-09-14）：
  ```c
  #define RESTORE_PLAYBACK_POS_TEXT N_("Continue playback")
  #define RESTORE_PLAYBACK_POS_LONGTEXT N_("Should the playback resume where it was left off?")
  static const int pi_restore_playback_values[] = {
      VLC_PLAYER_RESTORE_PLAYBACK_POS_NEVER,
      VLC_PLAYER_RESTORE_PLAYBACK_POS_ASK,
      VLC_PLAYER_RESTORE_PLAYBACK_POS_ALWAYS
  };
  static const char* const ppsz_restore_playback_desc[] = {
      N_( "Never resume playback where it was left off" ),
      N_( "Ask when the playback starts" ),
      N_( "Always resume playback where it was left off" ),
  };
  ```
  枚举定义在 `include/vlc_player.h:356`。**默认值 = ASK**（`src/libvlc-module.c:1914`：`add_integer( "restore-playback-pos", VLC_PLAYER_RESTORE_PLAYBACK_POS_ASK, …)`）。〔源码〕
- **⭐ 最关键的一行（MPlayer 的直接参照）**：`src/player/medialib.c:50-52`：
  ```c
  if (media->i_type != VLC_ML_MEDIA_TYPE_VIDEO ||
      vlc_ml_media_get_all_playback_pref(ml, media->i_id,
                                         &input->ml.states) != VLC_SUCCESS)
  {
      vlc_ml_release(media);
      return;   /* ← 音频媒体直接 return，根本不恢复位置 */
  }
  ```
  `vlc_ml_media_type_t` 枚举为 `UNKNOWN, VIDEO, AUDIO`（`include/vlc_media_library.h:41-44`）。**即：VLC 在产品逻辑里就写着「位置恢复只对视频生效，音频不恢复」。** 〔源码，本次读码确认〕
- **位置怎么存**：存**归一化进度**（0.0–1.0，字段 `f_progress`），不是秒：`src/player/medialib.c:206` `vlc_ml_media_update_progress( ml, media->i_id, input->position )`（`input->position` 是 double 比例），API 见 `include/vlc_media_library.h:1132`。**这个设计天然免疫「重解析后时长变了」的问题**——比例在时长变化后仍然是「那个位置」。〔源码〕
- **什么时候写**：`vlc_player_UpdateMLStates()`（`src/player/medialib.c:171`）由播放主循环在 **input 真正停止并 join 时**调用一次（`src/player/player.c:265`，在 `joinable_inputs` 循环里），即**不是周期性写**。〔源码〕
- **恢复时机**：`vlc_player_input_RestoreMlStates(input, false)` 在 input 创建时调用（`src/player/input.c:1316`）。ASK 模式下：*"if we are aiming at a specific title, wait for it to be added, and only then select it & set the position"*——因为要等 title 列表就绪才能定位（`src/player/medialib.c:61-74`，含 `input->ml.delay_restore = true; input->ml.pos = media->f_progress`）。**这是「seek 时机」的成熟做法：不是 load 后立刻 seek，而是等媒体元数据/结构就绪后 seek。** 〔源码〕
- **社区侧的另一条事实**：用户实测 *"I'm very sure this happens whenever I'm <5% from either the start or end of the video… stopping the video at 4:59… will not allow me to resume"*（SuperUser 1759971）——说明 VLC 实现里有**首尾各约 5% 的丢弃区**。**该阈值我没在源码里定位到**（未验证，见末尾）。
- **自动播放**：不自动（ASK 是默认；ALWAYS 只影响**位置**）。

### 1.6 MusicBee —— **per-track「记住播放位置」开关，默认关闭，且明确说这是给播客/有声书用的**

- *"**remember playback position** （Default: unticked）Tick to make MusicBee start the track from the spot where it last stopped (i.e. to keep your spot in audiobooks, podcasts, etc.)"* —— 出处：<https://musicbee.fandom.com/wiki/Tagging>〔社区 Wiki 收录的产品设置说明〕
- 另一条独立佐证（MusicBee 的 MantisBT 官方 bug 库 #18184）描述的行为：*"BUG: MM do not continue track playback on restart eg. Play track -> Move seekbar to 3min in track -> Close MM -> Start MM -> Press Play -> Track starts from beginning (expected to continue playing at same place)"* —— **注意这里的期望是 "Press Play" 之后接续**，即**冷启不出声、按播放键才接续**，与 Spotify 版主的口径一致。〔官方 issue tracker 原文〕
- 该 bug 讨论里还有一条很有价值的语义：*"if track is >10 minutes playback will start from bookmark position if not then it will start from start"*——**即存在「时长阈值」：短曲目不恢复位置**。（这是 MusicBee 的用户描述，非官方规格，作旁证。）
- **自动播放**：否（须按 Play）。

### 1.7 Plexamp —— 位置是**库级开关**（"Store track progress"），且**必须长按 Stop 才存**

- 官方论坛解答（Plex 员工 `elan` 参与线程）：*"Enable 'Store track progress' in the properties of this library. When you pause an audiobook, do not do a short tap on the Pause button. Instead, press it long (which does a full Stop). This stop is then stored on the server, if the above mentioned check box is set. (A simple Pause however is not stored)"* —— 出处：<https://forums.plex.tv/t/plexamp-doesnt-continue-playing-audiobooks-from-where-they-left-off/813276>（2022-10-02）〔官方论坛，Plex 团队参与〕
- **读解**：这是本次调研中**最反直觉但最有价值**的一条——**「暂停」不写位置，「停止」才写**。语义上把「临时暂停（可恢复）」与「结束本次会话（落盘）」分开。对 MPlayer 的启示：写盘时机不必绑在采样 tick 上。
- **阈值**：社区反馈 *"it marks audio as finished at like 95%. Which is fine for songs but might cut hours off an audiobook."*〔用户报告，非官方〕
- **自动播放**：否。

### 1.8 Nuclear（Rust+Tauri，开源，2026-09-14 master）

- **仓库**：`https://github.com/nukeop/nuclear`，commit `e2266fe44569ff232d37bb5c75e34749dd14eae0`（2026-09-14 16:36 +0200）。〔源码〕
- **队列持久化**：**是**，写 Tauri `LazyStore` 的 `queue.json`，只存 `queue.items` 与 `queue.currentIndex`（`packages/player/src/stores/queueStore.ts:22-23, 105-114`）；启动时经 `initPlayerApp.tsx:36-40` 的 `initializeQueueStore()` 水合，且水合时把每项 `status` **重置为 idle**（`queueStore.ts:139-143`）。
- **⭐ 是否自动播**：**否，而且是显式写的**。`packages/player/src/hooks/useStreamResolution.ts:14-38`：
  ```ts
  const isFirstResolutionRef = useRef(true);
  …
  const autoPlay = !isFirstResolutionRef.current;   // 第一次解析 => autoPlay=false
  isFirstResolutionRef.current = false;
  void streamResolution.resolve(currentItem, { autoPlay });
  ```
  **即：冷启后第一次解析出来的当前曲，刻意不自动播放**；之后的切歌才自动播。〔源码，本次读码确认〕
- **位置是否恢复**：**仅内存，不落盘**。`soundStore.ts:12,35,41` 的 `seek` 是纯内存字段，`setSrc()` 时归零；`startPositionSeconds` 机制**只用于「流地址失效后恢复」**（`useStreamRecovery.ts:40-43`：`startPositionSeconds: useSoundStore.getState().seek`），**冷启路径从不传该值**。全仓 grep `f_progress`/`position` 持久化零命中（`git grep` 确认）。〔源码〕
- **seek 的实现（可直接借鉴的技术点）**：`packages/hifi/src/hooks/useStartPosition.ts:11-27` —— 在 `loadedmetadata` 事件上**一次性**设 `audio.currentTime`，不是 load 后立刻设：
  ```ts
  audio.addEventListener('loadedmetadata', applyStartPosition, { once: true });
  ```
  这正是 VLC 「等就绪再 seek」的 Web 版对应实现。〔源码，本次读码确认〕

### 1.9 Museeks（Tauri，开源，2026-05-26 master）

- **仓库**：`https://github.com/martpie/museeks`，commit `7163f6019a3184043c06352caeec0ed1bf6ccff5`（2026-05-26）。〔源码〕
- **队列持久化**：**否**。`src/lib/player.ts:65-70` 的 `queue/oldQueue/queueCursor` 全在内存，构造时全部置空；持久化配置 `src/generated/typings.ts:3` 的 `Config` 类型里**没有任何 queue/position 字段**（只有 `audio_volume / audio_playback_rate / audio_shuffle / audio_repeat / library_*` 等）。
- **冷启**：只在**文件关联**场景（双击音频文件启动）才建队列：`src/api/SettingsAPI.ts:58-66`（`window.__MUSEEKS_INITIAL_QUEUE`）。**普通冷启 = 播放器空白。**
- **位置恢复**：**无**。`player.ts:617` 有 `setCurrentTime()` 但只被 UI 拖动调用。
- **写盘节流的正面样本**：音量写盘有防抖 —— `player.ts:622-626`：`saveVolumeDebounced = debounce((volume) => { void ConfigBridge.set('audio_volume', volume); }, 500)`，注释原文 *"Debounced volume save to avoid too many writes to config"*〔源码〕—— **证明「高频值写同步存储 → 必须节流」是同类项目的共识**。
- **自动播放**：仅文件关联场景自动播（`await player.start(...)`）；普通冷启不出声。

### 1.10 YesPlayMusic（Electron + Vue，开源，2026-06-14 master）

- **仓库**：`https://github.com/qier222/YesPlayMusic`，commit `df075cca247eab7bf8686155cb8cc9a1f4c7e271`（2026-06-14）。**这是与 MPlayer 技术栈最接近的对照物（Electron + Howler）。** 〔源码〕
- **⭐ 位置持久化：有，而且是「每秒无条件写 localStorage」**
  - `src/utils/Player.js:222`（冷启恢复）：
    ```js
    this._replaceCurrentTrack(this.currentTrackID, false).then(() => {
      this._howler?.seek(localStorage.getItem('playerCurrentTrackTime') ?? 0);
    });
    ```
  - `src/utils/Player.js:248-259`（写盘）：
    ```js
    _setIntervals() {
      setInterval(() => {
        if (this._howler === null) return;
        this._progress = this._howler.seek();
        localStorage.setItem('playerCurrentTrackTime', this._progress);
        …
      }, 1000);
    }
    ```
  - **同一函数里有作者自己写的 TODO 认错**：*"如果 _progress 在别的地方被改变了，这个定时器会覆盖之前改变的值，是bug"*。**这是一个真实存在、被作者标注为 bug 的高频写盘实现。** 〔源码，本次读码确认〕
  - **关键缺陷（对 MPlayer 直接相关）**：`localStorage.getItem(...)` 返回的是 **string**，`_howler.seek(value)` 里 Howler 会 `parseFloat`，能工作；但**没有任何时长校验/越界处理**——若重解析后新音频更短，seek 会被 Howler 推给 `_node.currentTime`，行为交给浏览器（见 §3.5）。
- **冷启自动播**：`_init()` 里 `_replaceCurrentTrack(id, false)` 第二参数 `autoplay = false`——**明确不自动播**，位置已经 seek 好，等用户点播放。〔源码〕
- **队列持久化**：`localStorage['player']` 序列化整个 Player 实例（排除 `_playing/_personalFMLoading/_personalFMNextLoading` 三个键，`Player.js:38-42`），含 `list` / `current` / `repeatMode` / `shuffle`。恢复入口在 `Player.js:217` `this._loadSelfFromLocalStorage()`。

### 1.11 Feishin（Navidrome/Subsonic 客户端，Electron，开源，2026-09-14 master）

- **仓库**：`https://github.com/jeffvli/feishin`，commit `adb5c5f193e19fdb2d5000ffea9243e5535d4178`（2026-09-14 07:50 -0700）。**这是本次调研中「冷启恢复位置」实现最完整、也最值得 MPlayer 抄的开源样本。** 〔源码〕
- **设置项**：`setting.savePlayQueue`；英文文案原文 *"Save the play queue when the application is closed and restore it when the application is opened"*（`src/i18n/locales/en.json`，UI 在 `application-settings.tsx:377-393`）。**默认值 true**（`settings.store.ts:1399` `resume: true`）。〔源码〕
  - **注意文案里没有「记住位置」字样**——但实现里位置一并恢复了（见下）。**这是「一个开关涵盖两件事」的一个反例。**
- **位置存储**：**独立 zustand store + idb-keyval（IndexedDB）**，键名 `player-timestamp`，**不是 localStorage**。`src/renderer/store/timestamp.store.ts:1-43`：
  ```ts
  import { del, get, set } from 'idb-keyval';
  const timestampStorage = {
      getItem: async (name) => { const value = await get(name); … return { state: { timestamp: value }, version: 1 }; },
      setItem: async (name, value) => { await set(name, value.state.timestamp); },
  };
  export const useTimestampStoreBase = createWithEqualityFn<TimestampState>()(
      persist(…, { name: 'player-timestamp', storage: timestampStorage, version: 1 })
  );
  ```
  **位置单独一个 store、单独一个介质（IDB）、单独 version 号**——与队列 store（`player-store`）解耦。〔源码〕
- **写频率**：react-player 的 `progressInterval={isTransitioning ? 10 : 250}`（`web-player-engine.tsx:347,373`），onProgress 里 `setTimestamp(e.playedSeconds)`（`web-player.tsx:146,209`）——**约每 250ms 一次**。因为落 IDB 是异步的，不会卡主线程（对比 YesPlayMusic 的 localStorage 每秒同步写）。**写之前还会检查是否在播放**：`if (usePlayerStoreBase.getState().player.status !== PlayerStatus.PLAYING) return;`（`web-player.tsx:139-141, 203-205`）——**暂停时不写**。〔源码〕
- **恢复位置**：两套机制，前者用于「服务端队列恢复」、后者用于「本地持久化恢复」：
  - `QueueRestoreTimestampHook`（`use-queue-restore.ts:24-43`）：收到 `onQueueRestored` 事件后 `setTimeout(() => { setTimestamp(position); mediaSeekToTimestamp(position); }, 100)` —— **带 100ms 延迟的 seek**。
  - `useInitialTimestampRestore`（`use-queue-restore.ts:47-145`）：这是**一份相当复杂的时序防护**，含 `startupSeekArmedRef` / `startupSeekTargetUniqueIdRef` / `startupSeekAppliedRef` 与 `cancelStartupSeek()`/`applyStartupSeek()`，逻辑要点：
    1. 水合完成 + 有 currentSong 才启动（`!playerHydrated || !currentSong → return`）；
    2. 记录目标曲的 `_uniqueId`，若期间**换曲**了 → `cancelStartupSeek()`（**恢复位置绝不会被误用到别的歌上**）；
    3. **只在 `PlayerStatus.PLAYING` 时才真正 seek**，否则 arm 住等播放事件；
    4. `seekTimestamp <= 0` 直接放弃；
    5. 用一个模块级 `startupRestoreSessionHandled` 保证**每次会话只做一次**。
  - 挂载点：`features/player/components/audio-players.tsx:148-149`。**即：这是一个被真正接进生产代码的特性，不是半成品。** 〔源码，本次读码确认〕
- **是否自动播**：否。`setQueue` 虽把 `status` 设为 `PLAYING`（`player.store.ts:1497`），但 seek 由上述 hook 在真正 PLAYING 事件时应用；且 `partialize` 明确**排除 `status` 与 `seekToTimestamp`**（`player.store.ts:1777-1796`），注释：*"These are not needed to be stored since they are ephemeral properties"*。〔源码〕
- **跨设备**：位置随队列一起走服务端 `savePlayQueue({ positionMs })`（`use-queue-restore.ts:171-178`），Navidrome 响应字段 `position`（`navidrome-controller.ts:765,774`）；自动保存是**每 N 首触发一次**（`use-autosave.ts:12-28`，`songCount` 计数），不是每 tick。

### 1.12 Sonixd（Navidrome/Subsonic 客户端，Electron，**已进入维护模式**，2023-07-19）

- **仓库**：`https://github.com/jeffvli/sonixd`，commit `f5900c23e853f9a235b1384053c6d7e006a54ac2`（2023-07-19）。README 首行：*"The application is undergoing a full rewrite under the name Feishin."*〔源码〕
- **「Resume Playback」开关**：`src/components/settings/ConfigPanels/PlayerConfig.tsx:167-168`，文案原文 `name={t('Resume Playback')}` / `description={t('Resumes the player queue on startup.')}`，i18n 的 `en.json` 里键值确实是 `"Resume Playback"`。**默认 `resume: false`**（`setDefaultSettings.ts:149`）。〔源码〕
  - **注意 description 的措辞是 "Resumes the player queue"——只承诺队列，不承诺位置。** 这与实现完全一致（见下）。
- **⭐ 位置不恢复（源码级确认）**：保存的 `PlayQueueSaveState` 字段为 `entry / shuffledEntry / current / currentIndex / currentSongId / currentSongUniqueId / player1 / player2 / currentPlayer`（`usePlayerControls.ts:346-365`），而 `player1/player2` 的类型只有 `{ src, index, fadeData }`（`playQueueSlice.ts:18-33`）——**没有 currentTime/position 字段**。`restoreState` reducer（`playQueueSlice.ts:992-1005`）逐字段赋值，也没有位置。`handleRestoreQueue` 用 `deflate/inflate` 压缩 JSON 落文件（`usePlayerControls.ts:376-417`）。〔源码，本次读码确认〕
- **退出时机（MPlayer 可抄）**：`src/main.dev.js:585-593`：
  ```js
  if (!saved && settings.get('resume')) {
    event.preventDefault();          // ← 拦截 window 的 close
    saved = true;
    saveQueue(() => { mainWindow.close(); if (forceQuit) { app.exit(); } });
  }
  ```
  配 `saveQueue()`（`main.dev.js:402-408`）：`ipcMain.on('saved-state', () => callback())` + `mainWindow.webContents.send('save-queue-state', app.getPath('userData'))`。**即：主进程拦截关闭 → 通知渲染层落盘 → 渲染层回 `saved-state` → 主进程才真关窗。** 这是**「退出前可靠落盘」的成熟范式**，且避免了在 `beforeunload` 里做异步 IO 的死结。macOS 上另有 `before-quit` 置 `forceQuit = true`（`main.dev.js:605-607`）。〔源码〕
- **另一个小设计**：播放开始后**延时**再存（`Player.tsx:643-649`）：`setTimeout(() => ipcRenderer.send('quicksave'), playQueue.fadeDuration * 1000 + 2500)`——**避开交叉淡入切换的中间态**。

### 1.13 lx-music（Electron + Vue，开源，2026-09-14）

- **仓库**：`https://github.com/lyswhut/lx-music-desktop`，commit `abcbf5fa00b0b9f2c532a80b10ad8906ee4b22ab`（2026-09-14 01:07 +0800）。〔源码〕
- **两个独立开关，都在 `src/common/defaultSetting.ts`，默认都是 `false`**：
  - `'player.isSavePlayTime': false`（`defaultSetting.ts:44`）—— 中文文案 **「记住播放进度」**，英文 **"Remember playback progress"**（`src/lang/zh-cn.json` / `en-us.json`）
  - `'player.startupAutoPlay': false`（`defaultSetting.ts:26`）—— 中文 **「启动软件后自动播放音乐」**，英文 **"Automatically play music on startup"**
  - UI：`src/renderer/views/Setting/components/SettingPlay.vue:5,9` 两个 `base-checkbox`。〔源码〕
  - **⭐ 「恢复位置」与「自动播放」是两个独立勾选，各自默认关闭**——这正是 §6 我要给 MPlayer 的选项形状。
- **保存的数据结构**（`src/renderer/types/player.d.ts:49-54`）：
  ```ts
  interface SavedPlayInfo {
    time: number
    maxTime: number      // ← 存了当时的时长！
    listId: string
    index: number
  }
  ```
  〔源码〕**存 `maxTime` 是为了能算比例/做越界判断**——这是本次调研里唯一明确存了"存位置时的时长"的产品。
- **写频率：throttle 2000ms**。`usePlayProgress.ts:13`：`const delaySavePlayInfo = throttle(savePlayInfo, 2000)`；throttle 实现（`src/common/utils/common.ts:95-106`）是**前缘丢弃 + 尾缘补发**（`if (timer) return`）。触发点三处：`nowPlayTime` 变化（`:144-152`）、`maxPlayTime` 变化（`:154-159`）、`handleSetPlayInfo`（暂停时，`:130-142`）。
- **落盘介质**：**主进程 JSON 文件**，不是 localStorage。`src/main/modules/winMain/rendererEvent/data.ts:11-16`：`mainOn(save_data, ({params:{path,data}}) => getStore(STORE_NAMES.DATA).set(path, data))`；`Store.set()` 里**每次 set 都同步 writeFileSync + rename**（`src/main/utils/store.ts:17-28, 60-63`），用 `temp + rename` 保证原子性。**即：渲染层每 2 秒发一次 IPC，主进程每 2 秒同步写一次盘。**〔源码〕
- **恢复时机（等播放事件，不抢跑）**：`handleRestorePlay`（`src/renderer/core/player/action.ts:150-186`）：
  ```ts
  window.app_event.setProgress(appSetting['player.isSavePlayTime'] ? restorePlayInfo.time : 0, restorePlayInfo.maxTime)
  window.app_event.pause()
  ```
  **恢复时先 `pause()`**——即**绝不自动出声**，只把进度条摆到 2:31 并停在暂停态。自动播由另一个开关 `startupAutoPlay` 控制（`useDataInit.ts:26-32`）。〔源码，本次读码确认〕
  - `initPrevPlayInfo`（`useDataInit.ts:14-33`）守卫：`if (!info?.listId || info.index < 0) return`、`if (!list[info.index]) return`——**索引越界/列表不存在就整个放弃恢复**。

### 1.14 MusicFree（React Native，开源，2026-06-20）

- **仓库**：`https://github.com/maotoumao/MusicFree`，commit `d118b18b3d0c904400f7eea7bf99c0ceec6c1aee`（2026-06-20）。〔源码〕
- **持久化介质**：MMKV（`src/utils/persistStatus.ts:5-12`，`getOrCreateMMKV("App.PersistStatus")`），字段含 `music.musicItem / music.progress / music.repeatMode / music.playList / music.rate / music.quality`（`:14-41`）。**位置（`music.progress`）与队列同库、不同键。**
- **写频率**：react-native-track-player 的 `PlaybackProgressUpdated` 事件（`src/service/index.ts:57-59`），即由播放器原生按 `progressUpdateEventInterval: 1`（`src/entry/bootstrap/bootstrap.ts:182`，**1 秒**）回调。**写 MMKV 是同步的**——与 YesPlayMusic 同类风险，但 MMKV 有 mmap 级写入、代价远小于 localStorage 的字符串序列化 + 配额检查。〔源码〕
- **恢复**：`setupTrackPlayer()`（`src/core/trackPlayer/index.ts:128-180`）：
  ```ts
  const progress = PersistStatus.get("music.progress");
  const track = PersistStatus.get("music.musicItem");
  …
  if (track && this.isInPlayList(track)) {
      if (!this.configService.getConfig("basic.autoPlayWhenAppStart")) {
          track.isInit = true;          // ← 不自动播时打个标记
      }
      this.pluginManagerService.getByMedia(track)?.methods.getMediaSource(track, quality)
        .then(async newSource => { … if (progress) { this.seekTo(progress); } });
      this.setCurrentMusic(track);
      if (progress) { this.seekTo(progress); }
  }
  ```
  **关键：恢复时**先重新解析 URL**（`getMediaSource`）再 seek**——这正是 MPlayer「重解析可能拿到不同版本」场景的同类处理。〔源码，本次读码确认〕
- **自动播**：独立开关 `basic.autoPlayWhenAppStart`，UI 文案中文 **「软件启动时自动播放歌曲」**（`src/types/core/i18n/index.d.ts:314`），默认 `?? false`（`basicSetting.tsx:276-279`）；启动时 `if (Config.getConfig("basic.autoPlayWhenAppStart")) TrackPlayer.play()`（`bootstrap.ts:281-283`）。〔源码〕
- **一个字段读到两次**：`setCurrentMusic(track)` → `PersistStatus.set("music.musicItem", …)`（`:806`）→ 而 `seekTo()` 内部也 `PersistStatus.set("music.progress", progress)`（`:733-735`）。所以恢复动作本身**会把自己的位置再写回去一次**——无害，但说明这套实现没有做「写入与恢复的区分」。

### 1.15 汇总表

| # | 产品 | 冷启显示上次的歌？ | 显示成什么态 | 点播放键做什么 | 队列持久化 | 播放模式持久化 | 当前 index | 自动播 | 位置恢复 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **Spotify 桌面** | 是 | Now playing 有歌 | 接续（含播客位置） | 是（服务端） | 是 | 是 | **否** | **播客是 / 音乐未证实** |
| 2 | **Apple Music** | 是（打开的播放列表） | 列表在位 | 从头或接续（依赖 per-track 开关） | 部分 | 是 | 是 | 否 | **per-track 开关，默认只给播客/有声书** |
| 3 | **YouTube Music** | 是 | Speed dial 带进度条 | 点 "Resume" 显式接续 | 是（服务端） | 是 | 是 | 未找到 | **2025-07 起跨端，2015 前不恢复** |
| 4 | **foobar2000** | 是（开关开时） | 当前曲 + 位置 | 直接续播（开关开时） | 是 | 是 | 是 | **开关控制** | **有（同一开关）** |
| 5 | **VLC** | 是（同一文件） | 位置条在 | 三态 Never/Ask/Always | 是（medialibrary） | 部分 | 是 | 否（ASK 默认） | **仅 VIDEO；音频源码级排除** |
| 6 | **MusicBee** | 是 | 当前曲 | 按 Play 接续 | 是 | 是 | 是 | 否 | **per-track 开关，默认关** |
| 7 | **Plexamp** | 是 | 当前曲 | 接续（须 Stop 存过） | 是（服务端） | 是 | 是 | 否 | **库级开关 "Store track progress"** |
| 8 | **Nuclear** | **是** | 当前曲（queue index 还原） | 走 play 链（首次不自动播） | **是**（Tauri store） | 是 | **是** | **否（源码显式）** | **否（仅内存，仅用于流失效恢复）** |
| 9 | **Museeks** | **否**（除文件关联） | — | — | **否** | 是（shuffle/repeat） | 否 | 仅文件关联 | **否** |
| 10 | **YesPlayMusic** | 是 | 当前曲 | 接续（位置已 seek 好） | 是（localStorage） | 是 | 是 | **否（autoplay=false）** | **是（localStorage，每秒写）** |
| 11 | **Feishin** | 是 | 当前曲 | 接续 | **是**（IDB + 服务端） | 是 | 是 | 否 | **是（独立 store + IDB + 复杂时序防护）** |
| 12 | **Sonixd** | 是（resume 开时） | 队列还原 | 接续队列 | **是**（压缩文件） | 是 | 是 | 否 | **否（源码级确认，字段都没有）** |
| 13 | **lx-music** | 是 | 当前曲 + 进度条 | 播放键接续（位置已摆好、停在暂停） | 是（主进程 JSON） | 是 | 是 | **独立开关，默认关** | **独立开关，默认关；存 time+maxTime** |
| 14 | **MusicFree** | 是 | 当前曲 | 接续（重解析后 seek） | 是（MMKV） | 是 | 是 | **独立开关，默认关** | **是（MMKV，1s 写）** |

**统计**：13/14 显示上次的歌；**12/14 不自动播放**（另 2 个是显式开关）；**位置恢复 7 有 / 5 无 / 2 未证**；**队列持久化 12/14 有**。

---

## 2. 「恢复播放位置」的成熟语义

### 2.1 播客 App 的黄金标准

**(a) Pocket Casts —— 「智能回跳」：按暂停时长决定退多少秒**

官方帮助原文（[General Settings – Pocket Casts Support](https://support.pocketcasts.com/knowledge-base/general-settings/)，更新于 2024-05-28）：

> **Intelligent Playback Resumption**
> - When enabled, the app will automatically jump back in the timeline when a podcast resumed after a period of time. This improves the listening experience by providing more context when you're ready to start playback again after an interruption.
> - The amount that the episode skips back is based on how long it has been paused for:
>   - If paused for **more than 5 minutes**, the app will jump back **10 seconds**.
>   - If paused for **more than 1 hour**, the app will jump back **15 seconds**.
>   - If paused for **more than 24 hours**, the app will jump back **30 seconds**.

〔文档，官方〕**这是本次调研最重要的产品级语义**：**位置不是精确恢复，而是「按离开时长做补偿性回退」**。它把「过期时间」从"存多久算失效"变成了一个**连续函数** —— 越久不回来，回退越多（因为你需要更多上下文）。这个设计的隐含前提是**内容是有上下文的长篇**（播客）；对 3 分钟的歌不成立。

**(b) Overcast —— Smart Resume：回退 + 对齐词边界**

- *"Overcast has a Smart Resume feature that rewinds slightly after pausing and even slightly adjusts seeks to fall between words."*（[Podfeet 的 Overcast 使用指南](https://www.podfeet.com/blog/2024/05/overcast-user-guide/)，2024-06-01）〔用户指南，二手但描述具体〕
- MacStories 的评测原文：*"My favorite addition is what Marco Arment calls Smart Resume, which does two things. First, when resuming playback, Overcast skips back a few seconds to remind you of where you left off in a paused episode. Second, Overcast resumes playback in the dead space between words where possible."*（[MacStories](https://www.macstories.net/reviews/overcast-adds-smart-resume-new-auto-deletion-option-and-support-for-password-protected-podcasts/)，2018-03-14）〔产品评测，Marco Arment 官方发布〕
- **与 Pocket Casts 同构**：位置恢复 ≠ 精确恢复，**回退是特性不是妥协**。

**(c) AntennaPod（开源，Android）—— 明确的可配置「听完」阈值，默认 30 秒**

- 仓库：`https://github.com/AntennaPod/AntennaPod`，commit `b2766f04f56a1788e2f82f20591c490a1c6f11d3`（2026-09-12 20:25 +0200）。〔源码〕
- **阈值实现**（`playback/service/.../PlaybackService.java:1193-1197`）：
  ```java
  int smartMarkAsPlayedSecs = UserPreferences.getSmartMarkAsPlayedSecs();
  boolean almostEnded = media.getDuration() > 0
          && media.getPosition() >= media.getDuration() - smartMarkAsPlayedSecs * 1000;
  if (!ended && almostEnded) { Log.d(TAG, "smart mark as played"); }
  ```
  然后 `DBWriter.markItemsPlayed(FeedItem.PLAYED, ended || (skipped && almostEnded), …)`（`:1213`）。**即「距结尾 N 秒内即视为听完」——是秒数阈值，不是百分比。**〔源码，本次读码确认〕
- **默认值 30 秒**：`storage/preferences/.../UserPreferences.java:447`：`Integer.parseInt(prefs.getString(PREF_SMART_MARK_AS_PLAYED_SECS, "30"))`。UI 文案：*"Mark episodes as played even if less than a certain amount of seconds of playing time is still left"*（`ui/i18n/src/main/res/values/strings.xml:488-489`），**这是一个用户可调的下拉**（`preferences_playback.xml:83-87`）。另有 `"Disabled"` 选项（`strings.xml:582`）。〔源码〕
  - 社区 issue #7961 讨论是否要「per-podcast 覆盖」——说明 30s 这个全局值在实践中不够，但**方向是秒数**。
- **写频率：每 5 秒一次定时器**。`playback/service/.../internal/PlaybackServiceTaskManager.java:37`：`public static final int POSITION_SAVER_WAITING_INTERVAL = 5000;`，配 `schedExecutor.scheduleWithFixedDelay(positionSaver, POSITION_SAVER_WAITING_INTERVAL, POSITION_SAVER_WAITING_INTERVAL, TimeUnit.MILLISECONDS)`（`:76-78`）。触发 `positionSaverTick()` → `saveCurrentPosition(true, null, Playable.INVALID_TIME)`（`PlaybackService.java:833`）。〔源码〕
  - **另有事件驱动的写**：`case PLAYING: … saveCurrentPosition(true, null, …)`（`:886`）——**开始播放时先存一次**。
- **恢复时机**：`onPrepared` 里 `if (media.getPosition() > 0) seekTo(media.getPosition())`（`internal/LocalPSMP.java:317-319`），且**紧跟着有一句作者的自我怀疑**：`// TODO This call has no effect!`（`:317`）。**即：seek 在 prepared 回调里做，但实现者认为它可能不生效**——这正是 Feishin 要加那么多时序防护的原因。
- **越界处理（这是「新音频更短」的成熟答案）**：`seekTo(int t)`（`LocalPSMP.java:357-395`）：
  ```java
  if (t < 0) { t = 0; }
  if (t >= getDuration()) {
      Log.d(TAG, "Seek reached end of file, skipping to next episode");
      endPlayback(true, true, true, true);      // ← 越过时长 => 视为听完，跳下一集
      return;
  }
  ```
  **两个动作：负数 clamp 到 0；≥duration 视为「已听完」直接进下一集，不做 clamp 到 duration。**〔源码，本次读码确认〕

**(d) Jellyfin（媒体服务器，为 Plex/Emby 同类）—— 官方常量：5% / 90% / 300 秒**

- 仓库：`https://github.com/jellyfin/jellyfin`，commit `0ed74b7376853e8299adc869bd8ee1459494dee1`（2026-09-14）。`MediaBrowser.Model/Configuration/ServerConfiguration.cs:131-146`：
  ```csharp
  /// Gets or sets the minimum percentage of an item that must be played in order for playstate to be updated.
  public int MinResumePct { get; set; } = 5;

  /// Gets or sets the maximum percentage of an item that can be played while still saving playstate.
  /// If this percentage is crossed playstate will be reset to the beginning and the item will be marked watched.
  public int MaxResumePct { get; set; } = 90;

  /// Gets or sets the minimum duration that an item must have in order to be eligible for playstate updates..
  public int MinResumeDurationSeconds { get; set; } = 300;
  ```
  〔源码，本次读码确认〕**这是全行业最清楚的一段「位置有效期」规格化表述**，三件事一次说清：
  1. **< 5% 不存**（刚开头不值得存，等价于「从头」）；
  2. **> 90% 丢弃位置并标为看完**（下回从头，或者根本不出现在「继续观看」里）；
  3. **< 300 秒的内容根本不参与位置追踪**（短视频/短歌不值得）。
  Emby 社区里同款设置的建议值更极端：*"set in the audiobook library resume to 1% instead of the default 5% and to played to 100% from the default 90%"*（Emby Community，2021-03-24）——**说明这组阈值是按内容类型调的，没有唯一正确答案**。

**(e) PodcastAddict**：设置路径 `Settings > Player > Controls`，选项文案 *"Mark played after 90%"*（reddit r/PodcastAddict）〔用户报告，二手〕。

### 2.2 音乐播放器（非播客）恢复位置是否常见？

**结论：不常见，而且反例的证据质量明显高于正例。**

**反例 1 — VLC：源码里直接不恢复音频位置。**
`src/player/medialib.c:50-52` 的 `if (media->i_type != VLC_ML_MEDIA_TYPE_VIDEO …) return;` 是**明确的产品意图**，不是遗漏。一个做了 20 年、有完善 medialibrary 的播放器，在能恢复位置的前提下**选择不对音频恢复**。
（注：VLC 4.0 之前的位置恢复其实也作用于音频文件——用户能在音频文件上观察到 resume；上面读的是当前 master。**这一条我标注为「当前 master 的行为」，不声称它一直是如此。**）

**反例 2 — Sonixd：设置名就叫 "Resume Playback"，但保存结构里根本没有位置字段。**
一个 Navidrome/Subsonic 客户端，服务端本身支持 `savePlayQueue(position)`，它**依然只存队列不存位置**（`playQueueSlice.ts:18-33` 的 `player1: { src, index, fadeData }`）。

**反例 3 — Nuclear：有位置字段（`soundStore.seek`），有 `startPositionSeconds` 机制，但冷启路径从不传。**
说明「有基础设施」与「真的要恢复位置」是两回事——**它的基础设施是为「流 URL 失效后无感恢复」建的**，那是个完全不同的问题（用户正在听，不能断）。

**反例 4 — Museeks：队列都不持久化。** 普通冷启播放器空白。

**反例 5 — Apple Music 的 per-track 开关默认只给播客/有声书开。** 官方默认值本身就是「音乐不恢复位置」。

**唯一明确承诺音乐恢复位置的开源样本是 YesPlayMusic**（`Player.js:222,255`），而它同一函数里带着作者自己标注为 bug 的定时器覆盖问题；**Feishin 是唯一做得完整（含换曲守卫、只 PLAYING 时 seek、独立 IDB store）的样本，而它的设置文案只承诺 "Save the play queue"，没承诺"记住位置"** —— 说明连做这件事的人都没把它当卖点。

**"官方文档里说的理由"**：我**没有找到**任何产品的官方文档明确写「我们不恢复音乐位置，因为……」。**这是本次调研最大的空缺**。能拿到的只是**默认值即态度**（Apple Music 默认只给播客；lx-music / MusicFree / MusicBee / foobar2000 / Sonixd 默认 false 或 per-track 未勾选）。

### 2.3 位置存多久算过期？

- **无任何官方口径**。VLC / foobar / MusicBee / Nuclear / Museeks / YesPlayMusic / Sonixd 都**没有 TTL**（位置一直留着）。
- **有官方口径的是「不用 TTL 而用距离阈值」**：
  - Jellyfin：`MinResumePct=5`、`MaxResumePct=90`、`MinResumeDurationSeconds=300`（源码常量，见上）。
  - AntennaPod：距结尾 30 秒内视为听完（用户可调，含 Disabled）。
  - Pocket Casts：**没有 TTL，但按暂停时长做 10/15/30 秒的补偿性回退**。
- **社区共识（弱）**：Plex 用户反映 `~95%` 被标完成；Pocket Casts 的「>24h 回退 30s」是唯一把「时间」用起来的官方表述。
- **⚠️ 一个必须点出的设计差异**：Pocket Casts 把时间维度用在**回退量**上，而不是**失效**上。即：**「过期」这件事在成熟产品里不是一个布尔开关，而是一个连续量。** MPlayer 若要 (c)，需要考虑的正是这个形状。

---

## 3. 技术实现路径

### 3.1 Howler.js / HTMLAudioElement 有状态持久化吗？

**没有。Howler 完全无持久化 API。**〔源码〕

- Howler 仓库 `goldfire/howler.js` master 的 `src/howler.core.js`（本次 `curl` 取，82687 bytes）中，grep `localStorage|sessionStorage|indexedDB|serialize|toJSON` **零命中**。
- 官方 README（`https://raw.githubusercontent.com/goldfire/howler.js/master/README.md`，570 行）里**没有任何持久化/serialize 章节**。只有：
  - `seek([seek], [id])` —— *"Get/set the position of playback for a sound."*
  - `pause([id])` —— *"Pauses playback of sound or group, **saving the `seek` of playback**."*
  - `stop([id])` —— *"Stops playback of sound, **resetting `seek` to `0`**."*
  - `state()` —— 返回 `unloaded`/`loading`/`loaded`（**只是加载状态，不是播放态**）
  - **没有任何 `getState()`/`serialize()`/`restore()`**。**Howler 的「状态」是内存对象，进程退出即消失。**
- **能否「序列化播放态」**：**不能。** Howler 的可持久化信息只有：① `song.url`（MPlayer 侧，且会过期）；② `howl.seek()` 的返回值（一个 number）；③ `howl.duration()`。**除此之外没有可提取的东西**——`_sounds` 数组、`_node`（真实 DOM Audio 对象）、`_playLock` 都是内部实现细节，README 未承诺稳定性。

**Howler 的 `seek()` 实现细节（对 MPlayer 的 seek 时机有直接影响）**：`src/howler.core.js:1592-1695`〔源码〕
```js
seek: function() {
  …
  // If the sound hasn't loaded, add it to the load queue to seek when capable.
  if (typeof seek === 'number' && (self._state !== 'loaded' || self._playLock)) {
    self._queue.push({ event: 'seek', action: function() { self.seek.apply(self, args); } });
    return self;
  }
  …
  if (typeof seek === 'number' && seek >= 0) {
    var playing = self.playing(id);
    if (playing) { self.pause(id, true); }
    sound._seek = seek;
    sound._ended = false;
    self._clearTimer(id);
    // Update the seek position for HTML5 Audio.
    if (!self._webAudio && sound._node && !isNaN(sound._node.duration)) {
      sound._node.currentTime = seek;      // ← 直接赋给 HTMLAudioElement.currentTime
    }
    …
  }
}
```
**两个重要事实**：
1. **未 load 完成时 `seek()` 不会丢**——Howler 会把它压进 `_queue`，加载完成后自动执行。**这意味着 MPlayer 可以在 `load()` 的 onload 之前调 `seek`，Howler 会自己排队。**
2. **HTML5 模式下最终是 `node.currentTime = seek`** —— 所以**越界行为由浏览器的 `HTMLMediaElement.currentTime` 决定**，Howler 不做 clamp。MPlayer 正是 `html5: true`（`src/renderer/services/audioPlayer.ts:60`）。
   - 规范侧：WHATWG HTML 的 media 章节里，`seekable` 是 `TimeRanges`，seek 会受 **seekable range** 约束；但我**未能在规范文本里定位到一句明确的 "clamp to duration" 表述**（见末尾未验证项）。**因此：「越界后浏览器怎么办」在 MPlayer 场景下属于未验证，必须自行 clamp。**

**社区怎么做（localStorage 存 position + load 后 seek）**：**YesPlayMusic 就是这条路的标准样本**（`Player.js:222` + `:255`，见 §1.10）——但它是**写盘无节流（1s）**、**读盘无校验**、**seek 无越界处理**的版本。**Feishin 走了更稳的路：位置放独立 IDB store + 只在 PLAYING 时写 + 换曲守卫 + 只 PLAYING 时 seek**（见 §1.11）。

**Howler 相关 issue**：GitHub API 本次被限流（HTTP 403 "API rate limit exceeded"），只拿到搜索结果的三条标题：
- #1756 open「Unexpected "loading" state after seeking html5 audio」
- #963 closed「Huge problem with .seek(number) to the end of html5 audio file」
- #437 closed「WebM can't seek using HTML5 Audio in Firefox」
**#963 的标题本身就是「seek 到 html5 音频文件末尾有重大问题」**——与「位置越界」直接相关。但我**只拿到标题，未读到 issue 正文**（限流），因此**不作为结论，只记录存在性**。见末尾未验证项。

### 3.2 Electron 应用的退出时机：怎么可靠落盘

**MPlayer 现状（本次读码确认）**：
- `src/main/main.ts:147-152`：`mainWindow.on('close', …)` **拦截关闭，隐藏到托盘**（`if (!isQuitting) { event.preventDefault(); mainWindow.hide(); }`）。**即：用户点窗口 X 并不是退出**。
- `src/main/main.ts:410-412`：`app.on('before-quit', () => { isQuitting = true; })`
- `src/main/main.ts:414-424`：`app.on('will-quit', …)` —— 已有先例！**对 `fileStorage.flushSave()` 做落盘**：
  ```ts
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    // 确保防抖写入的数据落盘
    try {
      const { fileStorage } = require('./storage/fileStorage');
      if (fileStorage && typeof fileStorage.flushSave === 'function') { fileStorage.flushSave(); }
    } catch { /* ignore */ }
  });
  ```
- `src/main/storage/fileStorage.ts:42-43`：`private saveTimer` + `private readonly SAVE_DELAY: number = 200; // 200ms 防抖延迟`，`:118` `async flushSave()`，`:152` `fs.writeFileSync(tempPath, jsonData, 'utf-8')`（**temp + rename 原子写**）。
- `src/renderer/**` 里 **`beforeunload`/`pagehide`/`visibilitychange` 零命中**（grep 确认，命中的全是 `packages/mobile/node_modules/typescript/lib/lib.dom.d.ts` 的类型声明）。
- **托盘「退出」走 `app.quit()`**（`src/main/tray/trayManager.ts:56`、`src/main/ipc/appSettingsUpdate.ts:175` 的 `app:quit`）。

**Electron 官方文档原文**（<https://www.electronjs.org/docs/latest/api/browser-window>）：
> **Event: 'close'** —— *"Emitted when the window is going to be closed. It's emitted before the beforeunload and unload event of the DOM. Calling event.preventDefault() will cancel the close."*
（<https://www.electronjs.org/docs/latest/api/app>）
> **Event: 'before-quit'** —— *"Emitted before the application starts closing its windows. Calling event.preventDefault() will prevent the default behavior, which is terminating the application."*
> **Event: 'will-quit'** —— *"Emitted when all windows have been closed… Electron will first try to close all the windows and then emit the will-quit event, and in this case the window-all-closed event would not be emitted."*
〔文档，官方〕

**坑点（结合 MPlayer 现状）**：
1. **`beforeunload` 在 Electron 里不可靠**：官方明确说 close 事件**早于** `beforeunload`；且渲染进程在 `beforeunload` 里的 async 操作（IPC 往返）**不保证完成**。
2. **MPlayer 的 window close 被 preventDefault 了** → 关窗根本不触发退出 → **不能把落盘挂在 window close 上**。
3. **真正可靠的是 `will-quit`**，而且 MPlayer **已经有这条通路了**（`main.ts:414`）——但它是**主进程**的落盘；renderer 的 localStorage 是**渲染进程**的，主进程 quit 时渲染进程可能已经销毁。
4. **`app.exit()` 会跳过 `before-quit`/`will-quit`**（Sonixd 用 `app.exit()` 是在 `saveQueue` 回调里、落盘完成之后，`main.dev.js:589-592` —— 这是**正确顺序**）。

**至少一个开源 Electron 项目的真实做法（Sonixd，见 §1.12）**：
`src/main.dev.js:585-593` 的**「主进程拦截 close → 通知渲染进程落盘 → 渲染进程回执 → 主进程才真关窗」**握手。这是本次调研找到的**唯一一个把「退出前落盘」做成可靠握手的 Electron 项目**，且它同时处理了 macOS 的 `before-quit`（置 `forceQuit`）与 Windows 的 `app.exit()`。**MPlayer 可原样借鉴这个形状。**

### 3.3 写频率：业界怎么做

| 项目 | 介质 | 频率 | 手段 | 证据 |
|---|---|---|---|---|
| YesPlayMusic | localStorage | **1 秒** | `setInterval`，**无条件写** | `Player.js:248-259` 〔源码〕 |
| Feishin | **IndexedDB (idb-keyval)** | **250ms**（react-player progressInterval） | 异步 + **只 PLAYING 时写** | `web-player.tsx:139-141,146`；`timestamp.store.ts:24-26` 〔源码〕 |
| lx-music | **主进程 JSON 文件**（同步写+rename） | **2 秒** | `throttle(savePlayInfo, 2000)` + 暂停时额外写 | `usePlayProgress.ts:13,135,147,157`；`store.ts:60-63` 〔源码〕 |
| AntennaPod | Room/SQLite | **5 秒** | `scheduleWithFixedDelay(5000)` + 开播时额外写 | `PlaybackServiceTaskManager.java:37,76-78`；`PlaybackService.java:886` 〔源码〕 |
| MusicFree | MMKV | **1 秒** | 播放器原生进度事件 | `service/index.ts:57-59`；`bootstrap.ts:182` 〔源码〕 |
| Nuclear | **不写位置** | — | — | `soundStore.ts` 〔源码〕 |
| Sonixd | **不写位置** | — | 队列仅每首延时存 | `usePlayerControls.ts:645-649` 〔源码〕 |
| Plexamp | 服务端 | **仅在 Stop 时**（不是 Pause） | 用户须长按 Stop | Plex 论坛员工回复 〔文档〕 |
| **MPlayer（现状）** | — | **完全不写位置** | — | 〔代码〕 |

**观察**：**没有任何一个项目把位置写进 localStorage 并高频跑**（YesPlayMusic 是唯一的 localStorage 高频写样本，且作者自己标为 bug）。走 localStorage 的两个（YesPlayMusic）是**反面教材**；做对的要么异步介质（IDB/MMKV/服务端），要么同步但节流 + 放主进程（lx-music 2s）。

**"高频写 localStorage 导致卡顿"的公开案例 —— 我没找到权威一手性能数据。**
- 最接近的一手材料是 **WHATWG Web Storage 规范**（<https://html.spec.whatwg.org/multipage/webstorage.html>）与 **web.dev《Best Practices for Persisting Application State with IndexedDB》**（<https://web.dev/articles/indexeddb-best-practices-app-state>）。web.dev 原文（注意这是讲 IDB 的，但它把问题说清了）：
  > *"One of the key features of IndexedDB is its asynchronous API, but don't let that fool you into thinking you don't need to worry about performance… While IndexedDB makes it possible to store large, nested objects as a single record… **the structured cloning process happens on the main thread. The larger the object, the longer the blocking time will be.** … storing the entire state tree as a single record… **after every change (even if throttled/debounced) will result in unnecessary blocking for the main thread**, it will increase the likelihood of write errors, and in some cases it will even cause the browser tab to crash or become unresponsive."*
- 我在 WHATWG 规范里**没有找到**「localStorage 写会阻塞主线程」的显式表述（grep `synchronous`/`main thread` 在 webstorage 章节零命中）。〔未找到，见末尾〕
- **所以「localStorage 高频写会卡」这一条我判定为「业界共识 + 间接证据」，不是本报告能给出的一手结论。** 但**它对本项目无关紧要**：写一个位置值是**几十字节的字符串**，而不是 web.dev 说的「整个 state tree」——**MPlayer 的队列持久化（`mplayer_queue` 存整个 playlist）才是真正的大对象，位置只是个小数字。** 这一点必须在裁决时说清，否则容易把「写位置」当成性能问题而否掉。

### 3.4 URL 过期 / 重解析场景

**MPlayer 的约束（已确认的现状）**：
- 列表歌 `url` 恒为空串，每次播放都要重解析（`playerStore.ts:342-364` 走 `resolvePlayableSongRouted`）。
- 预取缓存是 **30min TTL**（core `prefetchCache`，见 `playerStore.ts:203` 注释「已有未过期条目（core 30min TTL）」）。
- 重解析可能拿到**不同版本**的录音（t2/t3 与 `CONTEXT.md` 均记录了 Live/翻唱/时长不同的问题；`Song.nonFull` 是试听版标记，`packages/core/src/types` 的 `Song` 定义 `nonFull?: boolean`，注释：*"T12 试听版检测：完整时长校验判为 trial（非完整版）时置 true"*）。

**同类产品怎么处理「恢复位置 + 重解析后时长不一致」**：

**(a) MusicFree —— 重解析后再 seek（顺序上把解析放前面）**
`setupTrackPlayer()` 里先 `getMediaSource(track, quality)` 拿到新 URL，再 `seekTo(progress)`（`src/core/trackPlayer/index.ts:159-172`）。**即：位置相对于「新解析出来的那份音频」，不是相对于旧记录。**〔源码〕

**(b) lx-music —— 存 `time` + `maxTime`，用当时时长判断**
`SavedPlayInfo { time, maxTime, listId, index }`（`renderer/types/player.d.ts:49-54`）。恢复时 `setProgress(isSavePlayTime ? restorePlayInfo.time : 0, restorePlayInfo.maxTime)`（`action.ts:156`）——**把新旧时长都交给 UI 层，可以自行比较**。**但 lx-music 没有做「新时长 < 旧 time」的显式处理**（grep 未见）。〔源码，读码确认「未见处理」〕

**(c) VLC —— 存比例而不是秒**
`f_progress` 是 0.0–1.0 的 double（`include/vlc_media_library.h:223`）。**这是对「重解析后时长变化」最优雅的免疫方式**：位置是「你听到哪儿了（相对）」，不是「第 153 秒」。代价：如果重解析拿到的是**不同剪辑**（Live vs 录音室），比例会把「同一相对位置」映射到「不同的实际内容」——但这已经比秒数好，因为至少不会越界。〔源码〕

**(d) Feishin —— 用 `_uniqueId` 守卫，换曲就放弃**
`startupSeekTargetUniqueIdRef` 记住目标曲 id，若 `currentUniqueId !== targetUniqueId` 立即 `cancelStartupSeek()`（`use-queue-restore.ts:79-83, 103-113`）。**即：宁可不恢复，也不错恢复到别的歌上。**〔源码〕

**(e) 没有任何产品处理「同一首歌换了版本」——因为对它们来说这是同一个 id。**
**这是 MPlayer 独有的问题域**：签名 URL 过期 + 多源换源 + 列表歌无 url，使「同一 id → 不同录音」在 MPlayer 里是**常态而非异常**（`Song.nonFull` 的存在即是证据）。**我在所有 14 个对照产品里没有找到对应的成熟做法。**〔未找到〕

### 3.5 位置越界处理

| 做法 | 项目 | 证据 |
|---|---|---|
| **负数 clamp 到 0；≥duration → 视为听完跳下一集** | AntennaPod | `LocalPSMP.java:357-395`〔源码〕 |
| **> MaxResumePct(90%) → 丢弃位置并标看完** | Jellyfin | `ServerConfiguration.cs:139-140`〔源码〕 |
| **< 5% 不存** | Jellyfin | `ServerConfiguration.cs:133`〔源码〕 |
| **< 300 秒内容不追踪位置** | Jellyfin | `ServerConfiguration.cs:145`〔源码〕 |
| **距结尾 30s 内视为听完** | AntennaPod | `UserPreferences.java:447` + `PlaybackService.java:1193`〔源码〕 |
| **比例存储（天然不越界）** | VLC | `vlc_media_library.h:223`〔源码〕 |
| **换曲即放弃恢复** | Feishin | `use-queue-restore.ts:79-83`〔源码〕 |
| **无处理（直接交给浏览器）** | YesPlayMusic | `Player.js:222`〔源码〕 |
| **无处理（Howler 也不 clamp）** | Howler | `howler.core.js:1638-1640`〔源码〕 |

**MPlayer 侧可用的一手规范依据**：WHATWG HTML media 章节里 seek 受 **seekable range** 约束（`HTMLMediaElement.seekable` 是 `TimeRanges`），但我**未能在规范文本中定位到"超出 duration 的 seek 会被 clamp 到 duration"的明确表述**。MPlayer 用的是 `html5: true`，最终执行 `node.currentTime = seek`（`howler.core.js:1639`），**行为落到 Chromium 的实现细节上——不能靠它，必须自己 clamp**。

---

## 4. 「还原态 vs 暂停态」在 UI 上怎么区分

**结论：本次调研的 14 个产品里，没有一个明确区分「上次播放（未加载）」与「暂停中」的视觉。**

- **显示上**：Spotify / Apple Music / lx-music / YesPlayMusic / Feishin / Sonixd / Nuclear / MusicFree 冷启后都是「播放栏有歌、播放按钮显示 ▶」。**这些产品把两者当同一语义。**
- **lx-music 的例外（最接近区分）**：恢复时**先把进度条摆到位、再显式 `pause()`**（`action.ts:151-158`）。**用户在冷启后立刻能看到「进度条在 2:31」**——这本身就是一种隐式的"你上次听到这"的提示，比"进度条在 0"诚实得多。但它**没有改变图标/文案**。
- **VLC 的例外（最接近区分）**：ASK 模式下会**弹一个「Continue」按钮**问用户（`src/libvlc-module.c:764-766` 的 `"Ask when the playback starts"`；社区文档：*"VLC asks, 'Do you want to restart the playback where left off?' The message is displayed on top alongside a 'Continue' button"* —— vlchelp.com）。**这是唯一一个把「还原态」做成显式询问的产品**——代价是每次都要多点一下。
- **Feishin 的做法是"用状态掩盖差异"**：`setQueue` 把 `status` 直接设为 `PLAYING`（`player.store.ts:1497`），然后靠 seek hook 在真正 PLAYING 时对齐。**UI 层看不到"还原态"这个概念。**
- **后果（用户报告）**：
  - Spotify 社区里就有用户抱怨它「自动播了 10 秒又跳走」：*"Mine picks up the song where it left off for about 10 seconds and then jumps to a different song"*（community.spotify.com td-p/5473226）——**状态说谎的直接后果就是用户无法预期发生了什么。**
  - MusicBee 的 MantisBT #18184 里用户把「重启后从头播」**当成 bug 报告**（`"a) BUG: MM do not continue track playback on restart"`），而维护者认为需要讨论——说明**用户对"还原态是什么"的预期本身就不统一**。
- **对 MPlayer 的直接映射**：MPlayer 现状是**最坏的一种**——`PlayerBar.tsx:130-136` 的声波动画由 `isPlaying` 驱动，而 `resume()` 把 `isPlaying` 置 true **但没有声音**（`playerStore.ts:482-485`）。**〔实测〕** 见 §6：`isPlaying=true`、`playerState='idle'`、`playbackClock={position:0,duration:0}`。**即：声波动画会转、进度条不动、没有声音——三者自相矛盾。** 这比"不区分"更糟：它**主动展示了一个错误的信号**。

---

## 5. MPlayer 现状的读解（用代码说话）

### 5.1 `resume()` 的入口盘点与冷启行为

**全部入口（grep 穷举，3 处直接 + 3 处经 `togglePlay`）**：

| # | 入口 | file:line | 冷启时做什么 | 结果 |
|---|---|---|---|---|
| 1 | 桌面播放栏播放键 | `src/renderer/components/PlayerBar.tsx:38-42` `handlePlayPause` → `PlayerBar.tsx:41` `resume()` | `audioPlayer.play()`（howl=null，空操作）+ `set({isPlaying:true})` | **无声、状态说谎** |
| 2 | 歌词页播放键 | `src/renderer/pages/LyricsPage.tsx:134` `onClick={() => (isPlaying ? pause() : resume())}` | 同上 | 同上 |
| 3 | `togglePlay` 的 resume 分支 | `src/renderer/store/playerStore.ts:518-527` → `:525` `get().resume()` | 同上 | 同上 |
| 4 | 全局快捷键（MediaPlayPause / Ctrl+Alt+Space） | `src/renderer/hooks/useGlobalShortcuts.ts:10-12` → `store.togglePlay()`；注册于 `src/main/main.ts:215,218` | 走 #3 | 同上 |
| 5 | 托盘菜单「播放/暂停」 | `src/main/tray/trayManager.ts:30` `send('tray:action',{type:'playPause'})` → `src/renderer/App.tsx:85` `store.togglePlay()` | 走 #3 | 同上 |

**共同缺陷（`playerStore.ts:482-485`）**：
```ts
resume: () => {
  audioPlayer.play();     // audioPlayer.ts:122-126: if (this.howl && this.state !== 'playing') —— howl=null 时静默返回
  set({ isPlaying: true });  // ← 无条件说谎
},
```
**注意**：`resume()` **不看 `playerState`**，也**不看 `currentSong` 是否有 url**，直接置位。

**〔实测〕**（本次一次性 vitest，见 §6 附）：冷启水合态下
- `resume()` → `audioPlayer.play` 调用 1 次（但内部 howl=null 空操作）、`load` **0 次**、`callMusicApi` **0 次**（即**完全没有解析**）；`store.isPlaying = true`；`playerState = 'idle'`；`playbackClock = {position:0, duration:0}`。
- `togglePlay()` → 同上。
- 对照组 `play(song)` → `resolvePlayableSongRouted` 1 次、`load` 1 次、`play` 1 次。

**另外一个容易漏的点**：`playerStore.ts:150` `playbackClock.setPlaying(state === 'playing')` —— 由 `audioPlayer.onStateChange` 驱动。冷启时 `playerState` 是 `'idle'`（`playerStore.ts:298`），所以**时钟不走表**。**所以那个转圈的声波动画是假的：它订阅的 `isPlaying` 被 `resume()` 直接置 true，而时钟根本没启动。**

### 5.2 若要做 (c)：最小改动清单

**要改的数据（现状）**：
- `mplayer_queue` = `{ playlist: Song[], index: number }`（`queueUtils.ts:20-26`）—— **无位置**。
- `playMode` 单独一个键（`queueUtils.ts:7,60-64`）。
- **没有任何地方存位置**（grep `localStorage.setItem` 在 `src/renderer` 只有 2 处：`queueUtils.ts:22` 和 `:62`）。

**最小改动清单（方案 C 的最保守实现）**：

1. **`src/renderer/utils/queueUtils.ts`** —— 新增位置读写。两种形状：
   - **(i) 扩字段**：`{ playlist, index, position? }` —— **向后兼容天然成立**（旧数据无 `position` → `undefined` → 不恢复，等价于方案 A）。**推荐**。
   - **(ii) 独立键**（对齐 Feishin `player-timestamp` / lx-music `player.playInfo`）：`mplayer_playback_position` = `{ songKey: string, position: number, duration: number, updatedAt: number }`。好处：**写位置不必重写整个 playlist**（`mplayer_queue` 是大对象，`JSON.stringify` 整个队列只为一个数字是浪费）。**这一条很重要**——见下方风险 R3。
2. **`src/renderer/store/playerStore.ts`** —— 以下 4 处：
   - 冷启初值（`:292-304`）：读位置到某个新 state 字段（如 `pendingRestorePosition: number | null`）或直接塞进 `playbackClock`。
   - `play()` 主链（`:391` `await audioPlayer.load(songWithRealUrl)` 之后、`:398` `audioPlayer.play()` 之前）：插入 seek。**注意位置在 `:331` `playbackClock.setPosition(0)` 之后必须是"从 0 到恢复值"的覆盖**。
   - `resume()`（`:482-485`）：加 `howl` 为空的判断分支（这是 (b) 的修复，见 §5.3）。
   - `pause()`（`:477-480`）与新增的写入点。
3. **`src/renderer/services/playbackClock.ts`** —— **无需改**。`setPosition()`（`:104-106`）已支持"即使暂停中也立刻反映"，正好用于把进度条摆到 2:31。
4. **`src/renderer/services/audioPlayer.ts`** —— **无需改**（`seek()` 已存在，`:142-146`）。
5. **写入时机（三选一或组合）**：
   - (a) 在 `playbackClock` 的采样 tick 上写（`playbackClock.ts:76-78` `tick()`）——**每 250ms 写一次，最省事但最吵**；且 `playbackClock` 目前**不持有持久化依赖**，"纯读模型"是它的设计定位（`:3-17` 的注释明说"把三件事收进一个模块"），**往里塞写盘会破坏它**。
   - (b) **订阅 `playbackClock`**（`playbackClock.subscribe`，`:85-90`）在 store 层节流写——**不污染 playbackClock，推荐**。
   - (c) 只在 `pause()` / `seek()` / 曲终 / 退出时写（对齐 Plexamp "只在 Stop 时存"、lx-music "暂停时额外写"）——**最省，但崩溃/强杀丢位置**。

**风险清单**：

- **R1 · localStorage schema 向后兼容**：扩字段方案 (i) 天然兼容（旧数据无该字段）；独立键方案 (ii) 也兼容（新键不存在 → 不恢复）。**唯一要小心的是反向**：新版本写的位置字段被旧版本读到——旧版 `loadQueue()`（`queueUtils.ts:31-44`）只读 `data.playlist` 与 `data.index`，**多余的 `position` 字段会被忽略，不会崩**。**风险低。**
- **R2 · 旧数据无该字段**：`loadQueue()` 返回类型是 `{ playlist, index }`（`queueUtils.ts:28`）——**加字段即改契约**，需同步改类型与所有调用点（只有 `playerStore.ts:174` 一处调用 `loadQueue()`）。**风险低。**
- **R3 · 写位置的代价被低估**：如果位置塞进 `mplayer_queue`，**每次写位置都会 `JSON.stringify` 整个 playlist**。MPlayer 的队列可以有几百首（`persistQueue` 已被 11 处调用，`playerStore.ts:451` 等）。**这是真正的性能风险，也是 Feishin 把 timestamp 拆成独立 store + 独立 IDB 键的原因（`timestamp.store.ts:13-27` 注释与实现）。** → **建议独立键 (ii)。**
- **R4 · `playbackClock.setPosition(0)` 的冲突**：`play(song)` 在 `:331` 先 `playbackClock.setPosition(0)`，而音频 load 完成才知新时长（`:406` `playbackClock.setDuration(...)`）。**如果在 `:331` 之前就把恢复位置塞进 clock，会被 `:331` 抹掉；如果在 load 之后 seek，UI 会先显示 00:00 再跳到 02:31（一次可见跳动）。** 需要明确"先归零、load 后 seek、seek 时同步 clock"（`seek()` 已经两件都做了：`:498-502` `audioPlayer.seek(position)` + `playbackClock.setPosition(position)`）。
- **R5 · seek 时机（这是最硬的技术风险）**：
  - MPlayer 的 `play()` 在 `await audioPlayer.load(songWithRealUrl)`（`:391`）之后才 `audioPlayer.play()`（`:398`）。`load()` 的 Promise 在 `onload` 里 settle（`audioPlayer.ts:65-73`），此时 `howl.duration()` 已知。**所以在 `:391` 之后 seek 是"元数据就绪"的（等价于 Nuclear 的 `loadedmetadata` 时机，`useStartPosition.ts:21`）。**
  - 但 Howler 自己的 `seek()` 也有排队保护（`howler.core.js:1613-1622`：`_state !== 'loaded' || _playLock` 时压 `_queue`），**所以在 load 完成前调也不会丢**——给了容错空间。
  - **反之，AntennaPod 作者在 `onPrepared` 里 `seekTo` 后写了 `// TODO This call has no effect!`（`LocalPSMP.java:317`）**，Feishin 用 `setTimeout(…, 100)` + 状态守卫 + 只 PLAYING 时应用（`use-queue-restore.ts:26-42, 130-143`）。**说明"load 后就 seek"在实践里踩过坑**。MPlayer 应当先做一次最小验证再定时序。
- **R6 · 越界**：重解析后新音频更短 → 必须 clamp（Jellyfin 90%、AntennaPod "≥duration 跳下一首"）。**MPlayer 的 `Song.duration` 是列表元数据（`Song.duration: number`，`packages/core/src/types`），与 `howl.duration()` 实际时长可能不一致**（试听版/换源版本）。**越界判断该用 `howl.duration()` 而非 `song.duration`。**
- **R7 · 恢复位置的"最后一秒"**：若上次听到 2:31 而歌曲总长 2:31（即正好播完），恢复会立刻触发 `onEnd`（`audioPlayer.ts:86-90`）→ `playNext()`。**需要"距结尾 N 秒视为听完 → 从头"的阈值**（AntennaPod 30s / Jellyfin 90%）。**现状代码没有这个概念。**
- **R8 · 「自动播」与「恢复位置」被同一个开关捆住**：如果按 lx-music 的形状做（恢复时 `pause()`、位置摆好），那"点播放键"必须能接续——**这就要求 (b) 先修好**，否则位置摆到 2:31 之后点播放还是不出声。**(c) 依赖 (b)。**

### 5.3 关于 (b)：点播放键该做什么

**同类的做法只有两种**：
- **A. 「resume 前先确保已加载」**（Feishin、YesPlayMusic、lx-music 的隐含前提）：冷启时**就已经把 audio 加载好（只是暂停）**，所以 `resume` 就是真 resume。YesPlayMusic 直接在 `_init()` 里 `_replaceCurrentTrack(id, false)` **先 load 好、autoplay=false**（`Player.js:221-223`）——**冷启就预先加载，代价是启动即发起一次解析 + 一次 HTTP**。
- **B. 「resume 时按需加载」**（Nuclear 的 `playRequested` 模式，`playbackManager.ts:31-34, 61-65`）：*"if (this.mountedItemId !== item.id) { this.playRequested = true; return; }"* —— 记住"用户想播"，等解析完成后再真播。**这正是 MPlayer 该走的形状**（MPlayer 冷启不预加载，用户点播放才解析，且 URL 会过期所以**必须**重解析）。

**MPlayer 的约束决定了只能是 B**：URL 带签名会过期 + 列表歌 url 恒空 → **冷启时不可能"预先 load 好"**（YPM 那条路依赖网易 CDN 直链不签名）。所以：
- **「点播放键 → 重走 `play(song)` 全链解析」在 MPlayer 的约束下是唯一不违反物理的做法**（除非愿意接受"冷启即解析，可能解析失败/拿到过期 URL"）。
- 且它天然满足「不出声直到用户点」的业界默认。
- **Nuclear 的 `playRequested` 就是"用户按了播放、但还没加载好"这个中间态的建模**——比 MPlayer 现状的"把 isPlaying 置 true"诚实得多。

### 5.4 这是"修 bug"还是"加特性"？

- **现状（`resume()` 说谎、点播放无声）是 bug，不是特性**：
  - 证据 1：`isPlaying=true` 但 `playerState='idle'`、`playbackClock` 未走表——**两个状态字段自相矛盾**〔实测〕。
  - 证据 2：`PlayerBar.tsx:130-136` 的声波动画由 `isPlaying` 驱动，会转，但没有声音。
  - 证据 3：无任何代码注释/文档声明这是有意行为（grep 未见）。
  - **量级：S**（改 `resume()` 一个分支：`howl` 为空时走 `play(currentSong)`；约 3-10 行 + 测试）。
- **位置恢复 (c) 是特性，不是 bug**：
  - 证据：列表歌 url 恒空、`mplayer_queue` 从未设计位置字段、`CONTEXT.md` 词汇表里没有"播放位置"概念、无任何 issue 要求过它（除 #328 这个本议题）。
  - **量级：M**（新存储字段/键 + 写入时机 + 越界处理 + 空/短曲例外 + 测试；不下 5 个改动点、2 个风险需要实测）。
  - **若再叠加"播客式的回退补偿"或"听完阈值" → L。**

---

## 6. 给 MPlayer 的选项与取舍

> **不替用户做决定。** 下面是 4 个互不排斥的选项，每个说清"在什么前提下它是对的"。

### 方案 A —— 只修 bug：还原态 = 残留展示；点播放键重走全链解析、从头播

- **做法**：`resume()` 增加 `howl` 为空的分支 → `await play(currentSong)`（重解析、从头）。或者：`isPlaying` 不无条件置 true，冷启的播放栏显示 ▶ 但点下去等于"播这首歌"。
- **用户可感收益**：点播放键**出声了**；状态不再自相矛盾（声波动画不转、进度条诚实）。0 新存储、0 迁移。
- **改动面**：`playerStore.ts:482-485`（1 处 + 可能 `togglePlay` `518-527`）；量级 **S**。
- **风险**：低。唯一语义变化是"冷启后点播放是重播而非续播"——**与 12/14 个产品的行为一致**（它们要么从头、要么位置未定义）。
- **什么时候这个选项对**：
  - 如果认为 MPlayer 是**音乐播放器**（不是播客/有声书播放器）——**对标 VLC（源码级排除音频）、Sonixd（有 Resume 开关也不存位置）、Nuclear（有 seek 设施也不用于冷启）、Apple Music（默认只给播客/有声书）**，这个选项是**回到业界主流**。
  - 如果 #328 的隐含痛点是"点了没反应"，那这个选项**把问题彻底消掉，且成本最低**。
- **什么时候这个选项错**：如果用户实际的使用场景是"一张 50 分钟的交响乐/一整张专辑连续听，关掉再打开想接着听"——**从头播的体验损失大于一切**。

### 方案 B —— A + 还原态显式化（学 VLC 的 ASK / lx-music 的"位置摆好但暂停"）

- **做法**：在 A 的基础上，让"还原态"可见：
  - **B1（VLC 式）**：冷启后点播放键，若上次是暂停中，弹一个"继续（2:31）/ 从头"的选择。
  - **B2（lx-music 式）**：冷启后进度条就摆在 2:31、播放键显示 ▶；点播放从 2:31 开始（**需要 (c)**）。
- **用户可感收益**：用户能区分"这是上次听过的"与"这是我刚暂停的"；不会有"点了播放却从头开始"的意外。
- **改动面**：B1 需要 UI + i18n + 位置存在（**其实需要 (c) 才能知道 2:31**）；B2 就是 (c)。量级 **M**。
- **风险**：B1 的"多一次点击"是真实成本（VLC 用户为此抱怨过、社区里有"我不想被问"的帖子）；B2 直接继承 (c) 的全部风险。
- **什么时候这个选项对**：如果裁决认为"还原态"必须是一个**用户可理解的产品对象**，而不是实现细节。**t2 报告对"聚合榜"给过同构的判断：一个没有名字、没有解释的东西就是机械叠加。**

### 方案 C —— A + 恢复位置（学 Feishin/lx-music 的完整实现）

- **做法（最小落地）**：
  1. **独立 localStorage 键** `mplayer_playback_position`（**不要塞进 `mplayer_queue`**，见 R3）= `{ songKey: string, position: number, duration: number, updatedAt: number }`，`songKey` 用 core 的「歌曲身份」（`sourceType:id` 组合，与预取缓存同口径，`playerStore.ts:199-200` 已有此模式）。
  2. **写入**：订阅 `playbackClock.subscribe` 在 store 层节流（**不要改 playbackClock 本体**），间隔取 2s（lx-music 的值）或 5s（AntennaPod 的值）；并在 `pause()`/`seek()` 时补一次。
  3. **恢复**：`play(song)` 在 `await audioPlayer.load()`（`:391`）之后、`audioPlayer.play()`（`:398`）之前插入 `if (restorePos) seek(restorePos)`；**同时校验 `songKey` 匹配**（换曲即放弃，学 Feishin `use-queue-restore.ts:79-83`）。
  4. **越界**：`restorePos >= howl.duration() - 30` → 视为听完，丢弃位置（Jellyfin 90%/AntennaPod 30s 的形状）；`restorePos < 5` → 忽略（Jellyfin `MinResumePct`）。
  5. **更新（(b) 的修复）必须先落地**，否则位置摆好也点不动（R8）。
- **用户可感收益**：长篇内容（播客、有声书、长曲、专辑连续听）的真实接续。
- **改动面**：`queueUtils.ts`（新键读写）+ `playerStore.ts`（冷启读、`play` 里 seek、写入订阅、`resume` 修复）；量级 **M**。
- **风险**：R5（seek 时机，业界踩过坑、AntennaPod 留了 `TODO: This call has no effect!`）、R6（越界，且 `song.duration` 与 `howl.duration()` 可能不一致，**MPlayer 有试听版/换源版本，风险比同类高**）、R7（听完阈值）、R8（依赖 (b)）。
- **需要额外说清的一条**：**MPlayer 独有的风险是"重解析后拿到不同版本的录音"**（签名 URL 过期 + 多源换源 + 列表歌无 url）。**14 个对照产品里没有一个处理这件事**（见 §3.4e）。若走 C，必须自己定：位置相对于"新解析出的那份音频"（MusicFree 的做法）还是相对于"这首歌"（VLC 的比例存储法更接近，但比例在 Live↔录音室之间也无意义）。
- **什么时候这个选项对**：
  - 如果 MPlayer 的目标用户里**长篇内容占比显著**（有声书/播客/长曲），或者"关掉再开继续听"是高频路径。
  - 如果接受"位置不精确、要按离开时长回退"（Pocket Casts/Overcast 的形状），把"恢复"做成**带补偿的近似**而不是精确还原——**这反而是成熟产品的一致做法**。
- **什么时候这个选项错**：
  - 如果 MPlayer 的典型内容是 3-5 分钟的歌——Jellyfin 的 `MinResumeDurationSeconds = 300` 就是为此设的（**短内容根本不参与位置追踪**），Apple Music 默认只给播客开也是同一逻辑。
  - 如果**换源/重解析拿到不同版本是常态**——那么"恢复到 2:31"在版本 B 上可能落在完全不同的段落，**错得比从头播更让用户困惑**。

### 方案 D —— 不恢复位置，但**记录并展示"上次听到这儿"的痕迹**（不改变播放行为）

- **做法**：存 `{songKey, position, updatedAt}`，但**只用于 UI 提示**（例如播放栏该曲显示"上次听到 2:31"，或进度条上画一个 bookmark 刻度），**点播放键仍从头**（= A 的行为）。
- **用户可感收益**：用户获得"我知道我听到哪儿了"的信息（这正是 Pocket Casts 那 10/15/30 秒回跳要解决的问题），但**没有"试听 5 秒回来从第 5 秒开始"的代价**（Apple Music `Remember playback position` 用户抱怨的那个）。
- **改动面**：方案 C 的存储部分 + 一个 UI 提示；量级 **M**（同样要 R3/R5 的存储与时机决策，但**不需要 seek**，因此**规避 R5/R6/R7 全部技术风险**）。
- **风险**：低（不碰播放链路）。代价是"看着 2:31 却不能从那儿播"可能引发新的困惑——**这需要在 UI 文案上说清**。
- **什么时候这个选项对**：如果裁决认为**"信息"比"行为"更值得给**，且不愿承担 seek 时序的工程风险。
- **什么时候这个选项错**：如果用户真正的诉求是"接着听"而不是"知道听到哪儿"——那 D 只是个安慰剂。

### 一个必须点出的前提（不属于任何单一方案）

**(b) 的修复是所有方案的公共前置**。无论选 A/B/C/D：
- 冷启点播放键**必须真的出声**（现状是 bug，见 §5.4）。
- `isPlaying` **不得在无声时置 true**（否则声波动画说谎）。
- 建议采用 **Nuclear 的 `playRequested` 中间态模型**（`playbackManager.ts:31-34`）：用户按了播放 → 记一个"待播"标记 → 解析完成后再真播。这比"置 isPlaying=true"诚实，也不需要引入新概念（MPlayer 已有 `isLoading` 字段，`playerStore.ts:100,307-311`，但目前 `isLoading` 只在 `play()` 链中被设置，冷启 `resume` 路径看不到它）。

---

## 附：本次调研的方法、实测原始输出与证据清单

### A. 一次性 vitest 实测（用例已删除，仓库无留痕）

**方法**：在 `src/renderer/__tests__/zz-coldstart-probe.test.ts` 新建用例，复用 `playerStore.queue.test.ts` 既有的 mock 骨架（`vi.mock` 掉 `audioPlayer` / `callMusicApi` / `IpcClient` / `songCoverRefresh`），模拟"冷启水合态"（`usePlayerStore.setState({ currentSong, currentPlaylist, currentPlaylistIndex })`，不调 `load`），打印调用计数与状态快照。跑完后 `rm` 该文件，`git status --porcelain` 确认工作区无新增测试文件。

**命令**：`npx vitest run src/renderer/__tests__/zz-coldstart-probe.test.ts --reporter=verbose`

**原始输出**：
```
[A] audioPlayer.play 调用次数 = 1
[A] audioPlayer.load 调用次数 = 0
[A] callMusicApi 调用次数 = 0
[A] store.isPlaying = true
[A] playerState = idle
[A] playbackClock snapshot = {"position":0,"duration":0}

[B] play 次数 = 1 | load 次数 = 0 | isPlaying = true | callMusicApi = 0

[C] resolvePlayableSongRouted 次数 = 1 | load 次数 = 1 | play 次数 = 1 | isPlaying = true

 Test Files  1 passed (1)
      Tests  3 passed (3)
```

**读解**：A/B 证明冷启 `resume()`/`togglePlay()` **零解析、零 load**，且 `isPlaying=true` 与 `playerState='idle'` **自相矛盾**；C 作为对照证明 `play()` 主链确实走全链解析。

### B. 本次读源码的仓库与版本（`git rev-parse --short` 取自 shallow clone HEAD）

| 仓库 | commit（short） | commit 日期 | 用途 |
|---|---|---|---|
| `qier222/YesPlayMusic` | `df075cc` | 2026-06-14 20:57 +0800 | 位置持久化（Electron+Howler 同栈对照） |
| `nukeop/nuclear` | `e2266fe` | 2026-09-14 16:36 +0200 | 队列持久化 + 首次不自动播 |
| `martpie/museeks` | `7163f60` | 2026-05-26 17:17 +0200 | 不持久化队列的反例 + 防抖写盘 |
| `jeffvli/feishin` | `adb5c5f` | 2026-09-14 07:50 -0700 | 最完整的冷启位置恢复实现 |
| `jeffvli/sonixd` | `f5900c2` | 2023-07-19 10:41 -0700 | Resume 开关但无位置字段；退出落盘握手 |
| `lyswhut/lx-music-desktop` | `abcbf5f` | 2026-09-14 01:07 +0800 | 双独立开关 + `time/maxTime` + 2s throttle |
| `maotoumao/MusicFree` | `d118b18` | 2026-06-20 11:44 +0800 | MMKV + 重解析后 seek |
| `AntennaPod/AntennaPod` | `b2766f0` | 2026-09-12 20:25 +0200 | 30s 听完阈值 / 5s 定时写 / 越界跳下一集 |
| `jellyfin/jellyfin` | `0ed74b7` | 2026-09-14 | `MinResumePct/MaxResumePct/MinResumeDurationSeconds` 常量 |
| `videolan/vlc` | `330b4e7` | 2026-09-14 14:22 +0000 | 三态设置 / 音频排除 / 比例存储 / 就绪后 seek |
| `goldfire/howler.js` | master（`curl` raw，未 pin commit） | — | 无持久化 API / seek 排队 / `node.currentTime` |

### C. 本次抓取的官方文档

- Spotify Web API · Get Episode（`resume_point` / `resume_position_ms` / `fully_played`）：<https://developer.spotify.com/documentation/web-api/reference/get-an-episode>（2026-09-15 抓取）
- Spotify Web API · Start/Resume Playback：<https://developer.spotify.com/documentation/web-api/reference/start-a-users-playback>
- Spotify Engineering · Player API 介绍（`position_ms` / seek 语义）：<https://engineering.atspotify.com/2022/04/spotifys-player-api>
- Spotify Community（桌面版主回复"点播放键接续"）：<https://community.spotify.com/t5/Desktop-Windows/Why-doesn-t-the-playlist-pick-up-where-it-left-off-when-the-app/td-p/5473226>
- Pocket Casts · General Settings（Intelligent Playback Resumption 10/15/30s）：<https://support.pocketcasts.com/knowledge-base/general-settings/>
- Pocket Casts · Autoplay / Up Next：<https://support.pocketcasts.com/knowledge-base/autoplay/>、<https://support.pocketcasts.com/knowledge-base/up-next-continuous-playback/>
- foobar2000 Preferences · Playback（Hydrogenaudio KB）：<https://wiki.hydrogenaudio.org/index.php?title=Foobar2000:Preferences:Playback>
- Electron · BrowserWindow（`close` 事件与 beforeunload 顺序）：<https://www.electronjs.org/docs/latest/api/browser-window>
- Electron · app（`before-quit` / `will-quit` / `window-all-closed`）：<https://www.electronjs.org/docs/latest/api/app>
- Howler.js README（`seek`/`pause`/`stop`/`state` 语义）：<https://raw.githubusercontent.com/goldfire/howler.js/master/README.md>
- web.dev · Best Practices for Persisting Application State with IndexedDB：<https://web.dev/articles/indexeddb-best-practices-app-state>
- WHATWG HTML · Web Storage：<https://html.spec.whatwg.org/multipage/webstorage.html>
- Apple 社区（Apple Music 位置不恢复的用户报告，**非官方规格**）：<https://discussions.apple.com/thread/253274019>
- Apple StackExchange（`Remember playback position` 的实操路径）：<https://apple.stackexchange.com/questions/461163/turning-off-remember-playback-position>
- Plex 论坛（Plexamp "Store track progress" 须长按 Stop 才存，Plex 员工参与）：<https://forums.plex.tv/t/plexamp-doesnt-continue-playing-audiobooks-from-where-they-left-off/813276>
- MusicBee MantisBT #18184（重启后位置的 bug/feature 讨论，含 ">10 minutes" 阈值）：<https://www.ventismedia.com/mantis/view.php?id=18184>
- MusicBee Wiki · Tagging（`remember playback position` 默认 unticked）：<https://musicbee.fandom.com/wiki/Tagging>
- VLC 社区（Continue playback 三态 / <5% 丢弃区）：<https://www.vlchelp.com/restart-continue-playback-ask/>、<https://superuser.com/questions/1759971/>
- Android Authority / XDA（YouTube Music 2025-07 起跨端恢复位置）：<https://www.androidauthority.com/youtube-music-playback-sync-3578668/>、<https://www.xda-developers.com/youtube-music-finally-allows-queue-syncing-across-apps/>
- Overcast Smart Resume（MacStories 评测）：<https://www.macstories.net/reviews/overcast-adds-smart-resume-new-auto-deletion-option-and-support-for-password-protected-podcasts/>
- Emby 社区（resume 阈值调优建议）：<https://emby.media/community/topic/96371-store-track-progress-for-audio-book/>

---

## 明确「未验证 / 不知道」

1. **Spotify 音乐（非播客）是否恢复精确位置——未证实**。我只拿到播客侧的官方字段（`resume_point`）与第三方营销页的说法；**没找到 Spotify 官方对"音乐曲目是否记住秒级位置"的表态**。§1.1 里"位置在播客上有、音乐上含糊"这个措辞是刻意保守的。
2. **YouTube Music 的冷启（同机）行为——未找到官方规格**。官方帮助页（`support.google.com/youtubemusic/answer/9572379`）返回 404。§1.3 只有跨设备同步的新闻证据。
3. **"官方文档里明确说音乐播放器不恢复位置的理由"——未找到**。§2.2 的反例全部是"默认值即态度"（默认 false / per-track 未勾选 / 源码 return），**没有任何一份官方文档解释为什么**。这是本报告最大的空缺。
4. **VLC 首尾各 ~5% 丢弃区的实现位置——未定位到**。社区实测（SuperUser 1759971）说得很具体，但我在 `src/player/medialib.c` / `input.c` / `libvlc-module.c` 里**没有 grep 到对应阈值常量**。该行为可能来自 libmedialibrary 内部（`setLastPosition()` 的 `ProgressResult` 逻辑），而 **libmedialibrary 的仓库（code.videolan.org）本次 clone 失败**（`could not read Username for 'https://code.videolan.org'`），**未能读到 `setLastPosition` 实现**。
5. **VLC 4.0 之前是否对音频恢复位置——未验证**。本报告读的是当前 master（`330b4e7`）；音频被排除是这个版本的行为，**我不声称它一直是如此**。历史上（2.2.0+）用户确实在音频文件上观察到 resume（SuperUser/社区资料），因此**这里可能存在过行为变更**。
6. **Howler issue #963（"Huge problem with .seek(number) to the end of html5 audio file"）的正文未读到**。GitHub API 本次全程 403 限流（`API rate limit exceeded for 56.155.82.175`），我只拿到搜索结果的标题。**因此"Howler 在 seek 到末尾时的确切行为"未验证。**
7. **WHATWG 规范中「seek 超出 duration 会被 clamp」的明确表述——未在规范文本中定位到**。我用 grep 检索了 `multipage/media.html`（835KB）的 `clamp`（0 命中）与 `seekable range`（0 命中）；已知 `HTMLMediaElement.seekable` 是 `TimeRanges`，但**没有找到一句可直接引用的规则**。**所以"越界后 Chromium 怎么办"在 MPlayer 场景下属于未知——必须自行 clamp，不能依赖浏览器。**
8. **「高频写 localStorage 导致卡顿」的一手性能案例——未找到**。web.dev 的那段话讲的是 IndexedDB 的 structured clone 在主线程（`indexeddb-best-practices-app-state`），不是 localStorage；WHATWG Web Storage 章节里 grep `synchronous`/`main thread` **零命中**。§3.3 的这条判定为"业界共识 + 间接证据"。
9. **Pocket Casts 的 Intelligent Playback Resumption 在"位置存储"与"位置过期"上的完整语义——未见到服务端行为说明**。我只有"按暂停时长回退 10/15/30 秒"这一段官方口径；**它是否存在 TTL、是否跨设备同步这个回退量——未验证**。
10. **MPlayer 冷启 `resume()` 后 `isPlaying=true` 的实际用户可见后果（声波动画是否真的转）——未做真机验证**。§4/§5.1 的推断基于代码读解（`PlayerBar.tsx:130-136` 的 `isPlaying && currentSong` 条件）+ 实测的 state 快照，**没有跑起来看**。
11. **`howl.duration()` 与 `Song.duration`（列表元数据）的偏差幅度——未实测**。这是 R6 越界判断的关键输入，且 MPlayer 有试听版（`nonFull`）与换源版本，**偏差可能很大**。要走方案 C 必须先量这个。
12. **AntennaPod 的 `// TODO This call has no effect!`（`LocalPSMP.java:317`）在当前版本是否仍然成立——未验证**。这是判断"load 后就 seek 到底可不可靠"的关键证据，而我只读到注释，**没有跑过 AntennaPod，也没有找到相关 issue**。
13. **MPlayer 移动端是否有同源缺陷——只做了粗读**。`packages/mobile/services/audioPlayer.ts:510-534` 的 toggle 分支里 `if (!player) { if (song) await playSong(song, 0, true); return; }` —— **移动端在 `player` 为空时会重走 `playSong`**，看起来**比桌面端更健壮**；但移动端 `playerStore`（`packages/mobile/stores/playerStore.ts`，85 行）**完全不持久化 queue**（无 persist / 无 AsyncStorage），冷启后 `currentSong = null`，**因此移动端根本不存在"冷启还原态"这个问题**。〔代码阅读，未跑真机确认〕
14. **本报告未做任何 MPlayer 真机/真桌面验证**。除 §A 的一次性 vitest 外，全部是读码 + 读文档 + 读他人源码。
