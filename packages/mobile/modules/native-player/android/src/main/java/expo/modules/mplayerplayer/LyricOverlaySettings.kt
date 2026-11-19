package expo.modules.mplayerplayer

import android.content.Context
import android.content.SharedPreferences
import android.provider.Settings

/**
 * 浮窗的原生设置门面（#775 / 规格 §6.2）：开关持久键与「显示在其他应用上层」检查只此一份。
 * 此前 Module / Service / Controller 各抄一份，三处独立漂移时「开关是 on 但状态说 off」很难查。
 */
internal object LyricOverlaySettings {

    const val KEY_ENABLED = "floatingLyricsEnabled"

    fun prefs(context: Context): SharedPreferences =
        context.getSharedPreferences(PlayerService.PREFS_NAME, Context.MODE_PRIVATE)

    fun isEnabled(context: Context): Boolean = prefs(context).getBoolean(KEY_ENABLED, false)

    fun setEnabled(context: Context, enabled: Boolean) {
        prefs(context).edit().putBoolean(KEY_ENABLED, enabled).apply()
    }

    /** 权限探测的单一落点：异常按「无权限」处理，不崩、不循环弹。 */
    fun canDrawOverlays(context: Context): Boolean = try {
        Settings.canDrawOverlays(context)
    } catch (_: Throwable) {
        false
    }
}
