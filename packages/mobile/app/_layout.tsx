import { Stack } from 'expo-router';

export default function RootLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="player" options={{ presentation: 'modal' }} />
      <Stack.Screen name="settings" options={{ presentation: 'push' }} />
      <Stack.Screen name="hotlist" />
    </Stack>
  );
}
