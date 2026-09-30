@file:OptIn(androidx.media3.common.util.UnstableApi::class)

package expo.modules.mplayerplayer

import org.json.JSONArray
import org.json.JSONObject

/** 队列元素（唯一数据模型；字段名与 JS 侧 `Track` 一一对应）。 */
class TrackRecord(
  val key: String,
  val songId: String,
  val url: String,
  /** 绝对过期时间（I4）。0 = 未知/不适用 → 原生不做本地过期判断。 */
  val expiresAtEpochMs: Long,
  val headers: Map<String, String>,
  val title: String?,
  val artist: String?,
  val album: String?,
  val artworkUrl: String?,
  val durationMs: Long,
  val nonFull: Boolean,
  val sourceType: String?
) {
  /** 连续失败到上限后标记 → 从 ExoPlayer 列表移除，不留在队列里二次踩空。 */
  @Volatile
  var failed: Boolean = false

  @Volatile
  var retryCount: Int = 0

  /** 已知过期（ErrorPolicy 标记），读前由 ExpiryGuard 拦下。 */
  @Volatile
  var invalidated: Boolean = false

  fun toJson(): JSONObject = JSONObject().apply {
    put("key", key)
    put("songId", songId)
    put("url", url)
    put("expiresAtEpochMs", expiresAtEpochMs)
    put("headers", JSONObject(headers as Map<*, *>))
    put("title", title)
    put("artist", artist)
    put("album", album)
    put("artworkUrl", artworkUrl)
    put("durationMs", durationMs)
    put("nonFull", nonFull)
    put("sourceType", sourceType)
  }

  companion object {
    fun fromJson(json: JSONObject): TrackRecord {
      val headersJson = json.optJSONObject("headers")
      val headers = LinkedHashMap<String, String>()
      if (headersJson != null) {
        for (k in headersJson.keys()) {
          headers[k] = headersJson.optString(k)
        }
      }
      return TrackRecord(
        key = json.optString("key"),
        songId = json.optString("songId"),
        url = json.optString("url"),
        expiresAtEpochMs = json.optLong("expiresAtEpochMs", 0L),
        headers = headers,
        title = json.optString("title").ifEmpty { null },
        artist = json.optString("artist").ifEmpty { null },
        album = json.optString("album").ifEmpty { null },
        artworkUrl = json.optString("artworkUrl").ifEmpty { null },
        durationMs = json.optLong("durationMs", 0L),
        nonFull = json.optBoolean("nonFull", false),
        sourceType = json.optString("sourceType").ifEmpty { null }
      )
    }
  }
}

internal class PatchOutcome(val accepted: Boolean, val revision: Long, val stale: Boolean)

/**
 * 「下一首播放」的结果（#494）。
 *
 * - [changed] = 队列**实际发生变化**（幂等命中时为 false，且不 bump revision）；
 * - [queued] = 这首歌此前已在队列里（无论本次新移入还是本来就恰好在 index+1）；
 * - [moved] = 本次把它从别处**移动**过来（false = 新插入，或幂等命中没动）。
 */
internal class InsertOutcome(
  val accepted: Boolean,
  val revision: Long,
  val stale: Boolean,
  val changed: Boolean,
  val queued: Boolean,
  val moved: Boolean
)

/**
 * 权威队列（在原生侧）。
 *
 * `revision` 由原生单调递增；JS 的 `patchQueue` 必须带对 `baseRevision`，否则返回 stale
 * —— 这就是 C 下替代「URL 缓存 generation」的防竞态手段（规格 §6.3）。
 */
internal class QueueStore {
  private val lock = Any()
  private val tracks = ArrayList<TrackRecord>()
  private var index = 0
  private var revision = 0L

  fun load(items: List<TrackRecord>, startIndex: Int): Long = synchronized(lock) {
    tracks.clear()
    tracks.addAll(items)
    index = startIndex.coerceIn(0, maxOf(0, tracks.size - 1))
    revision += 1
    revision
  }

  fun patch(
    baseRevision: Long,
    append: List<TrackRecord>?,
    upsert: List<TrackRecord>?,
    removeKeys: List<String>?
  ): PatchOutcome = synchronized(lock) {
    if (baseRevision != revision) {
      return PatchOutcome(false, revision, true)
    }

    var changed = false

    upsert?.forEach { incoming ->
      val at = tracks.indexOfFirst { it.key == incoming.key }
      if (at >= 0) {
        tracks[at] = incoming
      } else {
        tracks.add(incoming)
      }
      changed = true
    }

    append?.forEach { incoming ->
      if (tracks.none { it.key == incoming.key }) {
        tracks.add(incoming)
        changed = true
      }
    }

    removeKeys?.forEach { key ->
      val at = tracks.indexOfFirst { it.key == key }
      if (at >= 0) {
        tracks.removeAt(at)
        if (at < index) index -= 1
        changed = true
      }
    }

    if (changed) revision += 1
    PatchOutcome(true, revision, false)
  }

  /**
   * 「下一首播放」（#494）：把 [incoming] 放到**当前项之后**（index+1），当前 index 不动。
   *
   * 语义（issue/ADR 已定）：**已在队列 → 移动，不在队列 → 插入**。为什么不复制：
   * ① 同一首歌在队列出现多次会让列表页的拖拽排序对重复项不可用
   * （ADR 2026-09-29-queue-virtualized-sortable-list）；
   * ② media3 历史上对「完全相等的重复 MediaItem」崩过（androidx/media#290）。
   * 「移动」同时让该动作对用户**幂等**（连点两次结果稳定）。
   *
   * 不能复用 [moveTo]：它移的是**播放指针**（index），这里要移的是**曲目在列表里的位置**。
   * 幂等命中（该曲恰好已经在 index+1）时**不动**队列、**不 bump revision**。
   */
  fun insertAfterCurrent(baseRevision: Long, incoming: TrackRecord): InsertOutcome = synchronized(lock) {
    if (baseRevision != revision) {
      return InsertOutcome(false, revision, true, false, false, false)
    }

    val at = tracks.indexOfFirst { it.key == incoming.key }
    val queued = at >= 0
    if (at == index) {
      // 点的是「正在播的这一首」：它已经是当前项，队列无变化
      return InsertOutcome(true, revision, false, false, true, false)
    }
    if (at == index + 1) {
      // 幂等命中：已经就在「下一首」位置
      return InsertOutcome(true, revision, false, false, true, false)
    }

    if (at >= 0) tracks.removeAt(at)
    val insertAt = (index + 1).coerceIn(0, tracks.size)
    tracks.add(insertAt, incoming)
    revision += 1
    InsertOutcome(true, revision, false, true, queued, at >= 0)
  }

  fun clear(): Long = synchronized(lock) {
    tracks.clear()
    index = 0
    revision += 1
    revision
  }

  /**
   * 丢掉队首 `count` 项并把 index 前移（长会话防膨胀；配合 ExoPlayer 侧 removeMediaItem(0)）。
   * 返回实际丢掉的条数。
   */
  fun dropLeading(count: Int): Int = synchronized(lock) {
    val drop = count.coerceIn(0, maxOf(0, index))
    if (drop == 0) return 0
    repeat(drop) { tracks.removeAt(0) }
    index -= drop
    revision += 1
    drop
  }

  fun currentRevision(): Long = synchronized(lock) { revision }

  fun currentIndex(): Int = synchronized(lock) { index }

  fun size(): Int = synchronized(lock) { tracks.size }

  fun current(): TrackRecord? = synchronized(lock) { tracks.getOrNull(index) }

  fun all(): List<TrackRecord> = synchronized(lock) { ArrayList(tracks) }

  /** 从当前项起（含当前项）还没失败/没被移除的条数。 */
  fun aheadCount(): Int = synchronized(lock) {
    var count = 0
    for (i in index until tracks.size) {
      if (!tracks[i].failed) count += 1
    }
    count
  }

  /** 从当前项之后算起的待播条数（不含当前项）。 */
  fun remainingAfterCurrent(): Int = synchronized(lock) {
    var count = 0
    for (i in (index + 1) until tracks.size) {
      if (!tracks[i].failed) count += 1
    }
    count
  }

  fun moveTo(next: Int): Boolean = synchronized(lock) {
    if (next < 0 || next >= tracks.size) return false
    index = next
    true
  }

  fun removeAt(at: Int): Boolean = synchronized(lock) {
    if (at < 0 || at >= tracks.size) return false
    tracks.removeAt(at)
    if (at < index) index -= 1
    if (index >= tracks.size) index = maxOf(0, tracks.size - 1)
    revision += 1
    true
  }

  fun findByKey(key: String): TrackRecord? = synchronized(lock) {
    tracks.firstOrNull { it.key == key }
  }

  fun findByUri(uri: String): TrackRecord? = synchronized(lock) {
    tracks.firstOrNull { it.url == uri }
  }

  fun indexOfKey(key: String): Int = synchronized(lock) {
    tracks.indexOfFirst { it.key == key }
  }

  /** 下一次会播的项（当前项之后的第一个未失败项）。 */
  fun peekNext(): TrackRecord? = synchronized(lock) {
    for (i in (index + 1) until tracks.size) {
      if (!tracks[i].failed) return tracks[i]
    }
    null
  }

  fun snapshot(): JSONObject = synchronized(lock) {
    val array = JSONArray()
    tracks.forEach { array.put(it.toJson()) }
    JSONObject().apply {
      put("revision", revision)
      put("index", index)
      put("tracks", array)
    }
  }

  fun restoreFrom(json: JSONObject) {
    synchronized(lock) {
      tracks.clear()
      val array = json.optJSONArray("tracks") ?: JSONArray()
      for (i in 0 until array.length()) {
        val item = array.optJSONObject(i) ?: continue
        tracks.add(TrackRecord.fromJson(item))
      }
      index = json.optInt("index", 0).coerceIn(0, maxOf(0, tracks.size - 1))
      revision = json.optLong("revision", 0L)
    }
  }
}
