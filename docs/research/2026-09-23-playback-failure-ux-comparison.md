# 播放失败的 UX 对标调研：失败面板 / 一键换源 / 跳歌失控

> 调研日期: 2026-09-23
> 调研目标: 判断「1.9.0 播放失败新 UI（一键换源 / 失败面板）」（#381）是否值得做；以及同类产品如何防止失败链失控跳歌
> 调研方法: 直读 5 个开源播放器的**播放器源码主源**（非二手转述）+ MPlayer 现行代码逐条对照
> 范围: 只调研不改代码。结论与落地票据见 §6

---

## 0. TL;DR

1. **五家全部没有失败面板，也没有「一键换源」按钮。** 失败主路径高度一致：**同曲重试 → 自动换源（静默，无 UI）→ 跳下一首**。手动换源一律是普通行内菜单项——MPlayer 已经有这个了（`SongRow.tsx:207` / `SongActionsHost.tsx:59`）。
2. **自动换源才是事实上的「一键换源」**：它是自动发生的，不是一个按钮。「一键换源」这个需求名把机制（自动）说成了交互（按钮）。
3. **防失控靠三档机制，MPlayer 三档全缺或最弱**：时间预算（lx-music 5s / 100s）、**绝对跳歌上限**（listen1 `tryCount < playlist.length` + 跳过 `disabled`；FeelUOwn `len(queue) <= len(bad_songs)`）、网络态（仅 MusicFree 有，NetInfo）。
4. MPlayer 现有护栏 = 「连续失败数 ≥ **队列长度**」——相对阈值，**队列越长越失控**。200 首队列断网可链式尝试至多 400 次解析链。
5. **结论：#381（失败面板 / 一键换源按钮）建议不做**；真正该做的是跳歌护栏硬化 + 跨源自动救回决策。

---

## 1. lx-music-desktop

**失败路径**（`src/renderer/core/player/action.ts`）：

1. `getMusicPlayUrl` 同曲先试一次，失败 `catch` 后**同曲重试一次**（`isRetryed` 标志，递归调用自身）。
2. 重试仍失败 → 走 `getMusicUrl({ onToggleSource })`：**自动换源**，UI 只更新一行状态文字 `尝试切换到其他来源...`（`src/lang/zh-cn.json:720`，键 `toggle_source_try`）。**没有任何弹层。**
3. `setMusicUrl` 的 `catch`：`window.app_event.error()` + 若 `player.autoSkipOnError` 为真则 `addDelayNextTimeout()` → **5 秒后 `playNext(true)`**（`createDelayNextTimeout(5000)`，`action.ts:55`）。
4. 另有一条独立兜底：`addLoadTimeout` = **100 秒**加载超时跳歌（`action.ts:56`）。

**关键设置**（`src/common/defaultSetting.ts`）：

- `'player.autoSkipOnError': true` —— **默认开**。
- 设置页文案 `setting__play_auto_skip_on_error` = 「播放错误时自动切换歌曲」。

**换源失败文案**（`src/lang/zh-cn.json:719`，键 `toggle_source_failed`）：

> 换源失败，请尝试手动在搜索页指定其他来源搜索该歌曲播放

**这是全部五家里最能说明问题的证据**：自动换源也失败时，lx-music 把用户**指向已有的搜索页**，而不是弹一个失败面板。

**其他机制**：

- `src/renderer/core/player/timeoutStop.ts`：定时停播（`isPlayedStop` 标志贯穿全链，所有失败分支先查它防竞态）。
- `src/renderer/core/player/utils.ts` `filterList`：跳歌时过滤已播放 / 被 dislike 的歌，`isNext: true` 决定方向。

---

## 2. MusicFree

**失败路径**（`src/core/trackPlayer/index.ts`）：

1. `Event.PlaybackError` 监听器（`:211`）→ 去重后 `this.handlePlayFail()`。
2. `handlePlayFail()`（`:906`）：
   ```ts
   private async handlePlayFail() {
       // 如果自动跳转下一曲, 500s后自动跳转
       if (!this.configService.getConfig("basic.autoStopWhenError")) {
           await delay(500);
           await this.skipToNext();
       }
   }
   ```
   （注释写 500s，代码是 500ms。）
3. 换源在解析腿内部：`src/core/trackPlayer/index.ts:518-527` —— 插件没返回源且 `basic.tryChangeSourceWhenPlayFail` 为真时，调 `getSimilarMusic(musicItem, "music", abortFunction)`。

**`getSimilarMusic`（`:921`）是五家里最激进的自动换源**：

- 遍历**所有可搜索插件**（`getSearchablePlugins`），跳过当前歌所在的插件。
- **总预算 8s**（`Date.now() - startTime > 8000` 即 break）。
- 每插件取前 2 个结果，用**编辑距离**（`minDistance`）算相似度，取全局最近的。
- 若歌名完全相等且歌手相等 → `distance = 0`（精确），立即采用。
- **注意：不是精确匹配也接受**——只要编辑距离最近。

**关键设置**（`src/pages/setting/settingTypes/basicSetting.tsx:283,288`）：

- `basic.tryChangeSourceWhenPlayFail` 默认 **false**（「播放失败时尝试更换音源」）
- `basic.autoStopWhenError` 默认 **false**（「播放失败时自动暂停」）
- 文案源：`src/core/i18n/languages/zh-cn.json:255,256`

**网络态检测（五家里唯一）**：`src/utils/network.ts` 封装 `@react-native-community/netinfo`（`package.json`: `"@react-native-community/netinfo": "11.4.1"`），暴露 `isOffline` / `isWifi` / `isConnected`。**但它的用途是设置项门控（蜂窝网播放/下载开关），不是断网时停止跳歌。**

---

## 3. YesPlayMusic

**失败路径**（`src/utils/Player.js`）：

- 策略是**显式枚举**（`:23`）：`const UNPLAYABLE_CONDITION = { ... }`，含 `PLAY_NEXT_TRACK` / `PLAY_PREV_TRACK`。
- Howler `loaderror` 监听（`:343`）→ `this._playNextTrack(this._isPersonalFM)`。
- 三处调用点（`:496,520,535`）统一走 `switch (ifUnplayableThen)` 分派。
- 无 UI、无面板、无重试提示，纯静默跳下一首。

---

## 4. listen1

**失败路径**（`js/player_thread.js`）：

1. `retrieveMediaUrl(index, playNow)`（`:209`）：取 URL 失败的回调（`:235-242`）→ `this.setAudioDisabled(true, msg.data.index)` + **`this.skip('next')`**。
2. `onloaderror` / `onplayerror`（`:332,343`）→ `BG_PLAYER:PLAY_FAILED` + `self.currentAudio.disabled = true` + `sendPlayingEvent('err')`。

**这是五家里最干净的「跳歌失控」防护**（`skip()`，`:421-435`）：

```js
let tryCount = 0;
while (tryCount < this.playlist.length) {
  if (!this.playlist[this.index].disabled) {
    this.play(this.index);
    return;
  }
  this.index = nextIndexFn(this.index);
  tryCount += 1;
}
playerSendMessage(this.mode, { type: 'BG_PLAYER:RETRIEVE_URL_FAIL_ALL' });
```

两个正交的护栏叠在一起：

- **绝对上限**：`tryCount < playlist.length`——最多绕队列一圈就放弃，而不是「连续失败数 ≥ 队列长度」这种随长度漂移的阈值。
- **记忆化跳过**：`disabled` 标记（`setAudioDisabled`，`:546`）——已证明拿不到 URL 的歌**永不再试**，一圈绕完必然收敛。
- 终止时发 **`BG_PLAYER:RETRIEVE_URL_FAIL_ALL`**（一个明确表示「整个列表都放不出来」的事件），不是静默停。

---

## 5. FeelUOwn

**失败路径**（`feeluown/player/playlist.py`）：

1. `mark_as_bad(song)`（`:236`）把歌加进 `self._bad_songs`（`DedupList`）。
2. `find_and_use_standby(song)`（`:755` 附近）：向**其他 provider** 找同一首歌的替代版本（`a_list_song_standby_v2`）——**这就是跨源救回**，等价于本仓要决策的第二张票。找到则插到当前歌后面继续播；找不到则 `show_msg(t("track-standby-unavailable"))`。
3. `_get_good_song(base, random_, direction, loop)`（`:497`）：**主动跳过所有 bad song** 找下一首可播的。

**护栏是一个「全是坏歌」的检测**（`:521`）：

```python
if not self._queue or len(self._queue) <= len(self._bad_songs):
    logger.debug("No good song in playlist.")
    return None
```

即：**当坏歌数 ≥ 队列长度时停止**——和 MPlayer 的护栏形状一样（都是队列长度相对阈值），但 FeelUOwn 有 `_bad_songs` 这个记忆化集合，一圈内必然收敛；MPlayer 只数「连续失败数」，手动点歌会清零重来。

---

## 6. MPlayer 现状对照

| 维度 | lx-music | MusicFree | YesPlayMusic | listen1 | FeelUOwn | **MPlayer** |
|---|---|---|---|---|---|---|
| 失败面板 / 一键换源按钮 | 无 | 无 | 无 | 无 | 无 | 无（**与五家一致**） |
| 自动跨源换源 | 有（url 解析腿内） | 有（编辑距离，8s 预算） | 无 | 无 | 有（standby provider） | **半有**：tier3 的 search-then-resolve，但默认关 |
| 失败即跳 | 默认开（可关） | 默认跳（可关） | 有 | 有 | 有 | 有（**不可关**） |
| 跳歌绝对上限 | 5s / 100s 定时 | 500ms 延时 | 无 | `tryCount < len` | `len(queue) <= len(bad)` | **无**（只有队列长度相对阈值） |
| 坏歌记忆化 | `playedList` 过滤 | — | — | `disabled` 标记 | `_bad_songs` | `invalid` 徽标（会话内，不参与跳歌决策） |
| 断网检测 | 无 | `NetInfo`（仅设置门控） | 无 | 无 | 无 | **无** |
| 手动换源入口 | 行内菜单 | 行内菜单 | — | — | — | **行内菜单（已有）** |

**MPlayer 的具体缺口（代码位置）**：

1. **护栏是相对阈值**：`src/renderer/store/playerStore.ts:306` / `packages/mobile/services/audioPlayer.ts:170`
   ```ts
   const exhausted = attempt.failureCount + 1 >= store.currentPlaylist.length;
   ```
   队列越长越晚停。且每首在计数前先走一轮 fresh 重试（`playerStore.ts:293-297`，`failureCount` 不增），**每首歌消耗两条解析链**。
2. **手动点歌清零**：`playerStore.ts:346`（`failureCount = 0` 默认值）——每次用户点歌重置计数，于是「断网中点歌 → 跳 3 首 → 再点 → 再跳 3 首」可无限循环，永不触发停止。
3. **零网络态检测**：`src/` + `packages/mobile` + `packages/core/src` 全量 grep 无 `navigator.onLine` / `NetInfo` / `expo-network`；`packages/mobile/package.json` 未装 netinfo。
4. **坏歌标记不参与决策**：`audioTag: 'invalid'` 只驱动 `AudioTagBadge`（`src/renderer/components/SongRow.tsx:181`），`getNextSongIndex` 不查它；且会话内不持久化。
5. **双端两份实现、两套文案**：桌面 `连续 N 首无法播放，已暂停（试试换源）`（`playerStore.ts:320`）vs 移动端 `可长按歌曲换源，或稍后再试`（`audioPlayer.ts:527`）。
6. **用户主动点的那首也会被跳走**：点歌失败与自动续播失败走同一条路径，用户意图被静默改写。
7. **桌面失败态无容器**：`playerStore.error`（`playerStore.ts:104`）在 `src/renderer` 下**零消费方**；`isLoading`（`:101`）同样零 UI 消费（移动端有 `preparing` → PlayerBar spinner，`packages/mobile/components/PlayerBar.tsx:98-100`）。冷启 P50 1082ms / P95 2396ms 期间桌面完全静止。

---

## 7. 结论与落地

1. **#381（失败面板 / 一键换源）不做。** 五家一致不做；且 lx-music 的 `toggle_source_failed` 文案明确把「自动换源也失败」指向**已有的搜索页**，正是 MPlayer 已有的换源入口。做面板属于自创交互，收益不明。
2. **真正缺的是「跳歌失控」防护**（MPlayer 是六家里唯一没有绝对上限 + 没有记忆化 + 没有网络态的一家）。
3. **「一键换源」的正确形态是「自动跨源救回」**，且它与 MPlayer 的 tier3 search-then-resolve 高度重叠——需要一次决策（含身份语义：换 URL 还是换歌）。
4. **等待态**只需对齐移动端已有的 spinner；失败文案已由 #357 落地，无需新界面。

落地票据见 wayfinder 地图 #327 的子票。

