import { useEffect } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { setupNotificationChannel } from '../services/notificationService';
import { setApiBaseUrl as setCoreApiBaseUrl, setProxyUrl as setCoreProxyUrl, getApiBaseUrl } from '@mplayer/core';
import { useSettingsStore } from '../stores/settingsStore';
import { usePlayerStore } from '../stores/playerStore';
import PlayerOverlay from '../components/PlayerOverlay';

export default function RootLayout() {
  const apiBaseUrl = useSettingsStore(s => s.apiBaseUrl);
  const proxyUrl = useSettingsStore(s => s.proxyUrl);
  const showPlayer = usePlayerStore(s => s.showPlayer);
  const setShowPlayer = usePlayerStore(s => s.setShowPlayer);

  useEffect(() => {
    setupNotificationChannel().catch(() => {});

    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data;
      if (data?.songId) {
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
  }, [apiBaseUrl]);

  useEffect(() => {
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
    </>
  );
}
