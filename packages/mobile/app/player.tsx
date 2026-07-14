import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import PlayerOverlay from '../components/PlayerOverlay';

export default function PlayerPage() {
  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <PlayerOverlay onClose={() => router.back()} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
});
