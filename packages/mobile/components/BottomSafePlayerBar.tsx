import { SafeAreaView } from 'react-native-safe-area-context';
import PlayerBar from './PlayerBar';

export default function BottomSafePlayerBar() {
  return (
    <SafeAreaView edges={['bottom']} style={{ backgroundColor: '#16213e' }}>
      <PlayerBar />
    </SafeAreaView>
  );
}
