import { useEffect } from 'react';
import { Stack, useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { setupNotificationChannel } from '../services/notificationService';
import { setApiBaseUrl as setCoreApiBaseUrl, setProxyUrl as setCoreProxyUrl, getApiBaseUrl } from '@mplayer/core';
import { useSettingsStore } from '../stores/settingsStore';

export default function RootLayout() {
  const router = useRouter();
  const apiBaseUrl = useSettingsStore(s => s.apiBaseUrl);
  const proxyUrl = useSettingsStore(s => s.proxyUrl);

  useEffect(() => {
    setupNotificationChannel().catch(() => {});

    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data;
      if (data?.songId) {
        router.push('/player');
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
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="player" options={{ presentation: 'modal' }} />
      <Stack.Screen name="hotlist" />
      <Stack.Screen name="settings" />
      <Stack.Screen name="favorites" />
      <Stack.Screen name="history" />
      <Stack.Screen name="discover-playlist/[id]" />
      <Stack.Screen name="artist/[id]" />
    </Stack>
  );
}
