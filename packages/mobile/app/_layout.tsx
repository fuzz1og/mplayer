import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, LogBox } from 'react-native';
import { Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme/tokens';
import { addNotificationResponseListener, requestNotificationPermission, setupNotificationChannel } from '../services/notificationService';
import { initAudio, togglePlay, playSong } from '../services/audioPlayer';
import { setupLegacyMigration } from '../services/legacyMigration';
import { setProxyUrl as setCoreProxyUrl, setApiTimingLog, registerDirectClient, neteaseDirectClient, qianqianDirectClient, miguDirectClient, qqDirectClient, kuwoDirectClient, sodaDirectClient, kugouDirectClient } from '@mplayer/core';
import { useSettingsStore } from '../stores/settingsStore';
import { usePlayerStore } from '../stores/playerStore';
import { useLogsStore } from '../stores/logsStore';
import PlayerOverlay from '../components/PlayerOverlay';

// core 的搜索诊断 console.warn（单源识别失败等）在真机 dev 上会触发
// LogBox 横幅盖住底部播放栏；诊断信息 Metro 终端可见，无需上屏
// [player] 的「加载失败」等 error 日志同样走内部重试逻辑，属预期内错误
LogBox.ignoreLogs(['[search]', '[player]']);

/** 全局瞬态提示（真机上无法看终端 console，用 Toast 直接展示）：
 *  error=播放最终失败（红）；info=试听版提示等非错误反馈（蓝） */
function PlaybackNoticeToast() {
  const insets = useSafeAreaInsets();
  const notice = useLogsStore((s) => s.notice);
  const clearNotice = useLogsStore((s) => s.clearNotice);
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState('');
  const [level, setLevel] = useState<'info' | 'error'>('error');

  useEffect(() => {
    if (!notice) return;
    setMessage(notice.text);
    setLevel(notice.level);
    setVisible(true);
    const t = setTimeout(() => {
      setVisible(false);
      clearNotice();
    }, 3500);
    return () => clearTimeout(t);
  }, [notice, clearNotice]);

  if (!visible) return null;
  return (
    <View pointerEvents="none" style={[toastStyles.wrap, { bottom: insets.bottom + 96 }]}>
      <View style={[toastStyles.box, level === 'info' ? toastStyles.boxInfo : toastStyles.boxError]}>
        <Text style={toastStyles.text}>{message}</Text>
      </View>
    </View>
  );
}

export default function RootLayout() {
  const proxyUrl = useSettingsStore(s => s.proxyUrl);
  const showPlayer = usePlayerStore(s => s.showPlayer);
  const setShowPlayer = usePlayerStore(s => s.setShowPlayer);

  useEffect(() => {
    initAudio().catch(() => {});
    // 存量数据迁移：persist rehydrate 完成后清理旧签名死链（幂等，见 legacyMigration）
    setupLegacyMigration();
    // Android 13+ 需先请求 POST_NOTIFICATIONS 运行时权限，通知/锁屏控制才可用
    // （#93；Expo Go 下内部直接返回 false，不弹系统授权框）
    requestNotificationPermission().catch(() => {});
    setupNotificationChannel().catch(() => {});
    // 注意：WebView 网络桥已移除——常驻隐藏 WebView 在 Android
    // （Expo Go + Fabric + Android 16）下会破坏 react-native-screens 的
    // 布局（Stack 内容被压缩到屏幕一半）。请求走 RN 原生栈：
    // core 已配置 withCredentials（原生 cookie jar 自动携带会话），
    // 302 直链解析走 fetch+Range+credentials:'include'（实测 206 成功）。
    // dev 诊断：API 请求耗时日志（PC 链路快、手机慢的对比定位用）
    if (__DEV__) setApiTimingLog(true);

    const sub = addNotificationResponseListener((response) => {
      const data = response.notification.request.content.data;
      const actionId = response.actionIdentifier;

      if (actionId === 'play-pause') {
        togglePlay();
      } else if (actionId === 'next') {
        usePlayerStore.getState().next();
        const nextSong = usePlayerStore.getState().currentSong;
        if (nextSong) playSong(nextSong);
      } else if (actionId === 'prev') {
        usePlayerStore.getState().prev();
        const prevSong = usePlayerStore.getState().currentSong;
        if (prevSong) playSong(prevSong);
      } else if (data?.songId) {
        // 点击通知正文 → 打开播放器
        setShowPlayer(true);
      }
    });

    return () => sub.remove();
  }, []);

  // 启动时将已保存的设置同步到 core 模块
  useEffect(() => {
    // 注册直连客户端（T02 网易 / T03 汽水 / T04 千千 / T05 咪咕 / T06 QQ / T07 酷狗 / T08 酷我）
    registerDirectClient(neteaseDirectClient);
    registerDirectClient(sodaDirectClient);
    registerDirectClient(qianqianDirectClient);
    registerDirectClient(miguDirectClient);
    registerDirectClient(qqDirectClient);
    registerDirectClient(kugouDirectClient);
    registerDirectClient(kuwoDirectClient);

    if (proxyUrl) {
      setCoreProxyUrl(proxyUrl);
    }
  }, [proxyUrl]);

  return (
    <>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="hotlist" />
        <Stack.Screen name="settings" />
        <Stack.Screen name="favorites" />
        <Stack.Screen name="history" />
        <Stack.Screen name="discover-playlist/[id]" />
        <Stack.Screen name="artist/[id]" />
      </Stack>

      {showPlayer && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000 }}>
          <PlayerOverlay onClose={() => setShowPlayer(false)} />
        </View>
      )}

      <PlaybackNoticeToast />
    </>
  );
}

const toastStyles = StyleSheet.create({
  // bottom 由组件按 insets.bottom 动态注入（insets.bottom + 96），此处不写死
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 2000,
  },
  box: {
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    maxWidth: '85%',
    shadowColor: '#000000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  boxError: {
    borderColor: colors.danger,
  },
  boxInfo: {
    borderColor: colors.accent,
  },
  text: {
    color: colors.textPrimary,
    fontSize: 13,
    textAlign: 'center',
  },
});
