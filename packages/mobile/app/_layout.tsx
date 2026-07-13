import { useEffect } from 'react';
import { Stack, useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { setupNotificationChannel } from '../services/notificationService';

export default function RootLayout() {
  const router = useRouter();

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
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="player" options={{ presentation: 'modal' }} />
      <Stack.Screen name="settings" options={{ presentation: 'push' }} />
      <Stack.Screen name="hotlist" />
    </Stack>
  );
}
