import { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import { addNotificationResponseListener, setupNotificationChannel } from '../services/notificationService';
import { initAudio, togglePlay, playSong } from '../services/audioPlayer';
import { setApiBaseUrl as setCoreApiBaseUrl, setProxyUrl as setCoreProxyUrl, getApiBaseUrl } from '@mplayer/core';
import { useSettingsStore } from '../stores/settingsStore';
import { usePlayerStore } from '../stores/playerStore';
import { useLogsStore } from '../stores/logsStore';
import PlayerOverlay from '../components/PlayerOverlay';

/** 全局播放错误提示（真机上无法看终端 console，用 Toast 直接展示最终错误） */
function PlaybackErrorToast() {
  const lastError = useLogsStore((s) => s.lastError);
  const clearLastError = useLogsStore((s) => s.clearLastError);
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!lastError) return;
    setMessage(lastError);
    setVisible(true);
    const t = setTimeout(() => {
      setVisible(false);
      clearLastError();
    }, 3500);
    return () => clearTimeout(t);
  }, [lastError, clearLastError]);

  if (!visible) return null;
  return (
    <View pointerEvents="none" style={toastStyles.wrap}>
      <View style={toastStyles.box}>
        <Text style={toastStyles.text}>{message}</Text>
      </View>
    </View>
  );
}

export default function RootLayout() {
  const apiBaseUrl = useSettingsStore(s => s.apiBaseUrl);
  const proxyUrl = useSettingsStore(s => s.proxyUrl);
  const showPlayer = usePlayerStore(s => s.showPlayer);
  const setShowPlayer = usePlayerStore(s => s.setShowPlayer);

  useEffect(() => {
    initAudio().catch(() => {});
    setupNotificationChannel().catch(() => {});

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
    if (apiBaseUrl) {
      setCoreApiBaseUrl(apiBaseUrl);
      console.log(`[RootLayout] synced apiBaseUrl: ${getApiBaseUrl()}`);
    }
    if (proxyUrl) {
      setCoreProxyUrl(proxyUrl);
    }
  }, [apiBaseUrl, proxyUrl]);

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

      <PlaybackErrorToast />
    </>
  );
}

const toastStyles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 120,
    alignItems: 'center',
    zIndex: 2000,
  },
  box: {
    backgroundColor: 'rgba(20, 20, 40, 0.95)',
    borderColor: '#e74c3c',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    maxWidth: '85%',
  },
  text: {
    color: '#fff',
    fontSize: 13,
    textAlign: 'center',
  },
});
