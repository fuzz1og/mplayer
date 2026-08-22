import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import PlayerBar from './PlayerBar';

export default function BottomSafePlayerBar() {
  const { colors } = useTheme();
  return (
    <SafeAreaView edges={['bottom']} style={{ backgroundColor: colors.bgSurface }}>
      <PlayerBar />
    </SafeAreaView>
  );
}
