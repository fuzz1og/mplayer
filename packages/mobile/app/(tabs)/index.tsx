import { View, Text, StyleSheet } from 'react-native';

export default function DiscoverPage() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>发现</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e', justifyContent: 'center', alignItems: 'center' },
  text: { color: '#fff', fontSize: 18 },
});
