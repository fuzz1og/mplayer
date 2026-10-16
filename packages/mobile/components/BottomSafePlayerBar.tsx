import { SafeAreaView } from 'react-native-safe-area-context';
import ChromeSurface from './ChromeSurface';
import PlayerBar from './PlayerBar';

/**
 * 无 blurTarget / 减弱透明度场景由 ChromeSurface 自带降级路径兜底。
 */
export default function BottomSafePlayerBar() {
  return (
    <ChromeSurface>
      <SafeAreaView edges={['bottom']} style={{ backgroundColor: 'transparent' }}>
        <PlayerBar />
      </SafeAreaView>
    </ChromeSurface>
  );
}
