import { Stack } from 'expo-router';
import { View, Text, StyleSheet } from 'react-native';

export default function SettingsPage() {
  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: '设置', headerStyle: { backgroundColor: '#1a1a2e' }, headerTintColor: '#fff' }} />
      <Text style={styles.text}>设置页面（P1 实现）</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e', justifyContent: 'center', alignItems: 'center' },
  text: { color: '#666', fontSize: 16 },
});
