@file:OptIn(androidx.media3.common.util.UnstableApi::class)

package expo.modules.mplayerplayer

import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.ResolvingDataSource
import java.io.IOException

/** ExpiryGuard 抛出的「已知过期」信号：不发起请求，交 ErrorPolicy 走过期分支。 */
internal class ExpiredUrlException(val trackKey: String) :
  IOException("mplayer: url expired for key=$trackKey")

/**
 * 只做便宜的本地重写（规格 §6.3）：
 * ① 注入 per-item UA/Referer（DataSpec.withRequestHeaders）；
 * ② 读前判绝对过期 → 直接抛可重试 IOException，不发起请求。
 *
 * **禁止**在这一层做任何网络解析/刷新 —— 解析权 100% 在 JS/cory。
 */
internal class ExpiryGuard(private val store: QueueStore) {

  val resolver: ResolvingDataSource.Resolver = ResolvingDataSource.Resolver { dataSpec ->
    resolve(dataSpec)
  }

  private fun resolve(dataSpec: DataSpec): DataSpec {
    val record = store.findByKey(dataSpec.key ?: "") ?: store.findByUri(dataSpec.uri.toString())
      ?: return dataSpec

    val now = System.currentTimeMillis()
    if (record.invalidated || (record.expiresAtEpochMs > 0L && record.expiresAtEpochMs <= now)) {
      throw ExpiredUrlException(record.key)
    }

    return if (record.headers.isEmpty()) dataSpec else dataSpec.withRequestHeaders(record.headers)
  }
}
