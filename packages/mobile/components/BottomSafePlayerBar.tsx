import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme/tokens';
import PlayerBar from './PlayerBar';

export default function BottomSafePlayerBar() {
  return (
    <SafeAreaView edges={['bottom']} style={{ backgroundColor: colors.bgSurface }}>
      <PlayerBar />
    </SafeAreaView>
  );
}
