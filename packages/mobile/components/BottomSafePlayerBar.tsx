import { SafeAreaView } from 'react-native-safe-area-context';
import ChromeSurface from './ChromeSurface';
import PlayerBar from './PlayerBar';
import { usePlayerStore } from '../stores/playerStore';

/**
 * 详情页底部迷你播放栏。ADR-0008：首次播放前不渲染（与 Tabs 底部 chrome 同一判据），
 * 避免所有详情页底部常驻一条「未在播放」的空栏。无 blurTarget / 减弱透明度场景由
 * ChromeSurface 自带降级路径兜底。
 */
export default function BottomSafePlayerBar() {
  const playerVisible = usePlayerStore((s) => !!(s.currentSong || s.hasPlayed));
  if (!playerVisible) return null;
  return (
    <ChromeSurface>
      <SafeAreaView edges={['bottom']} style={{ backgroundColor: 'transparent' }}>
        <PlayerBar />
      </SafeAreaView>
    </ChromeSurface>
  );
}
