import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export default function DownloadPage() {
  return (
    <View style={styles.container}>
      <Ionicons name="download-outline" size={64} color="#444" />
      <Text style={styles.title}>下载管理</Text>
      <Text style={styles.subtitle}>暂无下载任务</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e', justifyContent: 'center', alignItems: 'center' },
  title: { color: '#888', fontSize: 16, marginTop: 16 },
  subtitle: { color: '#555', fontSize: 13, marginTop: 8 },
});
